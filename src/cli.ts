import { Command } from "commander";
import { readLockfile, writeLockfile, diffLockfiles } from "./lockfile.js";
import { resolveRepo, resolveRef, expandSource } from "./resolver.js";
import { installSkill, removeSkill } from "./installer.js";
import { scanInstalledSkills } from "./scanner.js";
import type { Lockfile } from "./types.js";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const program = new Command();

program
  .name("skills-lock")
  .description(
    "A lockfile for AI agent skills — pin, share, and reproduce skill installations"
  )
  .version("0.1.0");

program
  .command("init")
  .description("Generate skills.lock from currently installed skills")
  .action(async () => {
    const installed = await scanInstalledSkills();

    if (installed.length === 0) {
      console.log("No skills found in .agents/skills/ or .claude/skills/");
      console.log('Install skills with "npx skills add <source>" first.');
      return;
    }

    console.log(`Found ${installed.length} installed skill(s).`);
    console.log(
      "Note: cannot determine source repos from installed files."
    );
    console.log(
      'Use "skills-lock add <source> --skill <name>" to lock skills with full provenance.'
    );
  });

program
  .command("install")
  .description("Install skills from skills.lock")
  .action(async () => {
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
    for (const [name, entry] of Object.entries(lockfile.skills)) {
      if (installedNames.has(name)) {
        console.log(`  ${name} — already installed`);
        continue;
      }

      console.log(`  ${name} — installing from ${entry.source}...`);
      await installSkill(entry.source, name);
      count++;
    }

    console.log(
      count === 0
        ? "All skills already installed."
        : `Installed ${count} skill(s).`
    );
  });

program
  .command("add <source>")
  .description("Install a skill and add it to skills.lock")
  .option("--skill <name>", "Skill name within the source repo")
  .action(async (source: string, opts: { skill?: string }) => {
    const skillName = opts.skill;
    if (!skillName) die("Please specify a skill name with --skill <name>");

    console.log(`Installing ${skillName} from ${source}...`);
    await installSkill(source, skillName);

    // Resolve source to canonical URL and full commit SHA
    const resolvedSource = expandSource(source);
    const repoDir = await resolveRepo(source);
    const ref = await resolveRef(repoDir);

    // Read or create lockfile
    const lockfile = (await readLockfile()) ?? { version: 1 as const, skills: {} };

    lockfile.skills[skillName] = {
      source: resolvedSource,
      path: skillName,
      ref,
    };

    await writeLockfile(lockfile);
    console.log(`Added ${skillName} to skills.lock (ref: ${ref.slice(0, 7)})`);
  });

program
  .command("remove <skill-name>")
  .description("Remove a skill and delete it from skills.lock")
  .action(async (skillName: string) => {
    const lockfile = await readLockfile();

    if (lockfile && lockfile.skills[skillName]) {
      delete lockfile.skills[skillName];
      await writeLockfile(lockfile);
    }

    await removeSkill(skillName);
    console.log(`Removed ${skillName}`);
  });

program
  .command("update [skill-name]")
  .description("Update skills to latest versions from source repos")
  .action(async (skillName?: string) => {
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
      const latestRef = await resolveRef(repoDir);

      if (latestRef === entry.ref) {
        console.log(`  ${name} — already up to date`);
        continue;
      }

      console.log(`  ${name} — ${entry.ref.slice(0, 7)} → ${latestRef.slice(0, 7)}`);

      // Reinstall with latest
      await removeSkill(name);
      await installSkill(entry.source, name);

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
  });

program
  .command("check")
  .description("Compare installed skills against skills.lock")
  .action(async () => {
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
  });

program.parse();
