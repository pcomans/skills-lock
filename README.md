# skills-lock

A lockfile for AI agent skills. Pin, share, and reproduce skill installations across your team.

**One file. Whole team. Same AI skills.**

## The Problem

Your team uses [Agent Skills](https://agentskills.io) — but there's no way to ensure everyone has the same skills installed. New team members have to manually `npx skills add` each one. CI environments start from scratch every time.

## The Solution

`skills-lock` adds a committed `skills.lock` file that pins which skills your project uses, from where, at which version.

```
# Clone repo, install skills — done
npx skills-lock install
```

## Quick Start

```bash
# Already have skills installed? Generate the lockfile:
npx skills-lock init

# Or add skills one by one (installs + locks):
npx skills-lock add anthropics/skills --skill pdf
npx skills-lock add anthropics/skills --skill code-review

# Check what the lockfile looks like
cat skills.lock
```

```json
{
  "version": 1,
  "skills": {
    "code-review": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "code-review",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    },
    "pdf": {
      "source": "https://github.com/anthropics/skills.git",
      "path": "pdf",
      "ref": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    }
  }
}
```

## Commands

| Command | Description |
|---------|-------------|
| `skills-lock init` | Generate `skills.lock` from currently installed skills |
| `skills-lock install` | Install all skills from `skills.lock` |
| `skills-lock add <source> --skill <name>` | Install a skill and add it to `skills.lock` |
| `skills-lock remove <name>` | Remove a skill and delete it from `skills.lock` |
| `skills-lock update [name]` | Update skills to latest versions from source repos |
| `skills-lock check` | Compare installed skills against `skills.lock` |

## How It Works

`skills-lock` wraps [Vercel's `npx skills`](https://www.npmjs.com/package/skills) CLI. It adds a lockfile layer on top:

- **`add`** calls `npx skills add`, then records the source, path, and git ref in `skills.lock`
- **`install`** reads `skills.lock` and calls `npx skills add` for each missing skill
- **`check`** compares what's installed against what's locked
- **`update`** fetches the latest refs from source repos and updates the lockfile

## License

MIT
