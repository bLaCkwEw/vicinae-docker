import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContainerItem } from "./types";

const execFileAsync = promisify(execFile);

function projectConfigFiles(containers: ContainerItem[]): string[] {
  for (const c of containers) {
    if (c.composeConfigFiles.length > 0) return c.composeConfigFiles;
  }
  return [];
}

function composeArgs(configFiles: string[], subcommand: string[]): string[] {
  const args: string[] = [];
  for (const f of configFiles) args.push("-f", f);
  args.push(...subcommand);
  return args;
}

async function runCompose(configFiles: string[], subcommand: string[]): Promise<string> {
  const args = composeArgs(configFiles, subcommand);
  // `docker compose ...` (plugin form, no cwd dependency when -f is given)
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

export async function composeUp(containers: ContainerItem[]): Promise<string> {
  const files = projectConfigFiles(containers);
  if (files.length === 0) throw composeMissingFilesError(containers[0]?.composeProject ?? "unknown");
  return runCompose(files, ["up", "-d"]);
}

export async function composeDown(containers: ContainerItem[]): Promise<string> {
  const files = projectConfigFiles(containers);
  if (files.length === 0) throw composeMissingFilesError(containers[0]?.composeProject ?? "unknown");
  return runCompose(files, ["down"]);
}

export async function composeStart(containers: ContainerItem[]): Promise<string> {
  const files = projectConfigFiles(containers);
  if (files.length === 0) throw composeMissingFilesError(containers[0]?.composeProject ?? "unknown");
  return runCompose(files, ["start"]);
}

export async function composeStop(containers: ContainerItem[]): Promise<string> {
  const files = projectConfigFiles(containers);
  if (files.length === 0) throw composeMissingFilesError(containers[0]?.composeProject ?? "unknown");
  return runCompose(files, ["stop"]);
}

export async function composeRestart(containers: ContainerItem[]): Promise<string> {
  const files = projectConfigFiles(containers);
  if (files.length === 0) throw composeMissingFilesError(containers[0]?.composeProject ?? "unknown");
  return runCompose(files, ["restart"]);
}
