import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import {
  readLockfile,
  writeLockfile,
  validateLockfile,
} from "../src/lockfile.js";
import type { Lockfile } from "../src/types.js";

/** A valid 40-char hex SHA for tests */
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function makeLockfile(skills: Lockfile["skills"] = {}): Lockfile {
  return { version: 1, skills };
}

function makeSkillEntry(overrides: Partial<Record<string, string>> = {}) {
  return {
    source: "https://github.com/anthropics/skills.git",
    path: "document-skills/pdf",
    ref: SHA_A,
    ...overrides,
  };
}

describe("lockfile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skills-lock-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- readLockfile ----------

  describe("readLockfile", () => {
    it("returns null for a non-existent file", async () => {
      const result = await readLockfile(join(tmpDir, "does-not-exist.lock"));
      expect(result).toBeNull();
    });

    it("parses a valid lockfile", async () => {
      const lockfile = makeLockfile({ pdf: makeSkillEntry() });
      const path = join(tmpDir, "skills.lock");
      await writeLockfile(lockfile, path);

      const result = await readLockfile(path);
      expect(result).toEqual(lockfile);
    });

    it("parses a lockfile with multiple skills", async () => {
      const lockfile = makeLockfile({
        pdf: makeSkillEntry({ path: "document-skills/pdf" }),
        xlsx: makeSkillEntry({ path: "document-skills/xlsx", ref: SHA_B }),
      });
      const path = join(tmpDir, "skills.lock");
      await writeLockfile(lockfile, path);

      const result = await readLockfile(path);
      expect(result).toEqual(lockfile);
    });

    it("parses a lockfile with no skills", async () => {
      const lockfile = makeLockfile();
      const path = join(tmpDir, "skills.lock");
      await writeLockfile(lockfile, path);

      const result = await readLockfile(path);
      expect(result).toEqual(lockfile);
    });

    it("throws on invalid JSON", async () => {
      const path = join(tmpDir, "bad.lock");
      writeFileSync(path, "not json {{{");

      await expect(readLockfile(path)).rejects.toThrow();
    });

    it("throws on wrong version", async () => {
      const path = join(tmpDir, "bad-version.lock");
      writeFileSync(
        path,
        JSON.stringify({ version: 2, skills: {} })
      );

      await expect(readLockfile(path)).rejects.toThrow(
        "Unsupported lockfile version: 2"
      );
    });

    it("throws on missing version", async () => {
      const path = join(tmpDir, "no-version.lock");
      writeFileSync(
        path,
        JSON.stringify({ skills: {} })
      );

      await expect(readLockfile(path)).rejects.toThrow(
        "Unsupported lockfile version: undefined"
      );
    });

    it("throws on invalid skill entry in file", async () => {
      const path = join(tmpDir, "bad-skill.lock");
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          skills: { pdf: { source: "https://example.com" } },
        })
      );

      await expect(readLockfile(path)).rejects.toThrow(
        "Skill 'pdf' missing or invalid field 'path'"
      );
    });
  });

  // ---------- writeLockfile ----------

  describe("writeLockfile", () => {
    it("writes valid JSON with a trailing newline", async () => {
      const lockfile = makeLockfile({ pdf: makeSkillEntry() });
      const path = join(tmpDir, "skills.lock");
      await writeLockfile(lockfile, path);

      const raw = readFileSync(path, "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("sorts skills alphabetically by name", async () => {
      const lockfile = makeLockfile({
        zebra: makeSkillEntry({ path: "z" }),
        alpha: makeSkillEntry({ path: "a" }),
        middle: makeSkillEntry({ path: "m" }),
      });
      const path = join(tmpDir, "skills.lock");
      await writeLockfile(lockfile, path);

      const raw = readFileSync(path, "utf-8");
      const keys = Object.keys(JSON.parse(raw).skills);
      expect(keys).toEqual(["alpha", "middle", "zebra"]);
    });

    it("roundtrips correctly", async () => {
      const lockfile = makeLockfile({
        pdf: makeSkillEntry({ path: "document-skills/pdf" }),
        xlsx: makeSkillEntry({ path: "document-skills/xlsx", ref: SHA_B }),
      });
      const path = join(tmpDir, "skills.lock");

      await writeLockfile(lockfile, path);
      const result = await readLockfile(path);

      expect(result).toEqual(lockfile);
    });

    it("validates before writing and rejects invalid data", async () => {
      const path = join(tmpDir, "skills.lock");
      const bad = { version: 99, skills: {} } as unknown as Lockfile;

      await expect(writeLockfile(bad, path)).rejects.toThrow(
        "Unsupported lockfile version: 99"
      );
    });

    it("writes pretty-printed JSON with 2-space indent", async () => {
      const lockfile = makeLockfile({ pdf: makeSkillEntry() });
      const path = join(tmpDir, "skills.lock");
      await writeLockfile(lockfile, path);

      const raw = readFileSync(path, "utf-8");
      const lines = raw.split("\n");
      expect(lines[1]).toMatch(/^ {2}"/);
    });
  });

  // ---------- validateLockfile ----------

  describe("validateLockfile", () => {
    it("accepts a valid lockfile with no skills", () => {
      expect(() => validateLockfile({ version: 1, skills: {} })).not.toThrow();
    });

    it("accepts a valid lockfile with skills", () => {
      const data = {
        version: 1,
        skills: { pdf: makeSkillEntry() },
      };
      expect(() => validateLockfile(data)).not.toThrow();
    });

    it("rejects null", () => {
      expect(() => validateLockfile(null)).toThrow(
        "Lockfile must be a JSON object"
      );
    });

    it("rejects a string", () => {
      expect(() => validateLockfile("not an object")).toThrow(
        "Lockfile must be a JSON object"
      );
    });

    it("rejects a number", () => {
      expect(() => validateLockfile(42)).toThrow(
        "Lockfile must be a JSON object"
      );
    });

    it("rejects an array", () => {
      expect(() => validateLockfile([1, 2, 3])).toThrow(
        "Unsupported lockfile version: undefined"
      );
    });

    it("rejects version 0", () => {
      expect(() => validateLockfile({ version: 0, skills: {} })).toThrow(
        "Unsupported lockfile version: 0"
      );
    });

    it("rejects version 2", () => {
      expect(() => validateLockfile({ version: 2, skills: {} })).toThrow(
        "Unsupported lockfile version: 2"
      );
    });

    it("rejects string version", () => {
      expect(() => validateLockfile({ version: "1", skills: {} })).toThrow(
        "Unsupported lockfile version: 1"
      );
    });

    it("rejects missing skills field", () => {
      expect(() => validateLockfile({ version: 1 })).toThrow(
        "Lockfile must have a 'skills' object"
      );
    });

    it("rejects null skills field", () => {
      expect(() => validateLockfile({ version: 1, skills: null })).toThrow(
        "Lockfile must have a 'skills' object"
      );
    });

    it("rejects a skill entry that is a string", () => {
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: "not-an-object" } })
      ).toThrow("Skill 'pdf' must be an object");
    });

    it("rejects a skill entry that is null", () => {
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: null } })
      ).toThrow("Skill 'pdf' must be an object");
    });

    it("rejects a skill missing 'source'", () => {
      const entry = { path: "a", ref: SHA_A };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("Skill 'pdf' missing or invalid field 'source'");
    });

    it("rejects a skill missing 'path'", () => {
      const entry = { source: "a", ref: SHA_A };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("Skill 'pdf' missing or invalid field 'path'");
    });

    it("rejects a skill missing 'ref'", () => {
      const entry = { source: "a", path: "b" };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("Skill 'pdf' missing or invalid field 'ref'");
    });

    it("rejects a skill with numeric field values", () => {
      const entry = { source: 123, path: "b", ref: SHA_A };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("Skill 'pdf' missing or invalid field 'source'");
    });

    // --- SHA enforcement ---

    it("rejects a tag as ref", () => {
      const entry = { source: "a", path: "b", ref: "v1.2.3" };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("must be a full 40-character commit SHA");
    });

    it("rejects a short SHA as ref", () => {
      const entry = { source: "a", path: "b", ref: "abc1234" };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("must be a full 40-character commit SHA");
    });

    it("rejects a branch name as ref", () => {
      const entry = { source: "a", path: "b", ref: "main" };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("must be a full 40-character commit SHA");
    });

    it("rejects uppercase hex in ref", () => {
      const entry = { source: "a", path: "b", ref: "A".repeat(40) };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("must be a full 40-character commit SHA");
    });

    it("accepts a valid 40-char lowercase hex SHA", () => {
      const entry = { source: "a", path: "b", ref: "abcdef0123456789abcdef0123456789abcdef01" };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).not.toThrow();
    });

    // --- integrity field ---

    it("accepts a skill with a valid integrity field", () => {
      const entry = { source: "a", path: "b", ref: SHA_A, integrity: `sha256:${"a".repeat(64)}` };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).not.toThrow();
    });

    it("accepts a skill without an integrity field", () => {
      const entry = { source: "a", path: "b", ref: SHA_A };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).not.toThrow();
    });

    it("rejects a non-string integrity field", () => {
      const entry = { source: "a", path: "b", ref: SHA_A, integrity: 12345 };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("invalid 'integrity' field");
    });

    it("rejects integrity without sha256: prefix", () => {
      const entry = { source: "a", path: "b", ref: SHA_A, integrity: "a".repeat(64) };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("invalid integrity");
    });

    it("rejects integrity with wrong hash length", () => {
      const entry = { source: "a", path: "b", ref: SHA_A, integrity: "sha256:abc123" };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("invalid integrity");
    });

    it("rejects integrity with uppercase hex", () => {
      const entry = { source: "a", path: "b", ref: SHA_A, integrity: `sha256:${"A".repeat(64)}` };
      expect(() =>
        validateLockfile({ version: 1, skills: { pdf: entry } })
      ).toThrow("invalid integrity");
    });
  });
});
