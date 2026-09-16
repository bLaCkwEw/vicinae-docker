import { dirname } from "node:path";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  getPreferenceValues,
  open,
  showToast,
} from "@vicinae/api";
import {
  formatPorts,
  listContainers,
  pauseContainer,
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer,
  unpauseContainer,
} from "./lib/docker";
import { composeDown, composeRestart, composeStart, composeStop, composeUp } from "./lib/compose";
import type { ComposeProject, ContainerItem } from "./lib/types";

interface Preferences {
  socketPath: string;
}

const POLL_MS = 3000;
const STOP_TIMEOUT = 10;

function groupContainers(containers: ContainerItem[]): {
  projects: ComposeProject[];
  standalone: ContainerItem[];
} {
  const byProject = new Map<string, ContainerItem[]>();
  const standalone: ContainerItem[] = [];
  for (const c of containers) {
    if (c.composeProject) {
      const arr = byProject.get(c.composeProject) ?? [];
      arr.push(c);
      byProject.set(c.composeProject, arr);
    } else {
      standalone.push(c);
    }
  }
  const projects: ComposeProject[] = [...byProject.entries()].map(([name, members]) => ({
    name,
    containers: members.sort((a, b) => a.name.localeCompare(b.name)),
    configFiles: members.find((m) => m.composeConfigFiles.length > 0)?.composeConfigFiles ?? [],
  }));
  projects.sort((a, b) => a.name.localeCompare(b.name));
  standalone.sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
  return { projects, standalone };
}

function stateIcon(c: ContainerItem): { source: Icon; tintColor?: Color } {
  if (c.paused) return { source: Icon.Pause, tintColor: Color.Yellow };
  if (c.running) return { source: Icon.Checkmark, tintColor: Color.Green };
  if (c.state === "exited" || c.state === "created") return { source: Icon.Circle };
  return { source: Icon.Box };
}

