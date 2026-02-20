/**
 * A single skill entry in the lockfile.
 */
export interface SkillEntry {
  /** Fully resolved Git URL (e.g. "https://github.com/anthropics/skills.git") */
  source: string;
  /** Path within the repo to the skill directory (contains SKILL.md) */
  path: string;
  /** Full 40-character commit SHA */
  ref: string;
  /** SHA-256 hash of the skill directory contents at the pinned ref (e.g. "sha256:abc123...") */
  integrity?: string;
}

/**
 * The skills.lock file schema.
 */
export interface Lockfile {
  version: 1;
  skills: Record<string, SkillEntry>;
}

/**
 * A skill discovered by the resolver from a git repo.
 */
export interface ResolvedSkill {
  /** Skill name (derived from directory name) */
  name: string;
  /** Source repo identifier */
  source: string;
  /** Path within the repo */
  path: string;
  /** Current commit SHA */
  ref: string;
}

/**
 * Metadata stored alongside an installed skill in .skills-lock.
 */
export interface SkillMetadata {
  /** Commit SHA the skill was installed from */
  ref: string;
  /** SHA-256 hash of the skill directory at install time */
  integrity: string;
}

/**
 * A skill found on disk by the scanner.
 */
export interface InstalledSkill {
  /** Skill name (directory name under .claude/skills/) */
  name: string;
  /** Absolute path on disk */
  diskPath: string;
  /** Whether a SKILL.md file exists */
  hasSkillMd: boolean;
  /** Metadata written by skills-lock at install time, if present */
  metadata?: SkillMetadata;
}

/**
 * Diff between two lockfile states.
 */
export interface LockfileDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * Options for the resolver.
 */
export interface ResolveOptions {
  /** Git ref to resolve (branch, tag, or SHA). Defaults to HEAD. */
  ref?: string;
  /** Specific skill path within the repo */
  skillPath?: string;
}
