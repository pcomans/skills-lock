import { vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { expandSource, resolveRepo, resolveRef, findSkills } from "../src/resolver.js";

// Helper: create a temp directory with a real git repo
async function createTempGitRepo(): Promise<string> {
  const dir = join(tmpdir(), `skills-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  await writeFile(join(dir, "README.md"), "# Test repo\n");
  await git.add("README.md");
  await git.commit("initial commit");
  return dir;
}

// Helper: clean up temp directory
async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe("expandSource", () => {
  it("expands GitHub shorthand to full URL", () => {
    expect(expandSource("anthropics/skills")).toBe("https://github.com/anthropics/skills.git");
  });

  it("expands shorthand with dots and hyphens in names", () => {
    expect(expandSource("my-org/my.repo")).toBe("https://github.com/my-org/my.repo.git");
  });

  it("passes through https URLs unchanged", () => {
    const url = "https://github.com/anthropics/skills.git";
    expect(expandSource(url)).toBe(url);
  });

  it("passes through http URLs unchanged", () => {
    const url = "http://example.com/repo.git";
    expect(expandSource(url)).toBe(url);
  });

  it("passes through git@ SSH URLs unchanged", () => {
    const url = "git@github.com:anthropics/skills.git";
    expect(expandSource(url)).toBe(url);
  });

  it("passes through unrecognized strings unchanged", () => {
    // Something that does not match owner/repo pattern
    expect(expandSource("just-a-name")).toBe("just-a-name");
  });

  it("does not expand strings with multiple slashes", () => {
    const input = "a/b/c";
    expect(expandSource(input)).toBe(input);
  });

  it("handles underscores in owner and repo names", () => {
    expect(expandSource("my_org/my_repo")).toBe("https://github.com/my_org/my_repo.git");
  });
});

describe("expandSource - GitHub HTTPS URLs", () => {
  it("adds .git suffix to bare GitHub URL (no .git)", () => {
    expect(expandSource("https://github.com/anthropics/skills")).toBe(
      "https://github.com/anthropics/skills.git"
    );
  });

  it("is idempotent when .git is already present", () => {
    expect(expandSource("https://github.com/anthropics/skills.git")).toBe(
      "https://github.com/anthropics/skills.git"
    );
  });

  it("strips /tree/<branch> to produce a cloneable URL", () => {
    expect(expandSource("https://github.com/owner/repo/tree/main")).toBe(
      "https://github.com/owner/repo.git"
    );
  });

  it("strips /tree/<branch>/<path> — pasted GitHub URLs work directly", () => {
    expect(expandSource("https://github.com/owner/repo/tree/main/skills/my-skill")).toBe(
      "https://github.com/owner/repo.git"
    );
  });

  it("strips /tree/<feature-branch>/<nested-path>", () => {
    expect(expandSource("https://github.com/org/repo/tree/feature-branch/a/b/c")).toBe(
      "https://github.com/org/repo.git"
    );
  });
});

describe("expandSource - GitLab HTTPS URLs", () => {
  it("adds .git suffix to bare GitLab URL", () => {
    expect(expandSource("https://gitlab.com/owner/repo")).toBe(
      "https://gitlab.com/owner/repo.git"
    );
  });

  it("is idempotent when .git is already present", () => {
    expect(expandSource("https://gitlab.com/owner/repo.git")).toBe(
      "https://gitlab.com/owner/repo.git"
    );
  });

  it("strips /-/tree/<branch> to produce a cloneable URL", () => {
    expect(expandSource("https://gitlab.com/owner/repo/-/tree/develop")).toBe(
      "https://gitlab.com/owner/repo.git"
    );
  });

  it("strips /-/tree/<branch>/<path>", () => {
    expect(expandSource("https://gitlab.com/owner/repo/-/tree/main/src/skills")).toBe(
      "https://gitlab.com/owner/repo.git"
    );
  });

  it("handles GitLab subgroup repos (2 levels deep)", () => {
    expect(expandSource("https://gitlab.com/group/subgroup/repo")).toBe(
      "https://gitlab.com/group/subgroup/repo.git"
    );
  });

  it("strips tree URL from GitLab subgroup repo", () => {
    expect(expandSource("https://gitlab.com/group/subgroup/repo/-/tree/main")).toBe(
      "https://gitlab.com/group/subgroup/repo.git"
    );
  });

  it("strips tree URL with path from GitLab subgroup repo", () => {
    expect(expandSource("https://gitlab.com/group/subgroup/repo/-/tree/main/skills/foo")).toBe(
      "https://gitlab.com/group/subgroup/repo.git"
    );
  });
});

describe("expandSource - non-GitHub/GitLab HTTPS pass-through", () => {
  it("passes through arbitrary HTTPS git URLs unchanged", () => {
    const url = "http://example.com/repo.git";
    expect(expandSource(url)).toBe(url);
  });

  it("passes through self-hosted git HTTPS URLs unchanged", () => {
    const url = "https://git.internal.example.com/team/skills.git";
    expect(expandSource(url)).toBe(url);
  });
});

describe("resolveRef", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await createTempGitRepo();
  });

  afterEach(async () => {
    await cleanupDir(repoDir);
  });

  it("returns the HEAD commit SHA", async () => {
    const sha = await resolveRef(repoDir);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns the latest commit SHA after a new commit", async () => {
    const sha1 = await resolveRef(repoDir);

    const git = simpleGit(repoDir);
    await writeFile(join(repoDir, "file2.txt"), "hello\n");
    await git.add("file2.txt");
    await git.commit("second commit");

    const sha2 = await resolveRef(repoDir);
    expect(sha2).toMatch(/^[0-9a-f]{40}$/);
    expect(sha2).not.toBe(sha1);
  });

  it("throws when there are no commits", async () => {
    const emptyDir = join(tmpdir(), `skills-lock-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
    const git = simpleGit(emptyDir);
    await git.init();

    await expect(resolveRef(emptyDir)).rejects.toThrow();
    await cleanupDir(emptyDir);
  });
});

