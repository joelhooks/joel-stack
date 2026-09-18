#!/usr/bin/env bash
# Vendor shallow git source mirrors under .agent_sources/github.com/<owner>/<repo>.
# Reference-only — never a runtime dependency. Refresh: ./scripts/vendor-agent-sources.sh --refresh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${ROOT}/.agent_sources/github.com"
REFRESH=false

for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=true ;;
    -h | --help)
      echo "Usage: $0 [--refresh]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

clone_source() {
  local owner="$1" repo="$2" remote="$3" ref="$4" note="${5:-}"
  local dest="${PREFIX}/${owner}/${repo}"
  local metadata="${dest}/.agent-source.json"
  local commit=""

  if [[ -d "${dest}/.git" ]]; then
    if [[ "$REFRESH" != true ]]; then
      echo "skip ${owner}/${repo} (exists; pass --refresh to replace)"
      return 0
    fi
    rm -rf "$dest"
  elif [[ -e "$dest" ]]; then
    rm -rf "$dest"
  fi

  mkdir -p "$(dirname "$dest")"
  echo "clone ${owner}/${repo} @ ${ref}"
  git clone --depth 1 --branch "$ref" "$remote" "$dest"
  commit="$(git -C "$dest" rev-parse HEAD)"

  cat >"$metadata" <<EOF
{
  "type": "github-repo-source",
  "owner": "${owner}",
  "repo": "${repo}",
  "remote": "${remote}",
  "ref": "${ref}",
  "commit": "${commit}",
  "addedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "note": "${note:-Project-local shallow git source mirror. Refresh: ./scripts/vendor-agent-sources.sh --refresh}"
}
EOF

  echo "  -> ${dest} (${commit})"
}

# Core fleet libs only. Product-specific mirrors (e.g. x-algorithm) belong in the consuming app.
# Match package.json pins. effect-smol is archived — V4 lives in Effect-TS/effect only.
clone_source Effect-TS effect https://github.com/Effect-TS/effect.git effect@4.0.0-rc.115 \
  "Effect v4 monorepo matching package.json effect@4.0.0-rc.115."
clone_source kitlangton effect-solutions https://github.com/kitlangton/effect-solutions.git main \
  "Idiomatic Effect patterns guide (Kit Langton)."
clone_source statelyai xstate https://github.com/statelyai/xstate.git xstate@6.0.0-alpha.58 \
  "Pinned to package.json xstate@6.0.0-alpha.58."
clone_source alchemy-run alchemy https://github.com/alchemy-run/alchemy.git v2.0.0-beta.78 \
  "Alchemy IaC pinned to v2.0.0-beta.78 (imp-proven). Read alchemy/src/cloudflare/."

echo "done — agent sources under ${PREFIX}"
