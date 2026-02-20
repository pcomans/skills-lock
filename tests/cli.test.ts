/**
 * CLI command tests.
 *
 * These tests run the built CLI binary as a subprocess so they exercise the
 * real command dispatch and output. They use pre-written lockfiles so no
 * network calls are made.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

const CLI = resolve("dist/cli.js");

const SHA_A = "a".repeat(40);

async function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa("node", [CLI, ...args], {
    cwd,
    reject: false,
    env: env ? { ...process.env, ...env } : undefined,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

/**
 * Creates a fake `npx` script in a temp bin dir that rejects any
 * `npx skills ...` invocation with exit code 127. Returns the bin dir path
 * so callers can prepend it to PATH.
 */
async function makeFakeNpxDir(tmpDir: string): Promise<string> {
  const binDir = join(tmpDir, "fake-bin");
  await execa("mkdir", ["-p", binDir]);
  const realNpx = (await execa("which", ["npx"])).stdout.trim();
  const script = `#!/bin/sh\nif [ "$1" = "skills" ]; then\n  echo "error: 'skills' is not installed" >&2\n  exit 127\nfi\nexec ${realNpx} "$@"\n`;
  await writeFile(join(binDir, "npx"), script);
  await chmod(join(binDir, "npx"), 0o755);
  return binDir;
}

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "skills-lock-cli-test-"));
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("add", () => {
  it("skips and warns when skill is already in skills.lock", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: {
          pdf: {
            source: "https://github.com/anthropics/skills.git",
            path: "skills/pdf",
            ref: SHA_A,
          },
        },
      }) + "\n"
    );

    const { stdout, exitCode } = await runCli(
      ["add", "anthropics/skills", "--skill", "pdf"],
      tmpDir
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("already in skills.lock");
    expect(stdout).toContain("--force");

    // Lockfile should be unchanged
    const raw = await readFile(join(tmpDir, "skills.lock"), "utf-8");
    const lockfile = JSON.parse(raw);
    expect(lockfile.skills.pdf.ref).toBe(SHA_A);
  });

  it("requires --skill flag", async () => {
    const { exitCode, stderr, stdout } = await runCli(
      ["add", "anthropics/skills"],
      tmpDir
    );

    expect(exitCode).toBe(1);
    expect(stderr + stdout).toMatch(/skill/i);
  });
});

describe("update", () => {
  it("prints 'No skills to update.' when lockfile has no skills", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({ version: 1, skills: {} }) + "\n"
    );

    const { stdout, exitCode } = await runCli(["update"], tmpDir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No skills to update.");
  });

  it("fails with a clear error when skills.lock does not exist", async () => {
    const { exitCode, stderr } = await runCli(["update"], tmpDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("No skills.lock found");
  });
});

describe("install", () => {
  it("fails with a clear error when skills.lock does not exist", async () => {
    const { exitCode, stderr } = await runCli(["install"], tmpDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("No skills.lock found");
  });

  it("reports nothing to install when lockfile has no skills", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({ version: 1, skills: {} }) + "\n"
    );

    const { stdout, exitCode } = await runCli(["install"], tmpDir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No skills in lockfile");
  });

  it("reports 'All skills verified.' when metadata matches lockfile", async () => {
    const integrity = `sha256:${"a".repeat(64)}`;
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: {
          pdf: { source: "https://github.com/anthropics/skills.git", path: "skills/pdf", ref: SHA_A, integrity },
        },
      }) + "\n"
    );
    // Create the skill dir with matching metadata
    const skillDir = join(tmpDir, ".agents", "skills", "pdf");
    await execa("mkdir", ["-p", skillDir]);
    await writeFile(join(skillDir, "SKILL.md"), "# PDF");
    await writeFile(join(skillDir, ".skills-lock"), JSON.stringify({ ref: SHA_A, integrity }) + "\n");

    const { stdout, exitCode } = await runCli(["install"], tmpDir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("All skills verified.");
  });
});

