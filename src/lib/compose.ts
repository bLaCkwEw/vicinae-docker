import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { resolveSocketPath } from "./docker";
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
  socketPath?: string,
): Promise<string> {
  const files = sanitizeConfigFiles(configFiles, project);
  // `docker compose -p <project> -f <files> ...` (no cwd dependency when -f is given)
  const args = composeArgs(project, files, subcommand);
  // Point the CLI at the same socket the Engine API client uses (matters for
  // rootless Docker, where the default context may point at a missing
  // /var/run/docker.sock). An explicit DOCKER_HOST in the environment wins.
  const env = { ...process.env };
  if (!env.DOCKER_HOST) env.DOCKER_HOST = `unix://${resolveSocketPath(socketPath)}`;
  const { stdout, stderr } = await execFileAsync("docker", ["compose", ...args], {
    timeout: 120_000,
    env,
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

export async function composeUp(containers: ContainerItem[], socketPath?: string): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["up", "-d"], socketPath);
}

/** Up for a remembered (currently down) project: no live containers needed. */
export async function composeUpProject(
  project: string,
  files: string[],
  socketPath?: string,
): Promise<string> {
  if (files.length === 0) throw composeMissingFilesError(project);
  return runCompose(project, files, ["up", "-d"], socketPath);
}

export async function composeDown(containers: ContainerItem[], socketPath?: string): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["down"], socketPath);
}

export async function composeStart(
  containers: ContainerItem[],
  socketPath?: string,
): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["start"], socketPath);
}

export async function composeStop(containers: ContainerItem[], socketPath?: string): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["stop"], socketPath);
}

export async function composeRestart(
  containers: ContainerItem[],
  socketPath?: string,
): Promise<string> {
  const { project, files } = filesOrThrow(containers);
  return runCompose(project, files, ["restart"], socketPath);
}
