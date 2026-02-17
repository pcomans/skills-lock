import { createRequire } from "node:module";
import { Command } from "commander";
import { readLockfile, writeLockfile, diffLockfiles } from "./lockfile.js";
import { resolveRepo, resolveRef, expandSource, cleanupClone, findSkills } from "./resolver.js";
import { installSkill, removeSkill } from "./installer.js";
import { scanInstalledSkills } from "./scanner.js";
import type { Lockfile } from "./types.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Wrap an async action handler with error handling.
 * Catches errors and prints a clean message instead of a raw stack trace.
 */
function action<T extends unknown[]>(
  fn: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      die(`Error: ${message}`);
    }
  };
}

const program = new Command();

program
  .name("skills-lock")
  .description(
    "A lockfile for AI agent skills — pin, share, and reproduce skill installations"
  )
  .version(version);

program
  .command("init")
  .description("Create an empty skills.lock file")
  .action(action(async () => {
    const existing = await readLockfile();
    if (existing) {
      console.log("skills.lock already exists.");
      return;
    }

    await writeLockfile({ version: 1, skills: {} });
    console.log("Created skills.lock");
    console.log('Add skills with "skills-lock add <source> --skill <name>".');
  }));

program
  .command("install")
  .description("Install skills from skills.lock")
  .option("--force", "Reinstall all skills at their pinned refs, even if already present")
  .action(action(async (opts: { force?: boolean }) => {
    const lockfile = await readLockfile();
    if (!lockfile) die("No skills.lock found. Run 'skills-lock add' to start.");

    const skillNames = Object.keys(lockfile.skills);

    if (skillNames.length === 0) {
      console.log("No skills in lockfile.");
      return;
    }

    const installed = await scanInstalledSkills();
    const installedNames = new Set(installed.map((s) => s.name));

    let count = 0;
    let skipped = 0;
    for (const [name, entry] of Object.entries(lockfile.skills)) {
      if (!opts.force && installedNames.has(name)) {
        console.log(`  ${name} — already installed (ref not verified; use --force to re-pin)`);
        skipped++;
        continue;
      }

      if (opts.force && installedNames.has(name)) {
        console.log(`  ${name} — reinstalling at ${entry.ref.slice(0, 7)}...`);
        await removeSkill(name);
      } else {
        console.log(`  ${name} — installing from ${entry.source} at ${entry.ref.slice(0, 7)}...`);
      }

      await installSkill(entry.source, name, entry.ref, entry.path);
      count++;
    }

    console.log(
      count === 0 && skipped > 0
        ? "All skills already installed (refs not verified). Run 'skills-lock install --force' to re-pin."
        : count === 0
          ? "No skills to install."
        : `Installed ${count} skill(s).`
    );
  }));

program
  .command("add <source>")
  .description("Install a skill and add it to skills.lock")
  .option("--skill <name>", "Skill name within the source repo")
  .action(action(async (source: string, opts: { skill?: string }) => {
    const skillName = opts.skill;
    if (!skillName) die("Please specify a skill name with --skill <name>");

    // Clone first to get the exact SHA, then install from that checkout
    const resolvedSource = expandSource(source);
    console.log(`Resolving ${skillName} from ${source}...`);
    const repoDir = await resolveRepo(source);
    let ref: string;
    let skillPath: string;
    try {
      ref = await resolveRef(repoDir);
      const skills = await findSkills(repoDir, resolvedSource);
      const matched = skills.find((s) => s.name === skillName);
      if (!matched) {
        const available = skills.map((s) => s.name).sort();
        if (available.length === 0) {
          throw new Error(`No SKILL.md files found in ${resolvedSource}`);
        }
        throw new Error(
          `Skill '${skillName}' not found in ${resolvedSource}. Available skills: ${available.join(", ")}`
        );
      }
      skillPath = matched.path;

      console.log(`Installing ${skillName} at ${ref.slice(0, 7)}...`);
      await installSkill(repoDir, skillName, undefined, skillPath);
    } finally {
      await cleanupClone(repoDir);
    }

    // Read or create lockfile
    const lockfile = (await readLockfile()) ?? { version: 1 as const, skills: {} };

    lockfile.skills[skillName] = {
      source: resolvedSource,
      path: skillPath,
      ref,
    };

    await writeLockfile(lockfile);
    console.log(`Added ${skillName} to skills.lock (ref: ${ref.slice(0, 7)})`);
  }));

program
  .command("remove <skill-name>")
  .description("Remove a skill and delete it from skills.lock")
  .action(action(async (skillName: string) => {
    const lockfile = await readLockfile();

    if (lockfile && lockfile.skills[skillName]) {
      delete lockfile.skills[skillName];
      await writeLockfile(lockfile);
    }

    await removeSkill(skillName);
    console.log(`Removed ${skillName}`);
  }));

program
  .command("update [skill-name]")
  .description("Update skills to latest versions from source repos")
  .action(action(async (skillName?: string) => {
    const lockfile = await readLockfile();
    if (!lockfile) die("No skills.lock found. Run 'skills-lock add' to start.");

    if (skillName && !lockfile.skills[skillName]) {
      die(`Skill '${skillName}' not found in skills.lock`);
    }

    const toUpdate = skillName
      ? { [skillName]: lockfile.skills[skillName] }
      : lockfile.skills;

    const oldLockfile = structuredClone(lockfile);

    for (const [name, entry] of Object.entries(toUpdate)) {
      console.log(`Checking ${name}...`);

      const repoDir = await resolveRepo(entry.source);
      let latestRef: string;
      try {
        latestRef = await resolveRef(repoDir);
      } finally {
        await cleanupClone(repoDir);
      }

      if (latestRef === entry.ref) {
        console.log(`  ${name} — already up to date`);
        continue;
      }

      console.log(`  ${name} — ${entry.ref.slice(0, 7)} → ${latestRef.slice(0, 7)}`);

      // Reinstall at the latest ref
      await removeSkill(name);
      await installSkill(entry.source, name, latestRef, entry.path);

      lockfile.skills[name] = {
        ...entry,
        ref: latestRef,
      };
    }

    const diff = diffLockfiles(oldLockfile, lockfile);
    if (diff.changed.length === 0) {
      console.log("Everything up to date.");
    } else {
      await writeLockfile(lockfile);
      console.log(`Updated ${diff.changed.length} skill(s).`);
    }
  }));

program
  .command("check")
  .description("Compare installed skills against skills.lock")
  .action(action(async () => {
    const lockfile = await readLockfile();
    if (!lockfile) die("No skills.lock found. Run 'skills-lock add' to start.");

    const installed = await scanInstalledSkills();
    const installedNames = new Set(installed.map((s) => s.name));
    const lockedNames = new Set(Object.keys(lockfile.skills));

    const missing = [...lockedNames].filter((n) => !installedNames.has(n));
    const extra = [...installedNames].filter((n) => !lockedNames.has(n));

    if (missing.length === 0 && extra.length === 0) {
      console.log("All skills in sync.");
      return;
    }

    if (missing.length > 0) {
      console.log("Missing (in lockfile but not installed):");
      for (const name of missing) {
        console.log(`  - ${name}`);
      }
    }

    if (extra.length > 0) {
      console.log("Extra (installed but not in lockfile):");
      for (const name of extra) {
        console.log(`  - ${name}`);
      }
    }

    process.exit(1);
  }));

program.parse();
