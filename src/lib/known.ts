import { isAbsolute } from "node:path";
import { LocalStorage } from "@vicinae/api";
import type { ComposeProject } from "./types";

export interface KnownProject {
  project: string;
  files: string[];
  /** Epoch ms of the last poll that saw this project live. */
  lastSeen: number;
}

const STORAGE_KEY = "known-compose-projects-v1";
/** Refresh persisted lastSeen at most this often; file-set changes always persist. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;
let lastWriteMs = 0;

/** All entries must be absolute paths; a single bad one rejects the whole entry. */
function validFiles(files: unknown): string[] | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  if (!files.every((f): f is string => typeof f === "string" && f.length > 0 && isAbsolute(f))) {
    return null;
  }
  return files as string[];
}

function sanitizeLoaded(raw: unknown): KnownProject[] {
  if (!Array.isArray(raw)) return [];
  const out: KnownProject[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const { project, files, lastSeen } = e as Record<string, unknown>;
    const cleanFiles = validFiles(files);
    if (typeof project !== "string" || !project || !cleanFiles) continue;
    out.push({
      project,
      files: cleanFiles,
      lastSeen: typeof lastSeen === "number" ? lastSeen : 0,
    });
  }
  return out;
}

export async function loadKnownProjects(): Promise<KnownProject[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    return sanitizeLoaded(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

async function saveKnownProjects(known: KnownProject[]): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(known));
}

/**
 * Merge live projects into the known list (keyed by project name).
 * Writes to storage only when the set actually changed. Returns the new list.
 */
export async function rememberProjects(live: ComposeProject[]): Promise<KnownProject[]> {
  const known = await loadKnownProjects();
  const now = Date.now();
  const byName = new Map(known.map((k) => [k.project, k]));
  for (const p of live) {
    const prev = byName.get(p.name);
    const files = p.configFiles.length > 0 ? p.configFiles : (prev?.files ?? []);
    // Never persist file-less entries: they can't be Up'd and would churn
    // the store (load drops them, so every poll would look like a change).
    if (files.length === 0) {
      byName.delete(p.name);
      continue;
    }
    byName.set(p.name, { project: p.name, files, lastSeen: now });
  }
  const next = [...byName.values()].sort((a, b) => a.project.localeCompare(b.project));
  // Compare ignoring lastSeen: persist on project/file changes, otherwise rarely.
  const sig = (list: KnownProject[]) =>
    JSON.stringify(list.map((k) => [k.project, k.files]));
  if (sig(next) !== sig(known) || now - lastWriteMs > LAST_SEEN_WRITE_INTERVAL_MS) {
    await saveKnownProjects(next);
    lastWriteMs = now;
  }
  return next;
}

/** Forget a project (unlist only — never touches the compose files). */
export async function forgetProject(project: string): Promise<KnownProject[]> {
  const next = (await loadKnownProjects()).filter((k) => k.project !== project);
  await saveKnownProjects(next);
  return next;
}
