import { createRequire } from "node:module";
import { join } from "node:path";
import { Command } from "commander";
import { readLockfile, writeLockfile } from "./lockfile.js";
import { resolveRepo, resolveRef, expandSource, cleanupClone, findSkills } from "./resolver.js";
import { installSkill, removeSkill, computeSkillHash, writeSkillMetadata } from "./installer.js";
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
    const installedMap = new Map(installed.map((s) => [s.name, s]));

    let count = 0;
    let skipped = 0;
    for (const [name, entry] of Object.entries(lockfile.skills)) {
      const installedSkill = installedMap.get(name);

      if (!opts.force && installedSkill) {
        const meta = installedSkill.metadata;
        if (!meta) {
          console.log(`  ${name} — reinstalling (installed outside skills-lock, no metadata)...`);
          await removeSkill(name);
        } else if (meta.ref !== entry.ref) {
          console.log(`  ${name} — reinstalling (wrong ref: have ${meta.ref.slice(0, 7)}, want ${entry.ref.slice(0, 7)})...`);
          await removeSkill(name);
        } else if (entry.integrity && meta.integrity !== entry.integrity) {
          console.log(`  ${name} — reinstalling (files modified on disk)...`);
          await removeSkill(name);
        } else {
          console.log(`  ${name} — already installed`);
          skipped++;
          continue;
        }
      } else if (opts.force && installedSkill) {
        console.log(`  ${name} — reinstalling at ${entry.ref.slice(0, 7)}...`);
        await removeSkill(name);
      } else {
        console.log(`  ${name} — installing from ${entry.source} at ${entry.ref.slice(0, 7)}...`);
      }

      await installSkill(entry.source, name, entry.ref, entry.path);

      const skillDir = join(".agents", "skills", name);
      const computedIntegrity = await computeSkillHash(skillDir);
      if (entry.integrity && computedIntegrity !== entry.integrity) {
        throw new Error(
          `Integrity check failed for '${name}': content does not match skills.lock.\n` +
          `Run 'skills-lock add ${entry.source} --skill ${name} --force' to re-pin.`
        );
      }
      await writeSkillMetadata(skillDir, entry.ref, computedIntegrity);
      count++;
    }

    console.log(
      count === 0 && skipped > 0
        ? "All skills verified."
        : count === 0
          ? "No skills to install."
          : `Installed ${count} skill(s).`
    );
  }));

program
  .command("add <source>")
  .description("Install a skill and add it to skills.lock")
  .option("--skill <name>", "Skill name within the source repo")
  .option("--force", "Reinstall and re-pin even if already in skills.lock")
  .action(action(async (source: string, opts: { skill?: string; force?: boolean }) => {
    const skillName = opts.skill;
    if (!skillName) die("Please specify a skill name with --skill <name>");

    // Guard against re-adding an already-pinned skill
    const existingLockfile = await readLockfile();
    if (existingLockfile?.skills[skillName] && !opts.force) {
      const ref = existingLockfile.skills[skillName].ref;
      console.log(`${skillName} is already in skills.lock (ref: ${ref.slice(0, 7)}). Use --force to reinstall.`);
      return;
    }

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

    // Compute hash and write local metadata
    const skillDir = join(".agents", "skills", skillName);
    const integrity = await computeSkillHash(skillDir);
    await writeSkillMetadata(skillDir, ref, integrity);

    // Read or create lockfile
    const lockfile = (await readLockfile()) ?? { version: 1 as const, skills: {} };

    lockfile.skills[skillName] = {
      source: resolvedSource,
      path: skillPath,
      ref,
      integrity,
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

    let updatedCount = 0;

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

      const skillDir = join(".agents", "skills", name);
      const integrity = await computeSkillHash(skillDir);
      await writeSkillMetadata(skillDir, latestRef, integrity);

      lockfile.skills[name] = { ...entry, ref: latestRef, integrity };

      // Write after each successful update so partial runs are safe
      await writeLockfile(lockfile);
      updatedCount++;
    }

    if (updatedCount === 0) {
      console.log(Object.keys(toUpdate).length === 0 ? "No skills to update." : "Everything up to date.");
    } else {
      console.log(`Updated ${updatedCount} skill(s).`);
    }
  }));

program
  .command("check")
  .description("Compare installed skills against skills.lock, including refs and file integrity")
  .action(action(async () => {
    const lockfile = await readLockfile();
    if (!lockfile) die("No skills.lock found. Run 'skills-lock add' to start.");

    const installed = await scanInstalledSkills();
    const installedMap = new Map(installed.map((s) => [s.name, s]));
    const lockedNames = new Set(Object.keys(lockfile.skills));

    const missing: string[] = [];
    const wrongRef: { name: string; have: string; want: string }[] = [];
    const modified: string[] = [];
    const unverified: string[] = [];
    const extra = installed.map((s) => s.name).filter((n) => !lockedNames.has(n));

    for (const [name, entry] of Object.entries(lockfile.skills)) {
      const installedSkill = installedMap.get(name);
      if (!installedSkill) {
        missing.push(name);
        continue;
      }

      const meta = installedSkill.metadata;
      if (!meta) {
        unverified.push(name);
        continue;
      }

      if (meta.ref !== entry.ref) {
        wrongRef.push({ name, have: meta.ref, want: entry.ref });
        continue;
      }

      if (entry.integrity) {
        const diskHash = await computeSkillHash(installedSkill.diskPath);
        if (diskHash !== entry.integrity) {
          modified.push(name);
          continue;
        }
      }
    }

    const hasIssues =
      missing.length > 0 ||
      wrongRef.length > 0 ||
      modified.length > 0 ||
      unverified.length > 0 ||
      extra.length > 0;

    if (!hasIssues) {
      console.log("All skills verified.");
      return;
    }

    if (missing.length > 0) {
      console.log("Missing (in lockfile but not installed):");
      for (const name of missing) console.log(`  - ${name}`);
    }

    if (wrongRef.length > 0) {
      console.log("Wrong ref (run 'skills-lock install' to fix):");
      for (const { name, have, want } of wrongRef) {
        console.log(`  - ${name}: have ${have.slice(0, 7)}, want ${want.slice(0, 7)}`);
      }
    }

    if (modified.length > 0) {
      console.log("Modified on disk (run 'skills-lock install' to restore):");
      for (const name of modified) console.log(`  - ${name}`);
    }

    if (unverified.length > 0) {
      console.log("Unverified (installed outside skills-lock — run 'skills-lock install' to pin):");
      for (const name of unverified) console.log(`  - ${name}`);
    }

    if (extra.length > 0) {
      console.log("Extra (installed but not in lockfile — run 'skills-lock remove <name>' to remove):");
      for (const name of extra) console.log(`  - ${name}`);
    }

    process.exit(1);
  }));

program.parse();
