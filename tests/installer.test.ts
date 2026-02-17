import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
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
