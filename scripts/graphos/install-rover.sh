#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ROVER_VERSION="${ROVER_VERSION:-0.36.2}"
INSTALL_ROOT="${ROOT_DIR}/.ci/tools/rover/${ROVER_VERSION}"
ROVER_BIN="${INSTALL_ROOT}/rover"

if [[ -x "${ROVER_BIN}" ]]; then
  printf '%s\n' "${ROVER_BIN}"
  exit 0
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "${OS}:${ARCH}" in
  linux:x86_64)
    TARGET="x86_64-unknown-linux-gnu"
    ;;
  linux:aarch64|linux:arm64)
    TARGET="aarch64-unknown-linux-gnu"
    ;;
  darwin:x86_64)
    TARGET="x86_64-apple-darwin"
    ;;
  darwin:arm64)
    TARGET="aarch64-apple-darwin"
    ;;
  *)
    echo "Unsupported OS/ARCH for Rover install: ${OS}/${ARCH}" >&2
    exit 1
    ;;
esac

ARCHIVE="rover-v${ROVER_VERSION}-${TARGET}.tar.gz"
URL="https://github.com/apollographql/rover/releases/download/v${ROVER_VERSION}/${ARCHIVE}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${INSTALL_ROOT}"
curl -fsSL "${URL}" -o "${TMP_DIR}/${ARCHIVE}"
tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "${INSTALL_ROOT}"

if [[ ! -x "${ROVER_BIN}" ]]; then
  DISCOVERED_BIN="$(find "${INSTALL_ROOT}" -type f -name rover | head -n 1 || true)"
  if [[ -n "${DISCOVERED_BIN}" ]]; then
    mv "${DISCOVERED_BIN}" "${ROVER_BIN}"
  fi
fi

chmod +x "${ROVER_BIN}"
printf '%s\n' "${ROVER_BIN}"
