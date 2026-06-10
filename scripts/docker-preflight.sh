#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <compose-file> <port> [port ...]" >&2
  exit 2
fi

COMPOSE_FILE="$1"
shift
PORTS=("$@")

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or is not on PATH." >&2
  exit 1
fi

mapfile -t OWN_CONTAINERS < <(docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null || true)

is_own_container() {
  local id="$1"
  local own
  for own in "${OWN_CONTAINERS[@]}"; do
    if [[ -n "$own" && ( "$id" == "$own" || "$own" == "$id"* ) ]]; then
      return 0
    fi
  done
  return 1
}

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

CONFLICTS=()

echo "Checking Docker port conflicts for: ${PORTS[*]}"

for port in "${PORTS[@]}"; do
  mapfile -t containers < <(docker ps --filter "publish=$port" -q)

  for container in "${containers[@]}"; do
    if is_own_container "$container"; then
      continue
    fi

    if ! contains "$container" "${CONFLICTS[@]}"; then
      CONFLICTS+=("$container")
    fi
  done
done

if [[ ${#CONFLICTS[@]} -gt 0 ]]; then
  echo "Stopping containers that are already using Midnight local ports:"
  docker ps --format '  {{.ID}}  {{.Names}}  {{.Image}}  {{.Ports}}' "${CONFLICTS[@]/#/--filter=id=}"
  docker stop "${CONFLICTS[@]}"
fi

HOST_PORT_CONFLICTS=()

for port in "${PORTS[@]}"; do
  if docker ps --filter "publish=$port" -q | grep -q .; then
    continue
  fi

  if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$port" | grep -q .; then
    HOST_PORT_CONFLICTS+=("$port")
  fi
done

if [[ ${#HOST_PORT_CONFLICTS[@]} -gt 0 ]]; then
  echo "The following ports are still in use by non-Docker processes: ${HOST_PORT_CONFLICTS[*]}" >&2
  echo "Stop those processes, then rerun the command. Try: sudo lsof -iTCP:<port> -sTCP:LISTEN" >&2
  exit 1
fi

echo "Port preflight complete."
