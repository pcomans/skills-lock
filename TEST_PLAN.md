# Manual QA Test Plan — skills-lock

Covers the full CLI surface: `add` (pin), `install` (restore), `check` (verify).

## Prerequisites

- Node.js 20+ and npm
- Git installed and on PATH
- Network access to github.com
- The upstream `skills` CLI available via `npx skills` (test 6.1 covers the case where it is not)
- A built local copy of skills-lock:

  ```bash
  git clone https://github.com/pcomans/skills-lock.git
  cd skills-lock
  npm install && npm run build
  ```

Run all test cases from a **fresh, empty directory** unless a case says otherwise. Invoke the CLI as `node <path-to-skills-lock>/dist/cli.js` (aliased below as `skills-lock`), e.g.:

```bash
alias skills-lock="node ~/skills-lock/dist/cli.js"
```

Use `anthropics/skills` as the test source; `pdf` and `algorithmic-art` are known skills in it.

After each case, reset with:

```bash
rm -rf .agents .claude skills.lock
```

Record for every case: pass/fail, actual output on failure, OS, and Node version.

---

## 1. add — pinning skills

### 1.1 Happy path: add with GitHub shorthand
1. Run `skills-lock add anthropics/skills --skill pdf`

**Expected:**
- Output includes `Resolving pdf from anthropics/skills...`, `Installing pdf at <7-char sha>...`, and `Added pdf to skills.lock (ref: <7-char sha>)`
- `skills.lock` exists and contains a `pdf` entry with:
  - `source`: `https://github.com/anthropics/skills.git` (shorthand expanded to full URL)
  - `path`: repo-relative path to the skill directory
  - `ref`: full 40-character lowercase hex SHA
  - `integrity`: `sha256:` followed by 64 hex chars
- Skill files exist at `.agents/skills/pdf/` including `SKILL.md`
- `.agents/skills/pdf/.skills-lock` metadata file exists with matching `ref` and `integrity`
- Exit code 0

### 1.2 Add with a full Git URL
1. Run `skills-lock add https://github.com/anthropics/skills.git --skill algorithmic-art`

**Expected:** same as 1.1; `source` in the lockfile is the URL as given.

### 1.3 Second add preserves the first entry, keys sorted
1. Run 1.1, then 1.2

**Expected:** `skills.lock` contains both entries; keys appear in alphabetical order (`algorithmic-art` before `pdf`); the `pdf` entry is unchanged; file ends with a trailing newline.

### 1.4 Missing --skill flag
1. Run `skills-lock add anthropics/skills`

**Expected:** error `Please specify a skill name with --skill <name>`, exit code 1, no `skills.lock` created.

### 1.5 Unknown skill name lists available skills
1. Run `skills-lock add anthropics/skills --skill does-not-exist`

**Expected:** error naming the missing skill and listing available skills found in the repo, exit code 1, no lockfile entry written, no leftover temp clones (check your temp dir for `skills-lock-*` directories).

### 1.6 Re-adding an already-pinned skill is skipped
1. Run 1.1 twice

**Expected:** second run prints `pdf is already in skills.lock (ref: <sha>). Use --force to reinstall.`, exit code 0, lockfile unchanged (compare file contents before/after).

### 1.7 --force re-pins at the latest commit
1. Run 1.1
2. Manually edit `skills.lock`: change `pdf`'s `ref` to another valid 40-char SHA from the repo's history (e.g. `git ls-remote https://github.com/anthropics/skills.git HEAD~1` or any older commit)
3. Run `skills-lock add anthropics/skills --skill pdf --force`

**Expected:** skill reinstalls; `ref` in `skills.lock` is the repo's current HEAD SHA; `integrity` updated to match.

### 1.8 Nonexistent repository
1. Run `skills-lock add anthropics/this-repo-does-not-exist-xyz --skill pdf`

