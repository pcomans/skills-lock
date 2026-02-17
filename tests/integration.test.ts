import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLockfile, writeLockfile } from "../src/lockfile.js";
import { scanInstalledSkills } from "../src/scanner.js";
import type { Lockfile } from "../src/types.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_NEW = "f".repeat(40);

let originalCwd: string;
let tmpDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "integration-test-"));
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("lockfile + scanner integration", () => {
  it("init workflow: scan skills then write lockfile", async () => {
    await mkdir(".agents/skills/pdf", { recursive: true });
    await mkdir(".agents/skills/review", { recursive: true });
    await writeFile(".agents/skills/pdf/SKILL.md", "# PDF");
    await writeFile(".agents/skills/review/SKILL.md", "# Review");

    const installed = await scanInstalledSkills();
    expect(installed).toHaveLength(2);

    const lockfile: Lockfile = { version: 1, skills: {} };
    for (const skill of installed) {
      lockfile.skills[skill.name] = {
        source: "https://github.com/example/repo.git",
        path: skill.name,
        ref: SHA_A,
      };
    }

    await writeLockfile(lockfile);
    const reloaded = await readLockfile();

    expect(reloaded).not.toBeNull();
    expect(Object.keys(reloaded!.skills)).toHaveLength(2);
    expect(reloaded!.skills["pdf"].ref).toBe(SHA_A);
  });

  it("check workflow: detect missing and extra skills", async () => {
    const lockfile: Lockfile = {
      version: 1,
      skills: {
        pdf: {
          source: "https://github.com/anthropics/skills.git",
          path: "pdf",
          ref: SHA_A,
        },
        review: {
          source: "https://github.com/anthropics/skills.git",
          path: "review",
          ref: SHA_A,
        },
      },
    };

    await mkdir(".agents/skills/pdf", { recursive: true });
    await mkdir(".agents/skills/custom", { recursive: true });
    await writeFile(".agents/skills/pdf/SKILL.md", "# PDF");
    await writeFile(".agents/skills/custom/SKILL.md", "# Custom");

    const installed = await scanInstalledSkills();
    const installedNames = new Set(installed.map((s) => s.name));
    const lockedNames = new Set(Object.keys(lockfile.skills));

    const missing = [...lockedNames].filter((n) => !installedNames.has(n));
    const extra = [...installedNames].filter((n) => !lockedNames.has(n));

    expect(missing).toEqual(["review"]);
    expect(extra).toEqual(["custom"]);
  });

  it("lockfile is deterministic (sorted keys)", async () => {
    const lockfile: Lockfile = {
      version: 1,
      skills: {
        zebra: {
          source: "https://github.com/z/repo.git",
          path: "zebra",
          ref: SHA_A,
        },
        alpha: {
          source: "https://github.com/a/repo.git",
          path: "alpha",
          ref: SHA_B,
        },
      },
    };

    await writeLockfile(lockfile);
    const raw = await readFile("skills.lock", "utf-8");
    const keys = Object.keys(JSON.parse(raw).skills);

    expect(keys).toEqual(["alpha", "zebra"]);
  });

  it("remove workflow: removing a skill from lockfile preserves others", async () => {
    const lockfile: Lockfile = {
      version: 1,
      skills: {
        pdf: {
          source: "https://github.com/anthropics/skills.git",
          path: "pdf",
          ref: SHA_A,
        },
        review: {
          source: "https://github.com/anthropics/skills.git",
          path: "review",
          ref: SHA_B,
        },
      },
    };

    await writeLockfile(lockfile);

    const loaded = await readLockfile();
    delete loaded!.skills["pdf"];
    await writeLockfile(loaded!);

    const reloaded = await readLockfile();
    expect(Object.keys(reloaded!.skills)).toEqual(["review"]);
    expect(reloaded!.skills["review"].ref).toBe(SHA_B);
  });

  it("idempotent removal: removing nonexistent skill from lockfile is safe", async () => {
    const lockfile: Lockfile = {
      version: 1,
      skills: {
        pdf: {
          source: "https://github.com/anthropics/skills.git",
          path: "pdf",
          ref: SHA_A,
        },
      },
    };

    await writeLockfile(lockfile);

    const loaded = await readLockfile();
    delete loaded!.skills["nonexistent"];
    await writeLockfile(loaded!);

    const reloaded = await readLockfile();
    expect(Object.keys(reloaded!.skills)).toEqual(["pdf"]);
  });

  it("reinstall workflow: remove then re-add skill", async () => {
    const lockfile: Lockfile = {
      version: 1,
      skills: {
        pdf: {
          source: "https://github.com/anthropics/skills.git",
          path: "pdf",
          ref: SHA_A,
        },
      },
    };

    await writeLockfile(lockfile);

    const loaded = await readLockfile();
    delete loaded!.skills["pdf"];
    await writeLockfile(loaded!);

    expect(Object.keys((await readLockfile())!.skills)).toHaveLength(0);

    const reloaded = await readLockfile();
    reloaded!.skills["pdf"] = {
      source: "https://github.com/anthropics/skills.git",
      path: "pdf",
      ref: SHA_NEW,
    };
    await writeLockfile(reloaded!);

    const final = await readLockfile();
    expect(final!.skills["pdf"].ref).toBe(SHA_NEW);
  });

  it("multiple skills coexistence: adding skill B does not corrupt skill A", async () => {
    const lockfile: Lockfile = {
      version: 1,
      skills: {
        "skill-a": {
          source: "https://github.com/org/repo.git",
          path: "skill-a",
          ref: SHA_A,
        },
      },
    };

    await writeLockfile(lockfile);

    const loaded = await readLockfile();
    loaded!.skills["skill-b"] = {
      source: "https://github.com/org/repo.git",
      path: "skill-b",
      ref: SHA_B,
    };
    await writeLockfile(loaded!);

    const final = await readLockfile();
    expect(Object.keys(final!.skills)).toHaveLength(2);
    expect(final!.skills["skill-a"].ref).toBe(SHA_A);
    expect(final!.skills["skill-b"].ref).toBe(SHA_B);
  });

  it("no lockfile: readLockfile returns null", async () => {
    const result = await readLockfile();
    expect(result).toBeNull();
  });

  it("corrupted lockfile: throws on malformed JSON", async () => {
    await writeFile("skills.lock", "not valid json {{{");
    await expect(readLockfile()).rejects.toThrow();
  });

  it("wrong version: throws on unsupported version", async () => {
    await writeFile(
      "skills.lock",
      JSON.stringify({ version: 99, skills: {} })
    );
    await expect(readLockfile()).rejects.toThrow("Unsupported lockfile version");
  });
});
