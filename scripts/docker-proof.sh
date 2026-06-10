#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/proof-server.yml"

bash "$ROOT_DIR/scripts/docker-preflight.sh" "$COMPOSE_FILE" 6300
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans
