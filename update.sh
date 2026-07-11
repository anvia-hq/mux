#!/usr/bin/env bash

set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

git pull
docker compose build --no-cache
docker compose down
docker compose up -d
