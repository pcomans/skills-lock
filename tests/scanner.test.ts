import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
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
  it("returns empty array when skill directories do not exist", async () => {
    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("returns empty array when .agents/skills/ is empty", async () => {
    await mkdir(".agents/skills", { recursive: true });
    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  it("finds skills in canonical .agents/skills first", async () => {
    const skillDir = join(".agents/skills/pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF Skill");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("pdf");
    expect(result[0].diskPath).toBe(join(".agents/skills", "pdf"));
    expect(result[0].hasSkillMd).toBe(true);
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

  it("deduplicates across .agents and .claude by preferring .agents", async () => {
    await mkdir(".agents/skills/pdf", { recursive: true });
    await writeFile(".agents/skills/pdf/SKILL.md", "# Canonical");

    await mkdir(".claude/skills/pdf", { recursive: true });
    await writeFile(".claude/skills/pdf/readme.txt", "fallback");

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("pdf");
    expect(result[0].diskPath).toBe(join(".agents/skills", "pdf"));
    expect(result[0].hasSkillMd).toBe(true);
  });

  it("ignores files (non-directories) in skills dir", async () => {
    await mkdir(".claude/skills", { recursive: true });
    await writeFile(".claude/skills/stray-file.txt", "not a skill");

    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  // Symlink contract: npx skills installs skills via symlinks from agent-specific dirs
  // (.claude/skills, .cursor/skills, etc.) to the canonical .agents/skills/ location.
  // scanner.ts uses stat() (which resolves symlinks) rather than lstat(), so a skill
  // directory that is a symlink to a real directory is correctly found.
  it("follows symlinks to skill directories (stat resolves, lstat would not)", async () => {
    const realSkillDir = join(tmpDir, "real-skill-source");
    await mkdir(realSkillDir, { recursive: true });
    await writeFile(join(realSkillDir, "SKILL.md"), "# Real Skill");

    await mkdir(join(tmpDir, ".agents/skills"), { recursive: true });
    await symlink(realSkillDir, join(tmpDir, ".agents/skills/my-skill"));

    const result = await scanInstalledSkills();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-skill");
    expect(result[0].hasSkillMd).toBe(true);
  });

  it("skips broken symlinks gracefully (stat throws, entry is silently skipped)", async () => {
    await mkdir(join(tmpDir, ".agents/skills"), { recursive: true });
    // Symlink whose target does not exist — stat() throws, scan continues
    await symlink("/nonexistent/target/path", join(tmpDir, ".agents/skills/broken-skill"));

    const result = await scanInstalledSkills();
    expect(result).toEqual([]);
  });

  // XDG config paths contract: npx skills installs global skills to ~/.config/agents/skills
  // (OpenCode, Amp, Goose) or ~/.cursor/skills, etc. skills-lock's scanInstalledSkills
  // only scans project-level dirs (.agents/skills, .claude/skills). Global skills are
  // intentionally out of scope — skills-lock manages project-level reproducibility.
  it("only scans project-level dirs — global XDG paths are out of scope", async () => {
    // Verify that skills in neither .agents/skills nor .claude/skills are not found
    // (there is nothing to mock here — this is a documentation test for the contract)
    const result = await scanInstalledSkills();
    expect(result).toEqual([]); // no project-level skills installed
  });
});
