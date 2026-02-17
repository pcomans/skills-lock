import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

vi.mock("../src/resolver.js", () => ({
  cloneAtRef: vi.fn().mockResolvedValue("/tmp/skills-lock-mock123"),
  cleanupClone: vi.fn().mockResolvedValue(undefined),
}));

import { installSkill, removeSkill } from "../src/installer.js";
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
