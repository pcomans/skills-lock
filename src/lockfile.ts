import { readFile, writeFile } from "node:fs/promises";
import type { Lockfile, LockfileDiff } from "./types.js";

const LOCKFILE_PATH = "skills.lock";

/**
 * Read and parse skills.lock from the current directory.
 * Returns null if the file doesn't exist.
 */
export async function readLockfile(
  path: string = LOCKFILE_PATH
): Promise<Lockfile | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    validateLockfile(parsed);
    return parsed as Lockfile;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Write a lockfile to disk with sorted keys for deterministic output.
 */
export async function writeLockfile(
  lockfile: Lockfile,
  path: string = LOCKFILE_PATH
): Promise<void> {
  validateLockfile(lockfile);

  // Sort skills by name for deterministic output
  const sorted: Lockfile = {
    version: lockfile.version,
    skills: Object.fromEntries(
      Object.entries(lockfile.skills).sort(([a], [b]) => a.localeCompare(b))
    ),
  };

  await writeFile(path, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

/**
 * Validate that an object conforms to the Lockfile schema.
 * Throws on invalid input.
 */
export function validateLockfile(data: unknown): asserts data is Lockfile {
  if (typeof data !== "object" || data === null) {
    throw new Error("Lockfile must be a JSON object");
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new Error(`Unsupported lockfile version: ${obj.version}`);
  }

  if (typeof obj.skills !== "object" || obj.skills === null) {
    throw new Error("Lockfile must have a 'skills' object");
  }

  const skills = obj.skills as Record<string, unknown>;

  for (const [name, entry] of Object.entries(skills)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Skill '${name}' must be an object`);
    }

    const skill = entry as Record<string, unknown>;
    const required = ["source", "path", "ref"] as const;

    for (const field of required) {
      if (typeof skill[field] !== "string") {
        throw new Error(
          `Skill '${name}' missing or invalid field '${field}'`
        );
      }
    }

    // Enforce full 40-char hex commit SHA
    if (!/^[0-9a-f]{40}$/.test(skill["ref"] as string)) {
      throw new Error(
        `Skill '${name}' has invalid ref '${skill["ref"]}' — must be a full 40-character commit SHA`
      );
    }
  }
}

/**
 * Compute the diff between two lockfile states.
 */
export function diffLockfiles(
  oldLock: Lockfile,
  newLock: Lockfile
): LockfileDiff {
  const oldNames = new Set(Object.keys(oldLock.skills));
  const newNames = new Set(Object.keys(newLock.skills));

  const added = [...newNames].filter((n) => !oldNames.has(n));
  const removed = [...oldNames].filter((n) => !newNames.has(n));
  const changed = [...newNames].filter((n) => {
    if (!oldNames.has(n)) return false;
    return oldLock.skills[n].ref !== newLock.skills[n].ref;
  });

  return { added, removed, changed };
}
