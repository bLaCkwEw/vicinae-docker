import http from "node:http";
import type { ContainerItem } from "./types";

const DEFAULT_SOCKET = "/var/run/docker.sock";
const API_VERSION = "v1.47";

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
  return raw
    .split(/[,;:]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function listContainers(socketPath?: string): Promise<ContainerItem[]> {
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "GET", "/containers/json", { all: 1 });
  failIfError("List", "containers", status, body);
  const infos = JSON.parse(body) as EngineContainer[];
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
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "POST", `/containers/${id}/start`);
  failIfError("Start", id.slice(0, 12), status, body);
}

export async function stopContainer(id: string, socketPath?: string, timeout = 10): Promise<void> {
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "POST", `/containers/${id}/stop`, { t: timeout });
  failIfError("Stop", id.slice(0, 12), status, body);
}

export async function restartContainer(
  id: string,
  socketPath?: string,
  timeout = 10,
): Promise<void> {
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "POST", `/containers/${id}/restart`, { t: timeout });
  failIfError("Restart", id.slice(0, 12), status, body);
}

export async function removeContainer(id: string, socketPath?: string): Promise<void> {
  // Safe default: no force, no volumes. Container must be stopped first.
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "DELETE", `/containers/${id}`);
  failIfError("Remove", id.slice(0, 12), status, body);
}

export async function pauseContainer(id: string, socketPath?: string): Promise<void> {
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "POST", `/containers/${id}/pause`);
  failIfError("Pause", id.slice(0, 12), status, body);
}

export async function unpauseContainer(id: string, socketPath?: string): Promise<void> {
  const sock = socketPath?.trim() || DEFAULT_SOCKET;
  const { status, body } = await request(sock, "POST", `/containers/${id}/unpause`);
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
