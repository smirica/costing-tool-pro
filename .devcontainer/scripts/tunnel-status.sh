#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
devcontainer_dir=$(dirname "$script_dir")
url_file="$devcontainer_dir/.ngrok-url"
quiet=false

if [ "${1:-}" = "--quiet" ]; then
  quiet=true
fi

if ! tunnel_json=$(curl --fail --silent --show-error --max-time 3 http://127.0.0.1:4040/api/tunnels 2>/dev/null); then
  if [ "$quiet" = false ]; then
    echo "The ngrok tunnel is stopped."
  fi
  exit 1
fi

public_url=$(printf '%s' "$tunnel_json" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const value = JSON.parse(input);
  const tunnel = value.tunnels?.find(item => item.proto === "https") ?? value.tunnels?.[0];
  if (tunnel?.public_url) process.stdout.write(tunnel.public_url);
});
')

if [ -z "$public_url" ]; then
  if [ "$quiet" = false ]; then
    echo "ngrok is running but has not created a public HTTPS endpoint yet."
  fi
  exit 1
fi

printf '%s\n' "$public_url" > "$url_file"
if [ "$quiet" = false ]; then
  echo "Live tunnel: $public_url"
fi
