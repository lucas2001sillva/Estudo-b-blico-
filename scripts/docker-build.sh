#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export BUILDX_CONFIG="${BUILDX_CONFIG:-${TMPDIR:-/tmp}/vereda-buildx}"
build_options=()
# Honor an existing trusted proxy CA without copying it into the final image.
if [[ -n "${NODE_EXTRA_CA_CERTS:-}" && -f "$NODE_EXTRA_CA_CERTS" ]]; then
  build_options+=(--secret "id=build_ca,src=$NODE_EXTRA_CA_CERTS")
elif [[ -n "${SSL_CERT_FILE:-}" && -f "$SSL_CERT_FILE" ]]; then
  build_options+=(--secret "id=build_ca,src=$SSL_CERT_FILE")
fi
docker build "${build_options[@]}" --tag "${1:-vereda-biblica:local}" .
