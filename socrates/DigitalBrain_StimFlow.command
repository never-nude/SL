#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

BUILD_ID="1772498015"
DEFAULT_PORT="${PORT:-6657}"
MAX_PORT=6699

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required but was not found."
  echo "Install Python 3 and run this launcher again."
  read -r "?Press Enter to close..."
  exit 1
fi

is_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

probe_stimflow() {
  local port="$1"
  curl -fsS --max-time 2 "http://127.0.0.1:${port}/model/stimflow/" >/dev/null 2>&1
}

choose_free_port() {
  local p="$1"
  while [ "$p" -le "$MAX_PORT" ]; do
    if ! is_listening "$p"; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
  done
  return 1
}

open_safari() {
  local port="$1"
  local ts
  ts="$(date +%s)"
  local url="http://127.0.0.1:${port}/model/stimflow/?v=${BUILD_ID}&ts=${ts}"
  echo "Opening Safari: $url"
  open -a Safari "$url" || true
  osascript -e 'tell application "Safari" to activate' >/dev/null 2>&1 || true
}

port="$DEFAULT_PORT"
if is_listening "$port"; then
  if probe_stimflow "$port"; then
    echo "Found existing local server on port $port."
    open_safari "$port"
    echo "Launcher finished (reused existing server)."
    exit 0
  fi

  echo "Port $port is already in use by another process."
  next_port="$(choose_free_port $((port + 1)) || true)"
  if [ -z "${next_port:-}" ]; then
    echo "ERROR: no free port found in range ${DEFAULT_PORT}-${MAX_PORT}."
    read -r "?Press Enter to close..."
    exit 1
  fi
  port="$next_port"
fi

LOG_FILE="/tmp/digitalbrain_stimflow_${port}.log"
echo "Serving ${ROOT_DIR} on http://127.0.0.1:${port}/"
echo "Log file: ${LOG_FILE}"
python3 -m http.server "$port" --bind 127.0.0.1 >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup INT TERM EXIT

ready=0
for _ in {1..80}; do
  if probe_stimflow "$port"; then
    ready=1
    break
  fi
  sleep 0.1
done

if [ "$ready" -ne 1 ]; then
  echo "ERROR: server did not become ready in time."
  echo "Last log lines:"
  tail -n 30 "$LOG_FILE" || true
  read -r "?Press Enter to close..."
  exit 1
fi

open_safari "$port"
echo
echo "DigitalBrain StimFlow is running."
echo "Press Control+C in this window to stop the local server."
wait "$SERVER_PID"