describe("resolveRepo", () => {
  let clonedDir: string | undefined;
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempGitRepo();
    clonedDir = undefined;
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
    if (clonedDir) {
      await cleanupDir(clonedDir);
    }
  });

  it("clones a local repo to a temp directory", async () => {
    clonedDir = await resolveRepo(sourceDir);
    expect(clonedDir).toContain("skills-lock-");

    // Verify it is a valid git repo with a commit
    const sha = await resolveRef(clonedDir);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("clones with a specific ref", async () => {
    // Create a branch in the source repo
    const git = simpleGit(sourceDir);
    await git.checkoutLocalBranch("test-branch");
    await writeFile(join(sourceDir, "branch-file.txt"), "on branch\n");
    await git.add("branch-file.txt");
    await git.commit("branch commit");

    clonedDir = await resolveRepo(sourceDir, { ref: "test-branch" });
    const clonedGit = simpleGit(clonedDir);
    const log = await clonedGit.log({ maxCount: 1 });
    expect(log.latest?.message).toBe("branch commit");
  });
});

describe("findSkills", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await createTempGitRepo();
  });

  afterEach(async () => {
    await cleanupDir(repoDir);
  });

  it("finds SKILL.md files in subdirectories", async () => {
    const git = simpleGit(repoDir);

    // Create skill directories
    await mkdir(join(repoDir, "pdf"), { recursive: true });
    await writeFile(join(repoDir, "pdf", "SKILL.md"), "# PDF Skill\n");
    await mkdir(join(repoDir, "xlsx"), { recursive: true });
    await writeFile(join(repoDir, "xlsx", "SKILL.md"), "# XLSX Skill\n");

    await git.add(".");
    await git.commit("add skills");

    const skills = await findSkills(repoDir, "anthropics/skills");

    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["pdf", "xlsx"]);

    const paths = skills.map((s) => s.path).sort();
    expect(paths).toEqual(["pdf", "xlsx"]);

    // All should have the same source and a valid ref
    for (const skill of skills) {
      expect(skill.source).toBe("anthropics/skills");
      expect(skill.ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("finds deeply nested SKILL.md files", async () => {
    const git = simpleGit(repoDir);

    await mkdir(join(repoDir, "category", "sub-skill"), { recursive: true });
    await writeFile(join(repoDir, "category", "sub-skill", "SKILL.md"), "# Nested\n");

    await git.add(".");
    await git.commit("add nested skill");

    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("sub-skill");
    expect(skills[0].path).toBe("category/sub-skill");
  });

  it("skips .git directories", async () => {
    const git = simpleGit(repoDir);

    // The .git directory already exists from init; place a SKILL.md inside it
    // (this would not normally happen, but verifies the skip logic)
    await mkdir(join(repoDir, ".git", "fake-skill"), { recursive: true });
    await writeFile(join(repoDir, ".git", "fake-skill", "SKILL.md"), "# Should be skipped\n");

    // Also add a real skill
    await mkdir(join(repoDir, "real-skill"), { recursive: true });
    await writeFile(join(repoDir, "real-skill", "SKILL.md"), "# Real\n");
    await git.add(".");
    await git.commit("add skill");

    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("real-skill");
  });

  it("skips node_modules directories", async () => {
    const git = simpleGit(repoDir);

    await mkdir(join(repoDir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(repoDir, "node_modules", "pkg", "SKILL.md"), "# Should be skipped\n");

    await mkdir(join(repoDir, "my-skill"), { recursive: true });
    await writeFile(join(repoDir, "my-skill", "SKILL.md"), "# My Skill\n");
    await git.add(".");
    await git.commit("add skill");

    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
  });

  it("returns empty array when no SKILL.md files exist", async () => {
    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toEqual([]);
  });

  it("handles SKILL.md at the repo root", async () => {
    const git = simpleGit(repoDir);

    await writeFile(join(repoDir, "SKILL.md"), "# Root Skill\n");
    await git.add(".");
    await git.commit("add root skill");

    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(1);
    expect(skills[0].path).toBe(".");
    expect(skills[0].name).toBe(".");
  });

  it("derives skill name from the last directory segment", async () => {
    const git = simpleGit(repoDir);

    await mkdir(join(repoDir, "document-skills", "pdf"), { recursive: true });
    await writeFile(join(repoDir, "document-skills", "pdf", "SKILL.md"), "# PDF\n");

    await git.add(".");
    await git.commit("add skill");

    const skills = await findSkills(repoDir, "anthropics/skills");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("pdf");
    expect(skills[0].path).toBe("document-skills/pdf");
  });

  // Cross-platform path contract: paths stored in the lockfile must always use
  // forward slashes so skills.lock is portable across operating systems.
  it("normalizes nested skill paths to forward slashes for lockfile portability", async () => {
    const git = simpleGit(repoDir);

    await mkdir(join(repoDir, "a", "b", "c"), { recursive: true });
    await writeFile(join(repoDir, "a", "b", "c", "SKILL.md"), "# Deep\n");

    await git.add(".");
    await git.commit("add deep skill");

    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(1);
    expect(skills[0].path).toBe("a/b/c");
    expect(skills[0].path).not.toContain("\\");
  });

  // Full-depth discovery contract: skills-lock always finds ALL SKILL.md files,
  // unlike vercel/skills which stops at a root SKILL.md by default (fullDepth: false).
  // This is intentional — users choose which specific skill to pin via --skill <name>.
  it("finds all skills in a repo with both root and nested SKILL.md files (full-depth)", async () => {
    const git = simpleGit(repoDir);

    await writeFile(join(repoDir, "SKILL.md"), "# Root\n");
    await mkdir(join(repoDir, "pdf"), { recursive: true });
    await writeFile(join(repoDir, "pdf", "SKILL.md"), "# PDF\n");
    await mkdir(join(repoDir, "review"), { recursive: true });
    await writeFile(join(repoDir, "review", "SKILL.md"), "# Review\n");

    await git.add(".");
    await git.commit("add mixed skills");

    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(3);
    const paths = skills.map((s) => s.path).sort();
    expect(paths).toEqual([".", "pdf", "review"]);
  });

  // Plugin manifest contract: repos that use .claude-plugin/marketplace.json or
  // plugin.json for plugin discovery are still usable with skills-lock — their
  // skills are found by recursive SKILL.md search, not by manifest parsing.
  it("finds skills in repos that use plugin manifests by their SKILL.md files", async () => {
    const git = simpleGit(repoDir);

    // Simulate a repo with a plugin manifest AND actual SKILL.md files
    await mkdir(join(repoDir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(repoDir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ plugins: [{ name: "my-plugin", source: "./plugins/my-plugin", skills: ["./skills/pdf"] }] })
    );
    await mkdir(join(repoDir, "plugins", "my-plugin", "skills", "pdf"), { recursive: true });
    await writeFile(join(repoDir, "plugins", "my-plugin", "skills", "pdf", "SKILL.md"), "# PDF\n");

    await git.add(".");
    await git.commit("add plugin-manifest repo");

    // skills-lock finds the SKILL.md by recursion — manifests are not parsed
    const skills = await findSkills(repoDir, "test/repo");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("pdf");
    expect(skills[0].path).toBe("plugins/my-plugin/skills/pdf");
  });
});