**Expected:** clean error — the raw git clone failure prefixed with `Error:` (git's message may span multiple lines) — with no JavaScript stack trace, exit code 1, and no leftover `skills-lock-*` directories in the OS temp dir.

---

## 2. install — restoring from the lockfile

### 2.1 Fresh restore (the teammate scenario)
1. In directory A: run 1.1 and 1.2, then copy only `skills.lock` into a fresh directory B
2. In directory B: run `skills-lock install`

**Expected:**
- Output per skill: `<name> — installing from <source> at <7-char sha>...`
- Final line `Installed 2 skill(s).`
- Both skills exist under `.agents/skills/` with `SKILL.md` and `.skills-lock` metadata
- Installed content matches the pinned commit (spot check: `integrity` in metadata equals the value in `skills.lock`)
- Exit code 0

### 2.2 Pinned restore, not latest
Precondition: the source repo has commits newer than the pinned ref (use the manual-edit technique from 1.7 to pin an older SHA, and update `integrity`: run install once, let it fail or recompute, or simply delete the `integrity` field for this test).
1. Pin an older SHA in `skills.lock` (no `integrity` field)
2. Run `skills-lock install` in a fresh directory with that lockfile

**Expected:** the installed `.skills-lock` metadata `ref` equals the older pinned SHA, not the repo's HEAD. This is the core reproducibility guarantee.

### 2.3 Idempotent second run
1. Run 2.1, then run `skills-lock install` again in directory B

**Expected:** each skill prints `<name> — already installed`; final line `All skills verified.`; exit code 0; no network cloning happens (should complete in ~1s).

### 2.4 Drift: wrong ref triggers reinstall
1. After 2.1, edit `.agents/skills/pdf/.skills-lock` and change `ref` to a different 40-char SHA
2. Run `skills-lock install`

**Expected:** `pdf — reinstalling (wrong ref: have <sha7>, want <sha7>)...`; afterwards metadata matches the lockfile again.

### 2.5 Drift: modified files trigger reinstall
1. After 2.1, append a line to `.agents/skills/pdf/SKILL.md`
2. Run `skills-lock install`

**Expected:** `pdf — reinstalling (files modified on disk)...`; the edit is reverted (file matches pristine content); integrity verified after reinstall.

### 2.6 Drift: missing metadata triggers reinstall
1. After 2.1, delete `.agents/skills/pdf/.skills-lock`
2. Run `skills-lock install`

**Expected:** `pdf — reinstalling (installed outside skills-lock, no metadata)...`; metadata file recreated.

### 2.7 --force reinstalls everything
1. After 2.3 (everything verified), run `skills-lock install --force`

**Expected:** every skill prints `<name> — reinstalling at <sha7>...`; final `Installed 2 skill(s).`; exit code 0.

### 2.8 No lockfile
1. In an empty directory, run `skills-lock install`

**Expected:** error `No skills.lock found. Run 'skills-lock add' to start.`, exit code 1.

### 2.9 Empty lockfile
1. Create `skills.lock` containing `{"version": 1, "skills": {}}`
2. Run `skills-lock install`

**Expected:** `No skills in lockfile.`, exit code 0.

### 2.10 Integrity mismatch between lockfile and source aborts
1. After 1.1, edit `skills.lock`: change one hex character of `pdf`'s `integrity`
2. Delete `.agents` and run `skills-lock install`

**Expected:** install fails with `Integrity check failed for 'pdf': content does not match skills.lock.` and a hint to re-pin with `add --force`; exit code 1.

---

## 3. check — drift detection

Setup for this section: run 1.1 (pdf pinned and installed), then apply the listed mutation.

| # | Mutation | Expected report line | Exit |
|---|----------|---------------------|------|
| 3.1 | none | `All skills verified.` | 0 |
| 3.2 | `rm -rf .agents/skills/pdf` | `Missing (in lockfile but not installed):` + `- pdf` | 1 |
| 3.3 | edit `.skills-lock` metadata `ref` to a different SHA | `Wrong ref (run 'skills-lock install' to fix):` + `- pdf: have <sha7>, want <sha7>` | 1 |
| 3.4 | append text to `.agents/skills/pdf/SKILL.md` | `Modified on disk (run 'skills-lock install' to restore):` + `- pdf` | 1 |
| 3.5 | delete `.agents/skills/pdf/.skills-lock` | `Unverified (installed outside skills-lock — run 'skills-lock install' to pin):` + `- pdf` | 1 |
| 3.6 | create `.agents/skills/rogue/SKILL.md` by hand | `Extra (installed but not in lockfile — pin with 'skills-lock add' or uninstall with 'npx skills remove'):` + `- rogue` | 1 |
| 3.7 | no `skills.lock` in directory | `No skills.lock found. Run 'skills-lock add' to start.` | 1 |

Additional checks:
- **3.8 Tamper detection does not trust metadata:** after 3.4's edit, also recompute nothing — leave `.skills-lock` untouched (it still holds the old hash). `check` must still report Modified, because it hashes actual disk files rather than trusting metadata.
- **3.9 Combined report:** apply 3.2 to one skill and 3.6 simultaneously; both sections appear in one run, exit code 1.
- **3.10 CI usage:** `skills-lock check || echo FAIL` prints `FAIL` when drifted, prints nothing extra when clean.

---

## 4. Lockfile validation

Each case: create `skills.lock` with the given content, run `skills-lock install` (or `check`), expect a clean error and exit code 1.

| # | Content | Expected error contains |
|---|---------|------------------------|
| 4.1 | `not valid json {{{` | Node's native JSON parse error (e.g. `is not valid JSON`), surfaced cleanly with no stack trace |
| 4.2 | `{"version": 99, "skills": {}}` | `Unsupported lockfile version: 99` |
| 4.3 | valid entry but `ref` is a branch name (`"main"`) | `must be a full 40-character commit SHA` |
| 4.4 | valid entry but `ref` is a short SHA (7 chars) | `must be a full 40-character commit SHA` |
| 4.5 | entry missing `source` | `missing or invalid field 'source'` |
| 4.6 | `integrity` not of form `sha256:<64 hex>` | `invalid integrity` |

---

## 5. Removed commands stay removed

| # | Command | Expected |
|---|---------|----------|
| 5.1 | `skills-lock update` | `unknown command`, exit code ≠ 0 |
| 5.2 | `skills-lock remove pdf` | `unknown command`, exit code ≠ 0 |
| 5.3 | `skills-lock --help` | lists exactly `install`, `add`, `check` (plus `help`); no `update`/`remove` |
| 5.4 | `skills-lock --version` | prints the version from package.json |

Documented replacement workflows (verify they actually work end to end):
- **5.5 Update a pin:** `skills-lock add anthropics/skills --skill pdf --force` re-pins at latest HEAD (see 1.7).
- **5.6 Remove a skill:** `npx skills remove --skill pdf --yes`, then delete the `pdf` entry from `skills.lock` by hand; `skills-lock check` then reports `All skills verified.`

---

## 6. Environment failures

### 6.1 Upstream skills CLI unavailable
1. Simulate `npx skills` being unavailable (e.g. block it with a fake `npx` shim earlier in PATH that exits 127 when called with `skills`, or run on a machine without network to the npm registry)
2. Run `skills-lock install --force` with a valid non-empty lockfile

**Expected:** clean error `The 'skills' CLI is not available.` with the hint `npm install -g skills`; exit code 1; no partial state written.

### 6.2 Network loss mid-operation
1. Disconnect network, run `skills-lock add anthropics/skills --skill pdf`

**Expected:** clean `Error: ...` from the failed clone (no stack trace), exit code 1, no `skills.lock` created, no orphaned `skills-lock-*` temp directories.

### 6.3 Read-only working directory
1. `chmod -w .` on the test directory, run `skills-lock add ...`

**Expected:** clean error, exit code 1. Restore with `chmod +w .`.

---

## 7. Cross-platform / cross-agent spot checks

- **7.1** Repeat 1.1 and 2.1 on macOS and Linux. (Windows is currently untested/unsupported — note results if attempted.)
- **7.2** After install, verify agent symlinks work: `.claude/skills/<name>` is a symlink pointing at `.agents/skills/<name>` (created by upstream `npx skills`), and `check`/`install` still verify correctly through it. **Precondition:** upstream only creates a per-agent symlink when that agent's marker directory (e.g. `.claude/`) already exists in the project — create an empty `.claude/` directory before running `add`.
- **7.3** Run `skills-lock install` twice in a row and diff `skills.lock` before/after — the file must be byte-identical (deterministic output, sorted keys, trailing newline).

---

## 8. End-to-end acceptance scenario

The one flow that must always work — mirrors the README pitch:

1. Developer A, empty project: `skills-lock add anthropics/skills --skill pdf`, `skills-lock add anthropics/skills --skill algorithmic-art`, commit `skills.lock` to a git repo
2. Time passes; upstream repo gains new commits
3. Developer B clones the repo (no `.agents/` directory) and runs `skills-lock install`
4. `skills-lock check` on B's machine prints `All skills verified.`
5. B's installed skill content is **identical** to A's (compare `integrity` values in both machines' `.skills-lock` metadata — they must match each other and `skills.lock`)

Pass criteria: step 5 holds even though upstream HEAD moved between A and B.
