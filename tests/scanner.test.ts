import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("returns empty array when .claude/skills/ does not exist", async () => {
    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("returns empty array when .claude/skills/ is empty", async () => {
    await mkdir(".claude/skills", { recursive: true });
    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("finds skill directories with SKILL.md", async () => {
    const skillDir = join(".claude/skills/pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF Skill");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("pdf");
    expect(result[0].hasSkillMd).toBe(true);
  });

  it("finds skill directories without SKILL.md", async () => {
    const skillDir = join(".claude/skills/custom");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "readme.txt"), "some content");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("custom");
    expect(result[0].hasSkillMd).toBe(false);
  });

  it("finds multiple skills", async () => {
    await mkdir(".claude/skills/pdf", { recursive: true });
    await mkdir(".claude/skills/review", { recursive: true });
    await writeFile(".claude/skills/pdf/SKILL.md", "# PDF");
    await writeFile(".claude/skills/review/SKILL.md", "# Review");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["pdf", "review"]);
  });

  it("ignores files (non-directories) in skills dir", async () => {
    await mkdir(".claude/skills", { recursive: true });
    await writeFile(".claude/skills/stray-file.txt", "not a skill");

    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });
});
