import { simpleGit } from "simple-git";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import type { ResolvedSkill, ResolveOptions } from "./types.js";

/**
 * Expand a source to a full Git URL.
 * Handles GitHub shorthand like "anthropics/skills".
 */
export function expandSource(source: string): string {
  if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("git@")) {
    return source;
  }

  // GitHub shorthand: owner/repo
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source)) {
    return `https://github.com/${source}.git`;
  }

  return source;
}

/**
 * Clone a source repo to a temporary directory.
 * Returns the path to the cloned repo.
 */
export async function resolveRepo(
  source: string,
  options?: ResolveOptions
): Promise<string> {
  const url = expandSource(source);
  const dir = await mkdtemp(join(tmpdir(), "skills-lock-"));
  const git = simpleGit();

  const cloneArgs = ["--depth", "1"];
  if (options?.ref) {
    cloneArgs.push("--branch", options.ref);
  }

  await git.clone(url, dir, cloneArgs);
  return dir;
}

/**
 * Clone a source repo at a specific commit SHA.
 * Unlike resolveRepo, this does a full clone to ensure the SHA is reachable,
 * then checks out the exact commit.
 */
export async function cloneAtRef(
  source: string,
  ref: string
): Promise<string> {
  const url = expandSource(source);
  const dir = await mkdtemp(join(tmpdir(), "skills-lock-"));
  const git = simpleGit();

  await git.clone(url, dir);
  const repoGit = simpleGit(dir);
  await repoGit.checkout(ref);
  return dir;
}

/**
 * Remove a temporary clone directory.
 */
export async function cleanupClone(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Get the current HEAD commit SHA for a repo directory.
 */
export async function resolveRef(repoDir: string): Promise<string> {
  const git = simpleGit(repoDir);
  const log = await git.log({ maxCount: 1 });

  if (!log.latest) {
    throw new Error(`No commits found in ${repoDir}`);
  }

  return log.latest.hash;
}

/**
 * Recursively find all SKILL.md files under a directory.
 * Returns paths relative to the base directory.
 */
async function findSkillMdFiles(
  dir: string,
  base: string = dir
): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
      results.push(...(await findSkillMdFiles(fullPath, base)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      // Return the path relative to base, without the SKILL.md filename
      const relativePath = relative(base, dir);
      const normalized = relativePath === "" ? "." : relativePath.split(sep).join("/");
      results.push(normalized);
    }
  }

  return results;
}

/**
 * Find all skill directories (containing SKILL.md) in a repo.
 */
export async function findSkills(
  repoDir: string,
  source: string
): Promise<ResolvedSkill[]> {
  const skillPaths = await findSkillMdFiles(repoDir);
  const ref = await resolveRef(repoDir);

  return skillPaths.map((path) => {
    const name = basename(path);
    return { name, source, path, ref };
  });
}
