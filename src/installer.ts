import { execa } from "execa";
import { access, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cloneAtRef, cleanupClone } from "./resolver.js";
import type { SkillMetadata } from "./types.js";

export const SKILL_METADATA_FILE = ".skills-lock";

/**
 * Compute a deterministic SHA-256 hash of all files in a skill directory.
 * Files are walked recursively and sorted by path for reproducibility.
 * The .skills-lock metadata file is excluded from the hash.
 */
export async function computeSkillHash(skillDir: string): Promise<string> {
  const hash = createHash("sha256");

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = (await readdir(dir)).sort();
    for (const entry of entries) {
      if (entry === SKILL_METADATA_FILE) continue;
      const fullPath = join(dir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await walk(fullPath, relPath);
      } else {
        hash.update(`file:${relPath}\n`);
        hash.update(await readFile(fullPath));
        hash.update("\n");
      }
    }
  }

  await walk(skillDir, "");
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Write a .skills-lock metadata file inside a skill directory.
 */
export async function writeSkillMetadata(
  skillDir: string,
  ref: string,
  integrity: string
): Promise<void> {
  const meta: SkillMetadata = { ref, integrity };
  await writeFile(
    join(skillDir, SKILL_METADATA_FILE),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Read the .skills-lock metadata file from a skill directory.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function readSkillMetadata(
  skillDir: string
): Promise<SkillMetadata | null> {
  try {
    const raw = await readFile(join(skillDir, SKILL_METADATA_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.ref === "string" &&
      typeof parsed?.integrity === "string"
    ) {
      return parsed as SkillMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

let skillsCliChecked = false;

/**
 * Verify that `npx skills` is available, throwing a clear error if not.
 * Cached after the first successful check so subsequent calls are free.
 */
export async function checkSkillsCli(): Promise<void> {
  if (skillsCliChecked) return;

  const result = await execa("npx", ["skills", "--version"], {
    stdio: "pipe",
    reject: false,
  }).catch(() => null);

  if (!result || result.exitCode !== 0) {
    throw new Error(
      "The 'skills' CLI is not available.\n" +
      "Install it with: npm install -g skills"
    );
  }

  skillsCliChecked = true;
}

/**
 * Install a skill by calling `npx skills add`.
 *
 * When `ref` is provided, clones the source repo at that exact commit SHA
 * and installs from the local checkout — ensuring reproducible installs.
 * Without `ref`, installs the latest version from the source.
 */
export async function installSkill(
  source: string,
  skillName: string,
  ref?: string,
  skillPath?: string
): Promise<void> {
  await checkSkillsCli();
  if (ref) {
    const repoDir = await cloneAtRef(source, ref);
    try {
      const installSource = skillPath ? join(repoDir, skillPath) : repoDir;
      if (skillPath) {
        await access(join(installSource, "SKILL.md"));
      }

      await execa(
        "npx",
        ["skills", "add", installSource, "--skill", skillName, "--yes"],
        { stdio: "inherit" }
      );
    } finally {
      await cleanupClone(repoDir);
    }
  } else {
    const installSource = skillPath ? join(source, skillPath) : source;
    await execa(
      "npx",
      ["skills", "add", installSource, "--skill", skillName, "--yes"],
      { stdio: "inherit" }
    );
  }
}

/**
 * Remove a skill by calling `npx skills remove`.
 * Uses --skill flag and --yes to skip confirmation prompts.
 */
export async function removeSkill(skillName: string): Promise<void> {
  await checkSkillsCli();
  await execa(
    "npx",
    ["skills", "remove", "--skill", skillName, "--yes"],
    { stdio: "inherit" }
  );
}
