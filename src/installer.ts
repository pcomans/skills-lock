import { execa } from "execa";

/**
 * Install a skill by calling `npx skills add`.
 * Uses --skill flag to select a specific skill and --yes to skip prompts.
 */
export async function installSkill(
  source: string,
  skillName: string
): Promise<void> {
  await execa(
    "npx",
    ["skills", "add", source, "--skill", skillName, "--yes"],
    { stdio: "inherit" }
  );
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
