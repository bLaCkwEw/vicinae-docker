# AGENTS.md — vicinae-docker

Keep this file and README.md up to date with every change: structure, commands,
features, and notes must reflect the current state of the repo.

Vicinae extension (TypeScript + React via `@vicinae/api`) to manage local Docker
containers and Compose projects. Package manager: **pnpm**.

## Structure

- `package.json` — extension manifest (commands, preferences, scripts)
- `src/manage-containers.tsx` — the single `Manage Docker Containers` view
- `src/lib/docker.ts` — Docker Engine API client over the unix socket (no deps),
  incl. `resolveSocketPath()` auto-detect (explicit pref > DOCKER_HOST >
  $XDG_RUNTIME_DIR/docker.sock > /run/user/<uid>/docker.sock >
  ~/.docker/run/docker.sock > podman sockets > /var/run/docker.sock)
- `src/lib/compose.ts` — `docker compose` CLI wrapper (up/down/start/stop/restart),
  sets `DOCKER_HOST=unix://<resolved>` unless already in env
- `src/lib/known.ts` — remembered compose projects in `LocalStorage` (for Up after Down)
- `src/lib/types.ts` — shared types
- `assets/extension_icon.png` — extension icon

## Commands

```bash
pnpm install    # install deps
pnpm dev        # vici develop — live reload in Vicinae
pnpm build      # vici build — typecheck + install to Vicinae
```

Direct binaries (avoids pnpm's build-script gate): `./node_modules/.bin/tsc --noEmit`,
`./node_modules/.bin/vici lint`.

## Notes

- No native/npm Docker deps on purpose (`vici build` can't bundle them).
- Docker state: Engine API over resolved `socketPath` (default pref acts as auto),
  3s silent poll, no cache. The Engine client only speaks unix sockets, so a
  non-`unix://` DOCKER_HOST is ignored there but still honored by Compose.
- Compose file paths come from the `com.docker.compose.project.config_files` label.
- After `pnpm build`, the daemon sometimes needs `systemctl --user restart vicinae`
  to pick up the new bundle.
