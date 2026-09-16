import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { ContainerItem } from "./types";

const execFileAsync = promisify(execFile);

function projectName(containers: ContainerItem[]): string {
  return containers[0]?.composeProject ?? "unknown";
}

function projectConfigFiles(containers: ContainerItem[]): string[] {
  for (const c of containers) {
    if (c.composeConfigFiles.length > 0) return c.composeConfigFiles;
  }
  return [];
}

/** Label values are container-controlled: only allow absolute paths, never flags. */
function sanitizeConfigFiles(files: string[], project: string): string[] {
  const clean = files.filter((f) => isAbsolute(f) && !f.startsWith("-"));
  if (clean.length !== files.length) {
    throw new Error(
      `Refusing to run compose for project "${project}": suspicious config file path in container labels.`,
    );
  }
  return clean;
}

function composeArgs(project: string, configFiles: string[], subcommand: string[]): string[] {
  const args: string[] = ["-p", project];
  for (const f of configFiles) args.push("-f", f);
  args.push(...subcommand);
  return args;
}

async function runCompose(
  project: string,
  configFiles: string[],
  subcommand: string[],
): Promise<string> {
  const files = sanitizeConfigFiles(configFiles, project);
  // `docker compose -p <project> -f <files> ...` (no cwd dependency when -f is given)
  const args = composeArgs(project, files, subcommand);
  const { stdout, stderr } = await execFileAsync("docker", ["compose", ...args], {
    timeout: 120_000,
  });
  return (stdout + stderr).trim();
}

export function composeMissingFilesError(project: string): Error {
  return new Error(
    `No compose config files found for project "${project}" (missing com.docker.compose.project.config_files label). Is this a real compose project?`,
  );
}

function filesOrThrow(containers: ContainerItem[]): { project: string; files: string[] } {
  const project = projectName(containers);
  const files = projectConfigFiles(containers);
  if (files.length === 0) throw composeMissingFilesError(project);
  return { project, files };
}

export async function composeUp(containers: ContainerItem[]): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["up", "-d"]);
}

/** Up for a remembered (currently down) project: no live containers needed. */
export async function composeUpProject(project: string, files: string[]): Promise<string> {
  if (files.length === 0) throw composeMissingFilesError(project);
  return runCompose(project, files, ["up", "-d"]);
}

export async function composeDown(containers: ContainerItem[]): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["down"]);
}

export async function composeStart(containers: ContainerItem[]): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["start"]);
}

export async function composeStop(containers: ContainerItem[]): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["stop"]);
}

export async function composeRestart(containers: ContainerItem[]): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["restart"]);
}
