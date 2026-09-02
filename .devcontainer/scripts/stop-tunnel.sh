#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
devcontainer_dir=$(dirname "$script_dir")
pid_file="$devcontainer_dir/.ngrok-pid"
url_file="$devcontainer_dir/.ngrok-url"

if [ ! -f "$pid_file" ]; then
  rm -f "$url_file"
  echo "The ngrok tunnel is already stopped."
  exit 0
fi

tunnel_pid=$(cat "$pid_file")
case "$tunnel_pid" in
  ''|*[!0-9]*) tunnel_pid='' ;;
esac

if [ -n "$tunnel_pid" ] && kill -0 "$tunnel_pid" 2>/dev/null; then
  kill "$tunnel_pid"
fi

rm -f "$pid_file" "$url_file"
echo "The ngrok tunnel is stopped."
