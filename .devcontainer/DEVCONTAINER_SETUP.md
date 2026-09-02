# CostingTool Pro dev container and ngrok

The dev container provides the Debian/glibc Node environment used by Winding
Intelligence. Local development and the public tunnel have separate lifecycles:

- the local app starts on port 3000 when the dev container starts;
- ngrok remains stopped until a live review is explicitly requested;
- the ngrok inspector is available on port 4040 only while ngrok is running;
- publishing the Winding Intelligence Sites project remains a separate,
  explicitly approved sync step.

## One-time setup

1. Copy `.devcontainer/.env.devcontainer.example` to
   `.devcontainer/.env.devcontainer`.
2. Fill in the site password, Azure Content Understanding values, and
   `NGROK_AUTHTOKEN`.
3. Keep the assigned `NGROK_URL` value unless the ngrok account changes.
4. In VS Code, run **Dev Containers: Reopen in Container**.

The real `.env.devcontainer` file is ignored by Git and Docker. Only the
placeholder example is committed.

## Normal local work

Use `http://localhost:3000` for development and review. Starting or rebuilding
the dev container does not expose the app publicly.

## Explicit ngrok review

Only start the tunnel when a live review has been requested:

```bash
npm run tunnel:start
npm run tunnel:status
```

The tunnel command verifies that the local app is responding before opening the
public endpoint. The assigned URL is:

`https://viewable-sympathy-recipient.ngrok-free.dev`

The authenticated account keeps this assigned dev-domain address reusable across
container rebuilds. The agent connection itself is temporary and works only while
ngrok is running.

When live review is finished:

```bash
npm run tunnel:stop
```

This does not publish the Sites project. A production sync is still performed
only after an explicit request, using the validated local source.

## Connection check

Inside the dev container:

```bash
curl http://localhost:4040/api/tunnels
```

The JSON response should contain the HTTPS `public_url`. If the tunnel is
stopped, the inspector will not return an active tunnel.

## Troubleshooting

- `The local app is not ready`: wait for the dev server to finish compiling,
  then run `npm run tunnel:start` again.
- A Vite “host is not allowed” response means the ngrok hostname is missing from
  `server.allowedHosts` in `vite.config.ts`.
- If ngrok exits early, inspect `.devcontainer/.ngrok-log`; it is ignored by
  Git.
- To rebuild after container-level changes, use **Dev Containers: Rebuild
  Container**.
