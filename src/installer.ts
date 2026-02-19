import { execa } from "execa";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { cloneAtRef, cleanupClone } from "./resolver.js";

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
