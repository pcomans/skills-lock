# skills-lock

A lockfile for AI agent skills. Pin, share, and reproduce skill installations across your team.

**One file. Whole team. Same AI skills.**

## The Problem

Your team uses [Agent Skills](https://agentskills.io) — but there's no way to ensure everyone has the same skills installed at the same version. New team members have to manually `npx skills add` each one. CI environments start from scratch every time. And `npx skills` always installs the latest version — there's no way to pin.

## The Solution

`skills-lock` adds a committed `skills.lock` file that pins which skills your project uses, from where, at which exact commit.

```bash
git clone your-project && npx skills-lock install
```

## Quick Start

```bash
# Create an empty lockfile
npx skills-lock init

# Add skills (installs + locks)
npx skills-lock add anthropics/skills --skill pdf
npx skills-lock add anthropics/skills --skill xlsx

# Commit the lockfile
git add skills.lock && git commit -m "Lock skills"
```

Your `skills.lock` now looks like this:

```json
{
  "version": 1,
  "skills": {
    "xlsx": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "document-skills/xlsx",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    },
    "pdf": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "document-skills/pdf",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    }
  }
}
```

A teammate clones the repo and runs:

```bash
npx skills-lock install
```

They get the exact same skills at the exact same versions.

## Commands

### `skills-lock init`

Creates an empty `skills.lock` file. Does nothing if one already exists.

```
$ skills-lock init
Created skills.lock
Add skills with "skills-lock add <source> --skill <name>".
```

### `skills-lock add <source> --skill <name>`

Installs a skill and records it in `skills.lock` with the exact commit SHA. If `skills.lock` doesn't exist yet, creates it.

The source can be GitHub shorthand or a full URL:

```bash
skills-lock add anthropics/skills --skill pdf
skills-lock add https://github.com/acme/internal-skills.git --skill review
```

What happens:

1. Clones the source repo and resolves the current HEAD commit SHA
2. Finds the skill's path within the repo (e.g. `document-skills/pdf`)
3. Installs the skill from the local checkout via `npx skills add`
4. Normalizes the source to a full URL (e.g. `anthropics/skills` becomes `https://github.com/anthropics/skills.git`)
5. Writes the entry to `skills.lock`
6. Cleans up the temporary clone

The clone-then-install order ensures the locked SHA always matches what was installed — there's no window where a new upstream commit could cause a mismatch.

```
$ skills-lock add anthropics/skills --skill pdf
Resolving pdf from anthropics/skills...
Installing pdf at a1b2c3d...
Added pdf to skills.lock (ref: a1b2c3d)
```

### `skills-lock install [--force]`

Reads `skills.lock` and installs any missing skills. Skills already present on disk are skipped.

Each skill is installed at the **exact commit SHA** recorded in the lockfile — not the latest version. This is done by cloning the source repo, checking out the pinned commit, and installing from the local checkout.

```
$ skills-lock install
  pdf — already installed
  xlsx — installing from https://github.com/anthropics/skills.git at a1b2c3d...
Installed 1 skill(s).
```

Use `--force` to reinstall all skills at their pinned refs, even if already present on disk. This is useful when installed skills may have drifted from the lockfile (e.g. someone ran `npx skills add` directly):

```
$ skills-lock install --force
  pdf — reinstalling at a1b2c3d...
  xlsx — reinstalling at a1b2c3d...
Installed 2 skill(s).
```

Exits with code 0. Fails with an error if `skills.lock` doesn't exist.

### `skills-lock remove <name>`

Removes a skill from disk via `npx skills remove` and deletes it from `skills.lock`.

```
$ skills-lock remove pdf
Removed pdf
```

Safe to run if the skill isn't in the lockfile — it still removes from disk.

### `skills-lock update [name]`

Checks source repos for newer commits. If a skill's source has new commits, removes and reinstalls the skill at the new ref, then updates `skills.lock`.

Update a single skill:

```bash
skills-lock update pdf
```

Update all skills:

```bash
skills-lock update
```

```
$ skills-lock update
Checking pdf...
  pdf — a1b2c3d → f4e5d6c
Checking xlsx...
  xlsx — already up to date
Updated 1 skill(s).
```

### `skills-lock check`

Compares installed skills against `skills.lock`. Reports missing skills (in lockfile but not installed) and extra skills (installed but not in lockfile).

```
$ skills-lock check
Missing (in lockfile but not installed):
  - xlsx
Extra (installed but not in lockfile):
  - custom-skill
```

Exits with code 0 if everything is in sync, code 1 if there are differences. Useful in CI:

```bash
npx skills-lock check || echo "Skills out of sync!"
```

## Lockfile Format

`skills.lock` is a JSON file with sorted keys for deterministic output:

```json
{
  "version": 1,
  "skills": {
    "<skill-name>": {
      "source": "<full git URL>",
      "path": "<path within repo to skill directory>",
      "ref": "<full 40-character commit SHA>"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `version` | Always `1`. Lockfiles with other versions are rejected. |
| `source` | Fully resolved Git URL (e.g. `https://github.com/anthropics/skills.git`). GitHub shorthand is expanded at lock time. |
| `path` | Path within the source repo to the skill directory containing `SKILL.md`. |
| `ref` | Full 40-character lowercase hex commit SHA. Tags, branch names, and short SHAs are rejected. |

Skills are sorted alphabetically by name. The file ends with a trailing newline.

## Security

- **Refs are full commit SHAs.** Tags and branch names are mutable — someone could point `v1.0` at malicious code. A full 40-character SHA is immutable and can't be changed without detection.
- **Sources are normalized.** GitHub shorthand like `anthropics/skills` is expanded to `https://github.com/anthropics/skills.git` at lock time, so the lockfile is unambiguous about where code comes from.
- **Install pins to the exact ref.** `skills-lock install` clones the source repo and checks out the exact commit from the lockfile — it does not install whatever is latest.

## Why not Claude Code marketplaces?

Claude Code has its own [plugin marketplace system](https://docs.anthropic.com/en/docs/claude-code/plugins) with built-in SHA pinning, managed restrictions, and team distribution via `.claude/settings.json`. If your team only uses Claude Code, that system already solves reproducibility — you don't need `skills-lock`.

`skills-lock` exists for teams using the [Agent Skills standard](https://agentskills.io) across multiple IDEs. When you run `npx skills add`, it installs the same `SKILL.md` files to Claude Code, Cursor, Codex, Gemini CLI, Kiro, and Antigravity simultaneously. There's no built-in lockfile or version pinning for this cross-IDE workflow — that's the gap `skills-lock` fills.

| | Claude Code Marketplaces | skills-lock |
|---|---|---|
| **Scope** | Claude Code only | All IDEs that support Agent Skills |
| **Unit** | Plugins (commands, agents, hooks, MCP servers, skills) | Skills (`SKILL.md` files) |
| **Pinning** | Built-in (`sha` field on plugin sources) | Added by skills-lock (`npx skills` has none) |
| **Team config** | `.claude/settings.json` | `skills.lock` (committed to repo) |

Use Claude Code marketplaces if everyone on your team uses Claude Code. Use `skills-lock` if your team uses a mix of AI coding tools and needs the same skills everywhere.

## How It Works

`skills-lock` wraps [Vercel's `npx skills`](https://www.npmjs.com/package/skills) CLI. Since `npx skills` has no `--ref` flag and always installs the latest version, `skills-lock` implements ref pinning itself:

1. Clones the source repo
2. Checks out the exact commit SHA from the lockfile
3. Runs `npx skills add <local-path> --skill <name> --yes` against the local checkout
4. Cleans up the temporary clone

Both `add` and `install` use this same clone-then-install approach, so the locked SHA always matches what was actually installed.

## License

MIT