describe("check", () => {
  const integrity = `sha256:${"a".repeat(64)}`;

  async function makeSkillOnDisk(name: string, meta?: { ref: string; integrity: string }) {
    const skillDir = join(tmpDir, ".agents", "skills", name);
    await execa("mkdir", ["-p", skillDir]);
    await writeFile(join(skillDir, "SKILL.md"), "# Skill");
    if (meta) {
      await writeFile(join(skillDir, ".skills-lock"), JSON.stringify(meta) + "\n");
    }
  }

  it("reports 'All skills verified.' when everything matches", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: { pdf: { source: "https://github.com/anthropics/skills.git", path: "skills/pdf", ref: SHA_A, integrity } },
      }) + "\n"
    );
    await makeSkillOnDisk("pdf", { ref: SHA_A, integrity });

    const { stdout, exitCode } = await runCli(["check"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("All skills verified.");
  });

  it("reports missing skill with exit 1", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: { pdf: { source: "https://github.com/anthropics/skills.git", path: "skills/pdf", ref: SHA_A } },
      }) + "\n"
    );

    const { stdout, exitCode } = await runCli(["check"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Missing");
    expect(stdout).toContain("pdf");
  });

  it("reports wrong ref with exit 1", async () => {
    const wrongRef = "b".repeat(40);
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: { pdf: { source: "https://github.com/anthropics/skills.git", path: "skills/pdf", ref: SHA_A, integrity } },
      }) + "\n"
    );
    await makeSkillOnDisk("pdf", { ref: wrongRef, integrity });

    const { stdout, exitCode } = await runCli(["check"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Wrong ref");
    expect(stdout).toContain("pdf");
  });

  it("reports modified files with exit 1", async () => {
    const differentIntegrity = `sha256:${"b".repeat(64)}`;
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: { pdf: { source: "https://github.com/anthropics/skills.git", path: "skills/pdf", ref: SHA_A, integrity } },
      }) + "\n"
    );
    // metadata ref matches but integrity differs
    await makeSkillOnDisk("pdf", { ref: SHA_A, integrity: differentIntegrity });

    const { stdout, exitCode } = await runCli(["check"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Modified");
    expect(stdout).toContain("pdf");
  });

  it("reports unverified skill (no metadata) with exit 1", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: { pdf: { source: "https://github.com/anthropics/skills.git", path: "skills/pdf", ref: SHA_A } },
      }) + "\n"
    );
    await makeSkillOnDisk("pdf"); // no metadata

    const { stdout, exitCode } = await runCli(["check"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Unverified");
  });

  it("reports extra skill with exit 1", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({ version: 1, skills: {} }) + "\n"
    );
    await makeSkillOnDisk("rogue-skill");

    const { stdout, exitCode } = await runCli(["check"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Extra");
    expect(stdout).toContain("rogue-skill");
  });
});

describe("init", () => {
  it("is not a recognised command", async () => {
    const { exitCode, stderr, stdout } = await runCli(["init"], tmpDir);

    expect(exitCode).not.toBe(0);
    expect(stderr + stdout).toMatch(/unknown command/i);
  });
});

describe("skills CLI not available", () => {
  let fakeEnv: Record<string, string>;

  beforeEach(async () => {
    const binDir = await makeFakeNpxDir(tmpDir);
    fakeEnv = { PATH: `${binDir}:${process.env.PATH}` };
  });

  it("install --force gives a clear error", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({
        version: 1,
        skills: {
          pdf: {
            source: "https://github.com/anthropics/skills.git",
            path: "skills/pdf",
            ref: SHA_A,
          },
        },
      }) + "\n"
    );

    const { exitCode, stderr } = await runCli(
      ["install", "--force"],
      tmpDir,
      fakeEnv
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("skills");
    expect(stderr).toContain("npm install");
  });

  it("remove gives a clear error", async () => {
    await writeFile(
      join(tmpDir, "skills.lock"),
      JSON.stringify({ version: 1, skills: {} }) + "\n"
    );

    const { exitCode, stderr } = await runCli(
      ["remove", "pdf"],
      tmpDir,
      fakeEnv
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("skills");
    expect(stderr).toContain("npm install");
  });
});
