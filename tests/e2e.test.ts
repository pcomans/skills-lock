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
import { mkdtemp, mkdir, writeFile, access, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLockfile, writeLockfile } from "../src/lockfile.js";
import { scanInstalledSkills } from "../src/scanner.js";
import { installSkill, removeSkill } from "../src/installer.js";
import { cleanupClone, expandSource, findSkills, resolveRef, resolveRepo } from "../src/resolver.js";
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

  // ─── GitHub tree URL ────────────────────────────────────────────────────────
  // Verifies the expandSource fix end-to-end: a URL pasted from the GitHub
  // browser (including /tree/<branch>[/<path>]) resolves to the correct base
  // repo, clones successfully, and skills are discoverable.
  it(
    "GitHub tree URL: resolveRepo and findSkills work with a pasted /tree/main URL",
    { timeout: 120_000 },
    async () => {
      const treeUrl = "https://github.com/anthropics/skills/tree/main";

      // Confirm expandSource strips the tree component
      expect(expandSource(treeUrl)).toBe("https://github.com/anthropics/skills.git");

      let repoDir: string | undefined;
      try {
        repoDir = await resolveRepo(treeUrl);
        const ref = await resolveRef(repoDir);
        expect(ref).toMatch(/^[0-9a-f]{40}$/);

        const skills = await findSkills(repoDir, expandSource(treeUrl));
        expect(skills.length).toBeGreaterThan(0);
        expect(skills.map((s) => s.name)).toContain("algorithmic-art");

        // All returned paths use forward slashes (cross-platform contract)
        for (const skill of skills) {
          expect(skill.path).not.toContain("\\");
        }
      } finally {
        if (repoDir) await cleanupClone(repoDir);
      }
    }
  );

  // ─── Pinned ref install ──────────────────────────────────────────────────────
  // Verifies the core skills-lock use case: install a skill from an exact commit
  // SHA. This exercises the `if (ref)` branch in installer.ts which does a full
  // clone via cloneAtRef(), verifies SKILL.md exists at skillPath, then calls
  // `npx skills add <local-checkout> --skill <name> --yes`.
  it(
    "pinned ref install: installSkill at an exact commit SHA installs reproducibly",
    { timeout: 180_000 },
    async () => {
      const source = "anthropics/skills";
      const skillName = "algorithmic-art";

      // Step 1: resolve the current HEAD SHA and the skill's path in the repo
      let ref: string;
      let skillPath: string;
      const repoDir1 = await resolveRepo(source);
      try {
        ref = await resolveRef(repoDir1);
        const skills = await findSkills(repoDir1, expandSource(source));
        const matched = skills.find((s) => s.name === skillName);
        expect(matched, `${skillName} not found in repo`).toBeDefined();
        skillPath = matched!.path;
      } finally {
        await cleanupClone(repoDir1);
      }

      // Step 2: install at the pinned ref (cloneAtRef path in installer.ts)
      await installSkill(expandSource(source), skillName, ref, skillPath);

      const agentsSkillDir = join(".agents", "skills", skillName);
      expect(await exists(agentsSkillDir)).toBe(true);
      expect(await exists(join(agentsSkillDir, "SKILL.md"))).toBe(true);

      // Lockfile records and reloads the exact 40-char SHA
      const lockfile: Lockfile = {
        version: 1,
        skills: { [skillName]: { source: expandSource(source), path: skillPath, ref } },
      };
      await writeLockfile(lockfile);
      const reloaded = await readLockfile();
      expect(reloaded!.skills[skillName].ref).toBe(ref);
      expect(reloaded!.skills[skillName].ref).toMatch(/^[0-9a-f]{40}$/);

      // Scanner finds it via the symlink created by npx skills
      const scanned = await scanInstalledSkills();
      expect(scanned.find((s) => s.name === skillName)).toBeDefined();

      // Cleanup
      await removeSkill(skillName);
      expect(await exists(agentsSkillDir)).toBe(false);
    }
  );

  // ─── Local skill path ────────────────────────────────────────────────────────
  // Verifies that a locally checked-out repo (e.g. already cloned for a pinned
  // install) with a nested skill can be installed via skillPath. Tests the
  // `join(source, skillPath)` branch in installSkill() without a ref.
  it(
    "local skill path: installSkill from a local directory with a nested skillPath",
    { timeout: 60_000 },
    async () => {
      const skillName = "local-e2e-skill";
      const skillPath = "skills/local-e2e-skill";

      // Build a minimal local skill repo
      const localRepo = await mkdtemp(join(tmpdir(), "skills-lock-local-"));
      try {
        const skillDir = join(localRepo, skillPath);
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, "SKILL.md"),
          `---\nname: ${skillName}\ndescription: E2E test skill from local path\n---\n\n# ${skillName}\n`
        );

        // Install pointing to the nested subdirectory inside the local repo
        await installSkill(localRepo, skillName, undefined, skillPath);

        const agentsSkillDir = join(".agents", "skills", skillName);
        expect(await exists(agentsSkillDir)).toBe(true);
        expect(await exists(join(agentsSkillDir, "SKILL.md"))).toBe(true);

        // Scanner finds it
        const scanned = await scanInstalledSkills();
        expect(scanned.find((s) => s.name === skillName)).toBeDefined();

        // Cleanup
        await removeSkill(skillName);
        expect(await exists(agentsSkillDir)).toBe(false);
      } finally {
        await rm(localRepo, { recursive: true, force: true });
      }
    }
  );

  // ─── GitLab URL normalization ─────────────────────────────────────────────────
  // Verifies that GitLab tree URLs pasted from the browser are correctly
  // normalized by expandSource to a cloneable base URL.
  //
  // Note: we do not attempt an actual GitLab clone here. GitLab HTTPS requires
  // credential configuration that is not guaranteed in all environments (git
  // credential helpers may prompt and fail with "Device not configured").
  // The full GitLab URL normalization is covered by unit tests in resolver.test.ts.
  it(
    "GitLab URL: expandSource strips /-/tree/ from browser-pasted URLs",
    async () => {
      // Flat repo with tree URL
      expect(
        expandSource("https://gitlab.com/gitlab-examples/npm/-/tree/master")
      ).toBe("https://gitlab.com/gitlab-examples/npm.git");

      // Subgroup repo with tree + nested path
      expect(
        expandSource("https://gitlab.com/group/subgroup/repo/-/tree/main/skills/foo")
      ).toBe("https://gitlab.com/group/subgroup/repo.git");

      // Bare GitLab URL (no .git, no tree) gets .git appended
      expect(
        expandSource("https://gitlab.com/owner/repo")
      ).toBe("https://gitlab.com/owner/repo.git");
    }
  );

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
