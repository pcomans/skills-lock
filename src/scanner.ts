import { readdir, access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { InstalledSkill } from "./types.js";
import { readSkillMetadata } from "./installer.js";

const SKILLS_DIR = ".agents/skills";

/**
 * Scan the canonical .agents/skills/ directory for installed skills.
 * A skill is a directory (or symlink to a directory) containing a SKILL.md file.
 */
export async function scanInstalledSkills(): Promise<InstalledSkill[]> {
  try {
    await access(SKILLS_DIR);
  } catch {
    return [];
  }

  const entries = await readdir(SKILLS_DIR);
  const skills: InstalledSkill[] = [];

  for (const name of entries) {
    const diskPath = resolve(SKILLS_DIR, name);

    // Follow symlinks — stat() resolves them, unlike lstat()
    let isDir = false;
    try {
      const s = await stat(diskPath);
      isDir = s.isDirectory();
    } catch {
      continue;
    }

    if (!isDir) continue;

    let hasSkillMd = false;
    try {
      await access(resolve(diskPath, "SKILL.md"));
      hasSkillMd = true;
    } catch {
      // No SKILL.md — still count it as installed
    }

    const metadata = await readSkillMetadata(diskPath) ?? undefined;

    skills.push({ name, diskPath, hasSkillMd, metadata });
  }

  return skills;
}
