# skills-lock

A lockfile for [`npx skills`](https://skills.sh/). Pin [Agent Skills](https://agentskills.io) to specific commits, commit the lockfile, and give every teammate a reproducible install.

```bash
npx skills-lock add anthropics/skills --skill pdf
npx skills-lock add anthropics/skills --skill xlsx
git add skills.lock && git commit -m "Lock skills"
```

A new teammate clones and runs one command:

```bash
npx skills-lock install
```

Missing skills are installed at the exact commit SHAs from the lockfile. Already-installed skills are skipped by name; use `--force` to re-pin everything.

[`npx skills`](https://skills.sh/) has no `--ref` flag, no lockfile, and no way to pin. `skills-lock` adds a committed `skills.lock` file that records the Git commit SHA for each skill, similar to how `package-lock.json` works for npm.

## Quick start

**Add skills (installs them and records the current commit SHA):**

```bash
npx skills-lock add anthropics/skills --skill pdf
npx skills-lock add anthropics/skills --skill algorithmic-art
```

Your `skills.lock` now looks like this:

```json
{
  "version": 1,
  "skills": {
    "algorithmic-art": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "skills/algorithmic-art",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    },
    "pdf": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "skills/pdf",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    }
  }
}
```

**Commit the lockfile:**

```bash
git add skills.lock && git commit -m "Lock skills"
```

**Restore skills from the lockfile (on another machine, in CI, etc.):**

```bash
npx skills-lock install
```

## Commands

All commands use the `npx skills-lock` prefix. You can also install globally with `npm install -g skills-lock`.

### add

Installs a skill and pins it in `skills.lock` at the current commit SHA. Creates the lockfile if it does not exist yet.

```
npx skills-lock add <source> --skill <name>
```

The source can be GitHub shorthand or a full URL:

```
npx skills-lock add anthropics/skills --skill pdf
npx skills-lock add https://github.com/acme/internal-skills.git --skill review
```

If the skill is already in `skills.lock`, `add` skips it. Use `--force` to reinstall and re-pin at the latest commit:

```
npx skills-lock add anthropics/skills --skill pdf --force
```

Under the hood, `add` clones the source repo first, resolves the HEAD commit SHA, then installs from that local checkout. The skill name must match a discovered `SKILL.md` entry in the repo or the command fails. This clone-then-install order means the locked SHA always matches what was installed.

Example output:

```
Resolving pdf from anthropics/skills...
Installing pdf at a1b2c3d...
Added pdf to skills.lock (ref: a1b2c3d)
```

### install

Reads `skills.lock` and installs any missing skills at their pinned commit SHAs. Skills already present on disk are skipped.

```
npx skills-lock install
```

Example output:

```
  pdf — already installed
  xlsx — installing from https://github.com/anthropics/skills.git at a1b2c3d...
Installed 1 skill(s).
```

Use `--force` to reinstall all skills, even those already on disk. This is useful when someone ran `npx skills add` directly and the installed version may have drifted from the lockfile:

```
npx skills-lock install --force
```

Fails with an error if `skills.lock` does not exist.

### remove

Removes a skill from disk (via `npx skills remove`) and deletes its entry from `skills.lock`.

```
npx skills-lock remove <name>
```

Safe to run even if the skill is not in the lockfile -- it still removes from disk.

### update

Checks source repos for newer commits. If a skill has new commits upstream, reinstalls it at the latest ref and updates `skills.lock`.

Update a single skill:

```
npx skills-lock update pdf
```

Update all skills:

```
npx skills-lock update
```

Example output:

```
Checking pdf...
  pdf — a1b2c3d → f4e5d6c
Checking xlsx...
  xlsx — already up to date
Updated 1 skill(s).
```

### check

Compares installed skills against `skills.lock`. Reports missing skills (in lockfile but not installed) and extra skills (installed but not in lockfile).

```
npx skills-lock check
```

Exit code 0 if everything matches, exit code 1 if there are differences. Useful in CI:

```
npx skills-lock check || echo "Skills out of sync -- run npx skills-lock install"
```

## Lockfile format

`skills.lock` is a JSON file. Keys are sorted alphabetically for deterministic diffs.

```json
{
  "version": 1,
  "skills": {
    "pdf": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "skills/pdf",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    },
    "xlsx": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "skills/xlsx",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `version` | Always `1`. Lockfiles with other versions are rejected. |
| `source` | Full Git URL. GitHub shorthand (e.g. `anthropics/skills`) is expanded at lock time. |
| `path` | Path within the source repo to the skill directory (the one containing `SKILL.md`). |
| `ref` | Full 40-character lowercase hex commit SHA. Tags, branch names, and short SHAs are rejected. |

The file ends with a trailing newline.

## Security

Refs in `skills.lock` must be full 40-character commit SHAs. Tags, branch names, and short SHAs are rejected. GitHub shorthand is expanded to full URLs at lock time so the lockfile is unambiguous about where code comes from.

## How it works

`skills-lock` wraps [Vercel's `npx skills`](https://www.npmjs.com/package/skills) CLI. Since `npx skills` has no ref pinning, `skills-lock` implements it:

1. Clones the source repo to a temporary directory
2. Checks out the exact commit SHA from the lockfile
3. Runs `npx skills add <local-path> --skill <name> --yes` against the local checkout
4. Cleans up the temporary clone

Both `add` and `install` use this same clone-then-install approach, so every newly installed skill is guaranteed to match its lockfile ref. Skills already on disk are skipped unless you pass `--force`.

## Why not Claude Code marketplaces?

Claude Code has its own [plugin marketplace](https://docs.anthropic.com/en/docs/claude-code/plugins) with built-in SHA pinning via `.claude/settings.json`. If your whole team uses Claude Code, you don't need this. `skills-lock` is for teams using the [Agent Skills standard](https://agentskills.io) across multiple IDEs (Cursor, Codex, Gemini CLI, Kiro, Antigravity, etc.) where there is no built-in lockfile.

## Build from source

```bash
git clone https://github.com/pcomans/skills-lock.git
cd skills-lock
npm install
npm run build
```

Run from the local directory:

```bash
npx . init
npx . add anthropics/skills --skill pdf
npx . install
```

Or link globally:

```bash
npm link
skills-lock init
```

## License

MIT
