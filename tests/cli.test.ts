/**
 * CLI command tests.
 *
 * These tests run the built CLI binary as a subprocess so they exercise the
 * real command dispatch and output. They use pre-written lockfiles so no
 * network calls are made.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

const CLI = resolve("dist/cli.js");

const SHA_A = "a".repeat(40);

async function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execa("node", [CLI, ...args], { cwd, reject: false });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; exitCode?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.exitCode ?? 1,
    };
  }
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
});

describe("init", () => {
  it("is not a recognised command", async () => {
    const { exitCode, stderr, stdout } = await runCli(["init"], tmpDir);

    expect(exitCode).not.toBe(0);
    expect(stderr + stdout).toMatch(/unknown command/i);
  });
});
