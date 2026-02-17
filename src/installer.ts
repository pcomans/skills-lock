import { execa } from "execa";
import { cloneAtRef, cleanupClone } from "./resolver.js";

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
  ref?: string
): Promise<void> {
  if (ref) {
    const repoDir = await cloneAtRef(source, ref);
    try {
      await execa(
        "npx",
        ["skills", "add", repoDir, "--skill", skillName, "--yes"],
        { stdio: "inherit" }
      );
    } finally {
      await cleanupClone(repoDir);
    }
  } else {
    await execa(
      "npx",
      ["skills", "add", source, "--skill", skillName, "--yes"],
      { stdio: "inherit" }
    );
  }
}

/**
 * Remove a skill by calling `npx skills remove`.
 * Uses --skill flag and --yes to skip confirmation prompts.
 */
export async function removeSkill(skillName: string): Promise<void> {
  await execa(
    "npx",
    ["skills", "remove", "--skill", skillName, "--yes"],
    { stdio: "inherit" }
  );
}
