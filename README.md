# Docker for Vicinae

A [Vicinae](https://docs.vicinae.com/) extension to list and control local Docker
containers and Compose projects — all from the launcher.

![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Single `Manage Docker Containers` view** — searchable list of all containers,
  grouped by Compose project, with a detail panel (name, state, image, ID,
  ports, created date, compose file/folder)
- **Container actions** — Start, Stop, Restart, Remove (with confirmation),
  Pause/Unpause, Copy ID / Name / Image
- **Compose project actions** — Up, Down (with confirmation), Start All,
  Stop All, Restart All, plus Open Compose File and Show Compose File Location
- **Known compose projects** — projects stay listed after Down so you can Up
  them later (with confirmation); entries with missing files are marked
  unavailable, and Forget removes list entries without touching files
- **Live updates** — silent 3s poll while the view is open, instant refresh
  after every action, no caching
- **Configurable socket** — `socketPath` preference (default
  `/var/run/docker.sock` acts as auto-detect: `$DOCKER_HOST`,
  `$XDG_RUNTIME_DIR/docker.sock` for rootless Docker, then Podman sockets,
  then the default). Set another path to override (the default value always
  means auto-detect); `unix://` and `~/` prefixes are accepted. Compose
  actions point `DOCKER_HOST` at the same resolved socket. Note: a non-`unix://`
  `DOCKER_HOST` (tcp/ssh) is honored by Compose but not by the Engine API
  client, which only speaks over unix sockets — the two can point at different
  daemons in that setup.

## Requirements

- Vicinae (Linux) with TypeScript extension support
- Access to the Docker socket (usually means your user is in the `docker` group)
- `docker` CLI with the Compose plugin — only needed for Compose Up/Down/Start/Stop/Restart

## Install

From the extension source tree:

```bash
pnpm install
pnpm build
```

No Vicinae restart is required in most cases — if the command doesn't show up,
restart the daemon once:

```bash
systemctl --user restart vicinae
```

Then search for **Manage Docker Containers** in root search.

For development with live reload:

```bash
pnpm dev
```

## How it works

- Container state and lifecycle ops talk directly to the Docker Engine API over
  the unix socket.
- Compose Up/Down/etc. shell out to `docker compose -f <files> …`, using the
  config-file paths from the `com.docker.compose.project.config_files` label.
- No background daemon, no stored state: polling only runs while the view is open.

## Credits

- Extension icon: Docker mark from [Simple Icons](https://simpleicons.org/?q=docker&modal=icon) (CC0).

## License

MIT — see [LICENSE](LICENSE).
