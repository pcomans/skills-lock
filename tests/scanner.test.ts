import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanInstalledSkills } from "../src/scanner.js";

let originalCwd: string;
let tmpDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "scanner-test-"));
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("scanInstalledSkills", () => {
  it("returns empty array when skill directories do not exist", async () => {
    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("returns empty array when .agents/skills/ is empty", async () => {
    await mkdir(".agents/skills", { recursive: true });
    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("finds skills in .agents/skills", async () => {
    const skillDir = join(".agents/skills/pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF Skill");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("pdf");
    expect(result[0].diskPath).toBe(resolve(".agents/skills", "pdf"));
    expect(result[0].hasSkillMd).toBe(true);
  });

  it("finds skill directories without SKILL.md", async () => {
    const skillDir = join(".agents/skills/custom");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "readme.txt"), "some content");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("custom");
    expect(result[0].hasSkillMd).toBe(false);
  });

  it("finds multiple skills", async () => {
    await mkdir(".agents/skills/pdf", { recursive: true });
    await mkdir(".agents/skills/review", { recursive: true });
    await writeFile(".agents/skills/pdf/SKILL.md", "# PDF");
    await writeFile(".agents/skills/review/SKILL.md", "# Review");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["pdf", "review"]);
  });

  it("ignores files (non-directories) in skills dir", async () => {
    await mkdir(".agents/skills", { recursive: true });
    await writeFile(".agents/skills/stray-file.txt", "not a skill");

    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("includes metadata when .skills-lock file is present", async () => {
    const skillDir = join(".agents/skills/pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF");
    await writeFile(
      join(skillDir, ".skills-lock"),
      JSON.stringify({ ref: "a".repeat(40), integrity: `sha256:${"b".repeat(64)}` }) + "\n"
    );

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({
      ref: "a".repeat(40),
      integrity: `sha256:${"b".repeat(64)}`,
    });
  });

  it("metadata is undefined when .skills-lock file is absent", async () => {
    const skillDir = join(".agents/skills/pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].metadata).toBeUndefined();
  });
});
