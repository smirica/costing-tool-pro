#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
devcontainer_dir=$(dirname "$script_dir")
pid_file="$devcontainer_dir/.ngrok-pid"
url_file="$devcontainer_dir/.ngrok-url"
log_file="$devcontainer_dir/.ngrok-log"
policy_file="$devcontainer_dir/ngrok-traffic-policy.yml"

if [ -f "$pid_file" ]; then
  existing_pid=$(cat "$pid_file")
  case "$existing_pid" in
    ''|*[!0-9]*) existing_pid='' ;;
  esac
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "The ngrok tunnel is already running."
    exec sh "$script_dir/tunnel-status.sh"
  fi
  rm -f "$pid_file" "$url_file"
fi

if ! curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/api/access >/dev/null; then
  echo "The local app is not ready on http://127.0.0.1:3000." >&2
  echo "Wait for the dev server to finish starting, then try again." >&2
  exit 1
fi

if [ -n "${NGROK_URL:-}" ]; then
  nohup ngrok http 3000 \
    --url "$NGROK_URL" \
    --traffic-policy-file "$policy_file" \
    --log stdout \
    >"$log_file" 2>&1 &
else
  nohup ngrok http 3000 \
    --traffic-policy-file "$policy_file" \
    --log stdout \
    >"$log_file" 2>&1 &
fi

tunnel_pid=$!
printf '%s\n' "$tunnel_pid" > "$pid_file"

attempt=0
while [ "$attempt" -lt 20 ]; do
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "ngrok stopped before the tunnel became ready. See $log_file." >&2
    rm -f "$pid_file" "$url_file"
    exit 1
  fi
  if sh "$script_dir/tunnel-status.sh" --quiet; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "ngrok did not report a public URL within 20 seconds. See $log_file." >&2
exit 1