export default function ManageContainers() {
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const outageNotified = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const prefs = getPreferenceValues<Preferences>();
      if (!silent) setIsLoading(true);
      const items = await listContainers(prefs.socketPath);
      setContainers(items);
      setError(null);
      outageNotified.current = false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = msg.includes("ENOENT")
        ? `Cannot reach Docker socket. Is Docker running?\n${msg}`
        : msg;
      setError(friendly);
      // A list is already on screen: the stale data would otherwise fail silently.
      // Notify once per outage, not on every 3s tick.
      setContainers((prev) => {
        if (prev.length > 0 && !outageNotified.current) {
          outageNotified.current = true;
          void showToast({ style: Toast.Style.Failure, title: "Lost connection to Docker", message: friendly });
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const t = setInterval(() => void refresh(true), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const mutate = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      const toast = await showToast({ style: Toast.Style.Animated, title: label });
      try {
        await fn();
        toast.style = Toast.Style.Success;
        toast.title = `${label} — done`;
        await refresh(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.style = Toast.Style.Failure;
        toast.title = `${label} failed`;
        toast.message = msg;
      }
    },
    [refresh],
  );

  const { projects, standalone } = useMemo(() => groupContainers(containers), [containers]);

  if (error && containers.length === 0 && !isLoading) {
    return (
      <List searchBarPlaceholder="Search containers by name, image or status...">
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Cannot reach Docker"
          description={error}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => void refresh(false)} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const itemActions = (c: ContainerItem, project?: ComposeProject) => (
    <ActionPanel>
      <ActionPanel.Section title="Container">
        {!c.running && !c.paused && (
          <Action
            title="Start"
            icon={Icon.Play}
            onAction={() =>
              void mutate(`Starting ${c.name}`, () =>
                startContainer(c.id, getPreferenceValues<Preferences>().socketPath),
              )
            }
          />
        )}
        {c.running && (
          <Action
            title="Stop"
            icon={Icon.Stop}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
            onAction={() =>
              void mutate(`Stopping ${c.name}`, () =>
                stopContainer(c.id, getPreferenceValues<Preferences>().socketPath, STOP_TIMEOUT),
              )
            }
          />
        )}
        {!c.paused && (
          <Action
            title="Restart"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() =>
              void mutate(`Restarting ${c.name}`, () =>
                restartContainer(c.id, getPreferenceValues<Preferences>().socketPath, STOP_TIMEOUT),
              )
            }
          />
        )}
        {c.running && !c.paused && (
          <Action
            title="Pause"
            icon={Icon.Pause}
            onAction={() =>
              void mutate(`Pausing ${c.name}`, () =>
                pauseContainer(c.id, getPreferenceValues<Preferences>().socketPath),
              )
            }
          />
        )}
        {c.paused && (
          <Action
            title="Unpause"
            icon={Icon.Play}
            onAction={() =>
              void mutate(`Unpausing ${c.name}`, () =>
                unpauseContainer(c.id, getPreferenceValues<Preferences>().socketPath),
              )
            }
          />
        )}
        <Action
          title="Remove"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["ctrl"], key: "x" }}
          onAction={async () => {
            if (
              await confirmAlert({
                title: `Remove ${c.name}?`,
                message: "The container must be stopped first. This cannot be undone.",
                primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
              })
            ) {
              await mutate(`Removing ${c.name}`, () =>
                removeContainer(c.id, getPreferenceValues<Preferences>().socketPath),
              );
            }
          }}
        />
      </ActionPanel.Section>

      {project && (
        <ActionPanel.Section title={`Compose: ${project.name}`}>
          <Action
            title="Compose Up"
            icon={Icon.Upload}
            onAction={() => void mutate(`Compose up ${project.name}`, () => composeUp(project.containers))}
          />
          <Action
            title="Compose Down"
            icon={Icon.Download}
            style={Action.Style.Destructive}
            onAction={async () => {
              if (
                await confirmAlert({
                  title: `Compose down ${project.name}?`,
                  message: "Stops and removes the project's containers and networks.",
                  primaryAction: { title: "Down", style: Alert.ActionStyle.Destructive },
                })
              ) {
                await mutate(`Compose down ${project.name}`, () => composeDown(project.containers));
              }
            }}
          />
          <Action
            title="Compose Start All"
            icon={Icon.Play}
            onAction={() => void mutate(`Starting ${project.name}`, () => composeStart(project.containers))}
          />
          <Action
            title="Compose Stop All"
            icon={Icon.Stop}
            onAction={() => void mutate(`Stopping ${project.name}`, () => composeStop(project.containers))}
          />
          <Action
            title="Compose Restart All"
            icon={Icon.ArrowClockwise}
            onAction={() =>
              void mutate(`Restarting ${project.name}`, () => composeRestart(project.containers))
            }
          />
          {project.configFiles.length > 0 && (
            <Action
              title="Open Compose File"
              icon={Icon.Code}
              onAction={() => void open(project.configFiles[0])}
            />
          )}
          {project.configFiles.length > 0 && (
            <Action.ShowInFinder
              title="Show Compose File Location"
              icon={Icon.Folder}
              path={project.configFiles[0]}
            />
          )}
        </ActionPanel.Section>
      )}

      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard title="Copy Container ID" content={c.id} />
        <Action.CopyToClipboard title="Copy Name" content={c.name} />
        <Action.CopyToClipboard title="Copy Image" content={c.image} />
      </ActionPanel.Section>
    </ActionPanel>
  );

  const renderItem = (c: ContainerItem, project?: ComposeProject) => (
    <List.Item
      key={c.id}
      title={c.name}
      subtitle={c.image}
      keywords={[c.image, c.state, c.status, c.composeService ?? "", c.shortId]}
      icon={stateIcon(c)}
      accessories={[{ text: c.paused ? "paused" : c.status }]}
      detail={
        <List.Item.Detail
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Name" text={c.name} />
              <List.Item.Detail.Metadata.Label title="State" text={`${c.state} — ${c.status}`} />
              <List.Item.Detail.Metadata.Label title="Image" text={c.image} />
              <List.Item.Detail.Metadata.Label title="ID" text={c.shortId} />
              <List.Item.Detail.Metadata.Label title="Ports" text={formatPorts(c.ports)} />
              <List.Item.Detail.Metadata.Label
                title="Created"
                text={c.created ? new Date(c.created * 1000).toLocaleString() : "—"}
              />
              {c.composeProject && (
                <List.Item.Detail.Metadata.Label title="Compose Project" text={c.composeProject} />
              )}
              {c.composeService && (
                <List.Item.Detail.Metadata.Label title="Compose Service" text={c.composeService} />
              )}
              {project && project.configFiles.length > 0 && (
                <>
                  <List.Item.Detail.Metadata.Label
                    title="Compose File"
                    text={project.configFiles.join(", ")}
                  />
                  <List.Item.Detail.Metadata.Label
                    title="Compose Folder"
                    text={dirname(project.configFiles[0])}
                  />
                </>
              )}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={itemActions(c, project)}
    />
  );

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search containers by name, image or status..."
    >
      {containers.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Box}
          title="No containers"
          description="No Docker containers found on this host."
        />
      ) : (
        <>
          {projects.map((p) => (
            <List.Section key={p.name} title={p.name} subtitle="Compose">
              {p.containers.map((c) => renderItem(c, p))}
            </List.Section>
          ))}
          {standalone.length > 0 && (
            <List.Section title="Containers" subtitle={`${standalone.length}`}>
              {standalone.map((c) => renderItem(c))}
            </List.Section>
          )}
        </>
      )}
    </List>
  );
}
