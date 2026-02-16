#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting LIFT portal..."
echo "Frontend: http://127.0.0.1:3000 (or next free port)"
echo "Backend:  http://127.0.0.1:5050/api/health (or next free port)"

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then
    kill "${BACK_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONT_PID:-}" ]]; then
    kill "${FRONT_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

(
  cd "${ROOT_DIR}/backend"
  npm run dev
) &
BACK_PID=$!

(
  cd "${ROOT_DIR}"
  npm start
) &
FRONT_PID=$!

while kill -0 "${BACK_PID}" >/dev/null 2>&1 && kill -0 "${FRONT_PID}" >/dev/null 2>&1; do
  sleep 1
done

wait "${BACK_PID}" || true
wait "${FRONT_PID}" || true
