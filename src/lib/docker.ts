import { existsSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import type { ContainerItem } from "./types";

const DEFAULT_SOCKET = "/var/run/docker.sock";
const API_VERSION = "v1.47";
const REQUEST_TIMEOUT_MS = 10_000;

interface EngineContainer {
  Id: string;
  Names?: string[];
  Image: string;
  State?: string;
  Status?: string;
  Created?: number;
  Labels?: Record<string, string>;
  Ports?: { IP?: string; PrivatePort: number; PublicPort?: number; Type: string }[];
}

function normalizeSocketPath(p: string): string {
  let s = p.trim();
  if (s.startsWith("unix://")) s = s.slice("unix://".length);
  if (s.startsWith("~/")) s = homedir() + s.slice(1);
  return s;
}

function dockerHostSocket(): string | null {
  const raw = process.env.DOCKER_HOST?.trim();
  if (!raw) return null;
  if (raw.startsWith("unix://")) return normalizeSocketPath(raw);
  // Only unix sockets are usable by the Engine API client; tcp/ssh need the CLI.
  return null;
}

function uid(): number | null {
  const getuid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  if (typeof getuid !== "function") return null;
  try {
    return getuid();
  } catch {
    return null;
  }
}

/**
 * Resolve which socket to talk to.
 *
 * An explicit non-default preference is always honored verbatim. The shipped
 * default (`/var/run/docker.sock`) acts as "auto": when it doesn't exist —
 * the norm for rootless Docker on Fedora (`$XDG_RUNTIME_DIR/docker.sock`) —
 * the first existing candidate wins. Returns the preference/default unchanged
 * when nothing exists so callers still surface a familiar path in errors.
 */
export function resolveSocketPath(preferred?: string): string {
  const raw = preferred?.trim() ?? "";
  if (raw && normalizeSocketPath(raw) !== DEFAULT_SOCKET) return normalizeSocketPath(raw);

  const xdg = process.env.XDG_RUNTIME_DIR?.trim();
  const home = process.env.HOME?.trim() || homedir();
  const id = uid();
  const userRun = id !== null ? `/run/user/${id}` : null;
  const candidates = [
    raw ? normalizeSocketPath(raw) : null,
    dockerHostSocket(),
    xdg ? `${xdg}/docker.sock` : null,
    userRun ? `${userRun}/docker.sock` : null,
    home ? `${home}/.docker/run/docker.sock` : null,
    xdg ? `${xdg}/podman/podman.sock` : null,
    userRun ? `${userRun}/podman/podman.sock` : null,
    "/run/podman/podman.sock",
    "/var/run/docker.sock",
    "/run/docker.sock",
  ];
  for (const c of new Set(candidates)) {
    if (c && existsSync(c)) return c;
  }
  return raw ? normalizeSocketPath(raw) : DEFAULT_SOCKET;
}

function request(
  socketPath: string,
  method: string,
  path: string,
  query?: Record<string, string | number | boolean>,
): Promise<{ status: number; body: string }> {
  const qs = query
    ? "?" +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path: `/${API_VERSION}${path}${qs}`, method },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Docker API request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.end();
  });
}

function failIfError(action: string, name: string, status: number, body: string): void {
  if (status >= 200 && status < 300) return;
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) detail = parsed.message;
  } catch {
    // keep raw body
  }
  throw new Error(`${action} ${name} failed (HTTP ${status}): ${detail || "unknown error"}`);
}

function isSocketUnreachable(msg: string): boolean {
  return (
    msg.includes("ENOENT") || msg.includes("ECONNREFUSED") || msg.includes("EACCES")
  );
}

function socketUnreachableError(sock: string, msg: string): Error {
  const permission =
    " If the socket exists, check read/write access (usually the `docker` group).";
  return new Error(
    `Cannot reach Docker socket at ${sock}. Is Docker running? ` +
      `(${msg}) Hint: rootless Docker on Fedora uses $XDG_RUNTIME_DIR/docker.sock — ` +
      `leave the socketPath preference at its default for auto-detect, or set it explicitly.` +
      permission,
  );
}

