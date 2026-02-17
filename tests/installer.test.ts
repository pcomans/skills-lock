import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

import { installSkill, removeSkill } from "../src/installer.js";
import { execa } from "execa";

const mockedExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("installSkill", () => {
  it("calls npx skills add with source, skill name, and --yes", async () => {
    await installSkill("anthropics/skills", "pdf");

    expect(mockedExeca).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "anthropics/skills", "--skill", "pdf", "--yes"],
      { stdio: "inherit" }
    );
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
