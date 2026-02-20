import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

vi.mock("../src/resolver.js", () => ({
  cloneAtRef: vi.fn().mockResolvedValue("/tmp/skills-lock-mock123"),
  cleanupClone: vi.fn().mockResolvedValue(undefined),
}));

import { installSkill, removeSkill, computeSkillHash, writeSkillMetadata, readSkillMetadata } from "../src/installer.js";
import { execa } from "execa";
import { cloneAtRef, cleanupClone } from "../src/resolver.js";

const mockedExeca = vi.mocked(execa);
const mockedCloneAtRef = vi.mocked(cloneAtRef);
const mockedCleanupClone = vi.mocked(cleanupClone);

let tmpRepoDir: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  tmpRepoDir = undefined;
});

afterEach(async () => {
  if (tmpRepoDir) {
    await rm(tmpRepoDir, { recursive: true, force: true });
    tmpRepoDir = undefined;
  }
});

describe("installSkill", () => {
  it("calls npx skills add with source when no ref provided", async () => {
    await installSkill("anthropics/skills", "pdf");

    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "anthropics/skills", "--skill", "pdf", "--yes"],
      { stdio: "inherit" }
    );
    expect(mockedCloneAtRef).not.toHaveBeenCalled();
  });

  it("clones at ref and installs from local path when ref provided", async () => {
    const sha = "a".repeat(40);
    await installSkill("anthropics/skills", "pdf", sha);

    expect(mockedCloneAtRef).toHaveBeenCalledWith("anthropics/skills", sha);
    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "/tmp/skills-lock-mock123", "--skill", "pdf", "--yes"],
      { stdio: "inherit" }
    );
    expect(mockedCleanupClone).toHaveBeenCalledWith("/tmp/skills-lock-mock123");
  });

  it("uses pinned skillPath inside the cloned repo when provided", async () => {
    const sha = "c".repeat(40);
    tmpRepoDir = await mkdtemp(join(tmpdir(), "skills-lock-installer-"));
    const skillDir = join(tmpRepoDir, "document-skills", "pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# PDF");
    mockedCloneAtRef.mockResolvedValueOnce(tmpRepoDir);

    await installSkill("anthropics/skills", "pdf", sha, "document-skills/pdf");

    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", skillDir, "--skill", "pdf", "--yes"],
      { stdio: "inherit" }
    );
    expect(mockedCleanupClone).toHaveBeenCalledWith(tmpRepoDir);
  });

  it("fails fast when pinned skillPath has no SKILL.md", async () => {
    const sha = "d".repeat(40);
    tmpRepoDir = await mkdtemp(join(tmpdir(), "skills-lock-installer-"));
    mockedCloneAtRef.mockResolvedValueOnce(tmpRepoDir);

    await expect(
      installSkill("anthropics/skills", "pdf", sha, "document-skills/pdf")
    ).rejects.toThrow();

    expect(mockedExeca).not.toHaveBeenCalled();
    expect(mockedCleanupClone).toHaveBeenCalledWith(tmpRepoDir);
  });

  it("cleans up temp dir even if install fails", async () => {
    const sha = "b".repeat(40);
    mockedExeca.mockRejectedValueOnce(new Error("install failed"));

    await expect(installSkill("anthropics/skills", "pdf", sha)).rejects.toThrow(
      "install failed"
    );

    expect(mockedCleanupClone).toHaveBeenCalledWith("/tmp/skills-lock-mock123");
  });

  it("passes full URLs as source", async () => {
    await installSkill("https://github.com/acme/skills", "review");

    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "https://github.com/acme/skills", "--skill", "review", "--yes"],
      { stdio: "inherit" }
    );
  });

  it("uses local source + skillPath when installing without ref", async () => {
    await installSkill("/tmp/local-skills", "review", undefined, "tools/review");

    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "/tmp/local-skills/tools/review", "--skill", "review", "--yes"],
      { stdio: "inherit" }
    );
  });
});

describe("removeSkill", () => {
  it("calls npx skills remove with --skill flag and --yes", async () => {
    await removeSkill("pdf");

    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "remove", "--skill", "pdf", "--yes"],
      { stdio: "inherit" }
    );
  });
});

describe("computeSkillHash", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skills-hash-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces a sha256: prefixed hex string", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test");
    const hash = await computeSkillHash(tmpDir);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic for the same content", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test");
    const hash1 = await computeSkillHash(tmpDir);
    const hash2 = await computeSkillHash(tmpDir);
    expect(hash1).toBe(hash2);
  });

  it("changes when a file is modified", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test");
    const before = await computeSkillHash(tmpDir);
    await writeFile(join(tmpDir, "SKILL.md"), "# Modified");
    const after = await computeSkillHash(tmpDir);
    expect(before).not.toBe(after);
  });

  it("changes when a file is added", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test");
    const before = await computeSkillHash(tmpDir);
    await writeFile(join(tmpDir, "extra.txt"), "extra");
    const after = await computeSkillHash(tmpDir);
    expect(before).not.toBe(after);
  });

  it("excludes the .skills-lock metadata file from the hash", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test");
    const before = await computeSkillHash(tmpDir);
    await writeFile(join(tmpDir, ".skills-lock"), JSON.stringify({ ref: "abc", integrity: "sha256:xyz" }));
    const after = await computeSkillHash(tmpDir);
    expect(before).toBe(after);
  });

  it("includes subdirectory contents", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test");
    const before = await computeSkillHash(tmpDir);
    await mkdir(join(tmpDir, "assets"));
    await writeFile(join(tmpDir, "assets", "image.png"), "fake image");
    const after = await computeSkillHash(tmpDir);
    expect(before).not.toBe(after);
  });
});

describe("writeSkillMetadata / readSkillMetadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skills-meta-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const SHA = "a".repeat(40);
  const INTEGRITY = `sha256:${"b".repeat(64)}`;

  it("round-trips ref and integrity", async () => {
    await writeSkillMetadata(tmpDir, SHA, INTEGRITY);
    const meta = await readSkillMetadata(tmpDir);
    expect(meta).toEqual({ ref: SHA, integrity: INTEGRITY });
  });

  it("writes valid JSON to .skills-lock", async () => {
    await writeSkillMetadata(tmpDir, SHA, INTEGRITY);
    const raw = await readFile(join(tmpDir, ".skills-lock"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.ref).toBe(SHA);
    expect(parsed.integrity).toBe(INTEGRITY);
  });

  it("readSkillMetadata returns null when file does not exist", async () => {
    const meta = await readSkillMetadata(tmpDir);
    expect(meta).toBeNull();
  });

  it("readSkillMetadata returns null for malformed JSON", async () => {
    await writeFile(join(tmpDir, ".skills-lock"), "not json {{{");
    const meta = await readSkillMetadata(tmpDir);
    expect(meta).toBeNull();
  });

  it("readSkillMetadata returns null when fields are missing", async () => {
    await writeFile(join(tmpDir, ".skills-lock"), JSON.stringify({ ref: SHA }));
    const meta = await readSkillMetadata(tmpDir);
    expect(meta).toBeNull();
  });
});
