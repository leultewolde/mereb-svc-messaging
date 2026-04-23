#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ROVER_BIN="$(${ROOT_DIR}/scripts/graphos/install-rover.sh)"

APOLLO_KEY="${ROVER_APOLLO_KEY:-${APOLLO_KEY:-}}"
if [[ -z "${APOLLO_KEY}" ]]; then
  echo "ROVER_APOLLO_KEY or APOLLO_KEY must be set" >&2
  exit 1
fi

GRAPHOS_GRAPH_ID="${GRAPHOS_GRAPH_ID:-mereb-supergraph}"
SUBGRAPH_NAME="${SUBGRAPH_NAME:-}"
if [[ -z "${SUBGRAPH_NAME}" ]]; then
  echo "SUBGRAPH_NAME must be set" >&2
  exit 1
fi

SCHEMA_PATH="${SCHEMA_PATH:-${ROOT_DIR}/schema.graphql}"
GRAPHOS_VARIANTS="${GRAPHOS_VARIANTS:-dev,stg,prd}"

if [[ ! -f "${SCHEMA_PATH}" ]]; then
  echo "Schema file not found: ${SCHEMA_PATH}" >&2
  exit 1
fi

for variant in ${GRAPHOS_VARIANTS//,/ }; do
  variant="$(echo "${variant}" | xargs)"
  [[ -n "${variant}" ]] || continue

  echo "Checking ${SUBGRAPH_NAME} against ${GRAPHOS_GRAPH_ID}@${variant}"
  APOLLO_KEY="${APOLLO_KEY}" "${ROVER_BIN}" subgraph check "${GRAPHOS_GRAPH_ID}@${variant}" \
    --name "${SUBGRAPH_NAME}" \
    --schema "${SCHEMA_PATH}"
done
