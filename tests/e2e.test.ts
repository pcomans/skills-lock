/**
 * End-to-end tests against real marketplaces.
 *
 * These tests call `npx skills add/remove` for real — they clone repos,
 * write files to disk, and verify the results. They require network access
 * and take ~30-60s each.
 *
 * Run with: RUN_E2E=1 npx vitest run tests/e2e.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtemp, access, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLockfile, writeLockfile } from "../src/lockfile.js";
import { scanInstalledSkills } from "../src/scanner.js";
import { installSkill, removeSkill } from "../src/installer.js";
import { cleanupClone, resolveRef, resolveRepo } from "../src/resolver.js";
import type { Lockfile } from "../src/types.js";

const RUN_E2E = process.env.RUN_E2E === "1";

// Skip entire file unless RUN_E2E=1
beforeAll(() => {
  if (!RUN_E2E) {
    console.log("Skipping e2e tests (set RUN_E2E=1 to enable)");
  }
});

/**
 * 5 real marketplaces, each with a known skill name.
 */
const MARKETPLACES = [
  {
    name: "anthropics/skills",
    skill: "algorithmic-art",
    description: "Anthropic official — algorithmic art with p5.js",
  },
  {
    name: "vercel-labs/agent-skills",
    skill: "web-design-guidelines",
    description: "Vercel official — web design review",
  },
  {
    name: "cloudflare/skills",
    skill: "cloudflare",
    description: "Cloudflare — platform development skill",
  },
  {
    name: "supabase/agent-skills",
    skill: "supabase-postgres-best-practices",
    description: "Supabase — Postgres optimization",
  },
  {
    name: "expo/skills",
    skill: "expo-tailwind-setup",
    description: "Expo — Tailwind CSS setup for React Native",
  },
] as const;

/**
 * Helper: check if a path exists on disk.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: check if a path is a symlink.
 */
async function isSymlink(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

describe.skipIf(!RUN_E2E)("e2e: real marketplace install/uninstall", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await mkdtemp(join(tmpdir(), "skills-lock-e2e-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  // Generate one test per marketplace
  for (const marketplace of MARKETPLACES) {
    it(
      `${marketplace.name}: install and uninstall "${marketplace.skill}"`,
      { timeout: 120_000 },
      async () => {
        // --- Install ---
        await installSkill(marketplace.name, marketplace.skill);

        // Verify skill landed in .agents/skills/ (canonical location)
        const agentsSkillDir = join(
          ".agents",
          "skills",
          marketplace.skill
        );
        expect(
          await exists(agentsSkillDir),
          `Expected ${agentsSkillDir} to exist after install`
        ).toBe(true);

        // Verify SKILL.md exists
        const skillMdPath = join(agentsSkillDir, "SKILL.md");
        expect(
          await exists(skillMdPath),
          `Expected SKILL.md at ${skillMdPath}`
        ).toBe(true);

        // Verify SKILL.md is non-empty and has content
        const content = await readFile(skillMdPath, "utf-8");
        expect(content.length).toBeGreaterThan(50);

        // Verify symlink exists in .claude/skills/
        const claudeSymlink = join(
          ".claude",
          "skills",
          marketplace.skill
        );
        expect(
          await isSymlink(claudeSymlink),
          `Expected symlink at ${claudeSymlink}`
        ).toBe(true);

        // Verify scanner detects the skill
        const scanned = await scanInstalledSkills();
        const found = scanned.find((s) => s.name === marketplace.skill);
        expect(found, `Scanner should find ${marketplace.skill}`).toBeDefined();
        expect(found!.hasSkillMd).toBe(true);

        // --- Lockfile round-trip (with a real ref) ---
        const refRepoDir = await resolveRepo(marketplace.name);
        let pinnedRef: string;
        try {
          pinnedRef = await resolveRef(refRepoDir);
        } finally {
          await cleanupClone(refRepoDir);
        }

        const lockfile: Lockfile = {
          version: 1,
          skills: {
            [marketplace.skill]: {
              source: marketplace.name,
              path: marketplace.skill,
              ref: pinnedRef,
            },
          },
        };
        await writeLockfile(lockfile);
        const reloaded = await readLockfile();
        expect(reloaded!.skills[marketplace.skill].source).toBe(
          marketplace.name
        );
        expect(reloaded!.skills[marketplace.skill].ref).toBe(pinnedRef);

        // --- Uninstall ---
        await removeSkill(marketplace.skill);

        // Verify skill directory is gone
        expect(
          await exists(agentsSkillDir),
          `Expected ${agentsSkillDir} to be removed`
        ).toBe(false);

        // Verify symlink is gone
        expect(
          await exists(claudeSymlink),
          `Expected ${claudeSymlink} symlink to be removed`
        ).toBe(false);

        // Verify scanner no longer finds it
        const afterRemove = await scanInstalledSkills();
        const stillFound = afterRemove.find(
          (s) => s.name === marketplace.skill
        );
        expect(
          stillFound,
          `Scanner should NOT find ${marketplace.skill} after removal`
        ).toBeUndefined();
      }
    );
  }
});