async function requestWrapped(
  socketPath: string,
  method: string,
  path: string,
  query?: Record<string, string | number | boolean>,
): Promise<{ status: number; body: string }> {
  const sock = resolveSocketPath(socketPath);
  try {
    return await request(sock, method, path, query);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isSocketUnreachable(msg)) throw socketUnreachableError(sock, msg);
    throw e;
  }
}

function parseName(names?: string[]): string {
  if (!names || names.length === 0) return "unnamed";
  return (names[0] ?? "unnamed").replace(/^\//, "");
}

function parseConfigFiles(labels: Record<string, string>): string[] {
  const raw =
    labels["com.docker.compose.project.config_files"] ??
    labels["com.docker.compose.project.config-files"] ??
    "";
  if (!raw.trim()) return [];
  // Compose writes this label as a comma-separated list of absolute paths.
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function listContainers(socketPath?: string): Promise<ContainerItem[]> {
  const { status, body } = await requestWrapped(socketPath ?? "", "GET", "/containers/json", {
    all: 1,
  });
  failIfError("List", "containers", status, body);
  let infos: EngineContainer[];
  try {
    infos = JSON.parse(body) as EngineContainer[];
  } catch {
    throw new Error(`List containers failed (HTTP ${status}): unexpected non-JSON response`);
  }
  return infos.map((c) => {
    const labels = c.Labels ?? {};
    const state = c.State ?? "unknown";
    return {
      id: c.Id,
      shortId: c.Id.slice(0, 12),
      name: parseName(c.Names),
      image: c.Image,
      state,
      status: c.Status ?? state,
      created: c.Created ?? 0,
      labels,
      ports: (c.Ports ?? []) as ContainerItem["ports"],
      composeProject: labels["com.docker.compose.project"],
      composeService: labels["com.docker.compose.service"],
      composeConfigFiles: parseConfigFiles(labels),
      running: state === "running",
      paused: state === "paused",
    };
  });
}

export async function startContainer(id: string, socketPath?: string): Promise<void> {
  const { status, body } = await requestWrapped(
    socketPath ?? "",
    "POST",
    `/containers/${id}/start`,
  );
  failIfError("Start", id.slice(0, 12), status, body);
}

export async function stopContainer(id: string, socketPath?: string, timeout = 10): Promise<void> {
  const { status, body } = await requestWrapped(
    socketPath ?? "",
    "POST",
    `/containers/${id}/stop`,
    { t: timeout },
  );
  failIfError("Stop", id.slice(0, 12), status, body);
}

export async function restartContainer(
  id: string,
  socketPath?: string,
  timeout = 10,
): Promise<void> {
  const { status, body } = await requestWrapped(
    socketPath ?? "",
    "POST",
    `/containers/${id}/restart`,
    { t: timeout },
  );
  failIfError("Restart", id.slice(0, 12), status, body);
}

export async function removeContainer(id: string, socketPath?: string): Promise<void> {
  // Safe default: no force, no volumes. Container must be stopped first.
  const { status, body } = await requestWrapped(socketPath ?? "", "DELETE", `/containers/${id}`);
  failIfError("Remove", id.slice(0, 12), status, body);
}

export async function pauseContainer(id: string, socketPath?: string): Promise<void> {
  const { status, body } = await requestWrapped(
    socketPath ?? "",
    "POST",
    `/containers/${id}/pause`,
  );
  failIfError("Pause", id.slice(0, 12), status, body);
}

export async function unpauseContainer(id: string, socketPath?: string): Promise<void> {
  const { status, body } = await requestWrapped(
    socketPath ?? "",
    "POST",
    `/containers/${id}/unpause`,
  );
  failIfError("Unpause", id.slice(0, 12), status, body);
}

export function formatPorts(ports: ContainerItem["ports"]): string {
  if (!ports || ports.length === 0) return "—";
  return ports
    .map((p) => {
      if (p.PublicPort) return `${p.PublicPort}→${p.PrivatePort}/${p.Type}`;
      return `${p.PrivatePort}/${p.Type}`;
    })
    .join(", ");
}
