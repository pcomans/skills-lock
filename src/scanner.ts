import { readdir, access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { InstalledSkill } from "./types.js";

/**
 * Known skill directories for different AI agents.
 * .agents/skills/ is the canonical location (used by npx skills).
 * .claude/skills/ contains symlinks pointing to .agents/skills/.
 * We scan the canonical location first; .claude/skills/ is a fallback
 * for setups that don't use the .agents/ convention.
 */
const SKILL_DIRS = [".agents/skills", ".claude/skills"];

/**
 * Scan known skill directories for installed skills.
 * A skill is a directory (or symlink to a directory) containing a SKILL.md file.
 * Deduplicates by skill name across directories.
 */
export async function scanInstalledSkills(): Promise<InstalledSkill[]> {
  const seen = new Set<string>();
  const skills: InstalledSkill[] = [];

  for (const dir of SKILL_DIRS) {
    try {
      await access(dir);
    } catch {
      continue;
    }

    const entries = await readdir(dir);

    for (const name of entries) {
      if (seen.has(name)) continue;

      const diskPath = join(dir, name);

      // Follow symlinks — stat() resolves them, unlike lstat()
      let isDir = false;
      try {
        const s = await stat(diskPath);
        isDir = s.isDirectory();
      } catch {
        continue;
      }

      if (!isDir) continue;

      const skillMdPath = join(diskPath, "SKILL.md");

      let hasSkillMd = false;
      try {
        await access(skillMdPath);
        hasSkillMd = true;
      } catch {
        // No SKILL.md — still count it as installed
      }

      seen.add(name);
      skills.push({
        name,
        diskPath,
        hasSkillMd,
      });
    }
  }

  return skills;
}
