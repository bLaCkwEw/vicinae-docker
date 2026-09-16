export interface ContainerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

export interface ContainerItem {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  labels: Record<string, string>;
  ports: ContainerPort[];
  composeProject?: string;
  composeService?: string;
  composeConfigFiles: string[];
  running: boolean;
  paused: boolean;
}

export interface ComposeProject {
  name: string;
  containers: ContainerItem[];
  configFiles: string[];
}
