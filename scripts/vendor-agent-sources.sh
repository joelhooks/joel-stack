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
# Refs are derived from the workspace pins so a bump in package.json is a bump here.
# effect-smol is archived: V4 lives in Effect-TS/effect only.
pin() {
  node -p "require('${ROOT}/$1').dependencies['$2']"
}
EFFECT_VERSION="$(pin packages/core/package.json effect)"
XSTATE_VERSION="$(pin packages/core/package.json xstate)"
ALCHEMY_VERSION="$(pin apps/infra/package.json alchemy)"
BETTER_AUTH_VERSION="$(pin packages/auth/package.json better-auth)"
TANSTACK_START_VERSION="$(pin apps/web/package.json @tanstack/react-start)"

clone_source Effect-TS effect https://github.com/Effect-TS/effect.git "effect@${EFFECT_VERSION}" \
  "Effect v4 monorepo matching packages/core effect@${EFFECT_VERSION}."
clone_source kitlangton effect-solutions https://github.com/kitlangton/effect-solutions.git main \
  "Idiomatic Effect patterns guide (Kit Langton)."
clone_source statelyai xstate https://github.com/statelyai/xstate.git "xstate@${XSTATE_VERSION}" \
  "XState v6 matching packages/core xstate@${XSTATE_VERSION}; packages/xstate-effect is the Effect bridge."
clone_source alchemy-run alchemy https://github.com/alchemy-run/alchemy.git "v${ALCHEMY_VERSION}" \
  "Alchemy IaC matching apps/infra alchemy@${ALCHEMY_VERSION}. Read alchemy/src/cloudflare/."
clone_source better-auth better-auth https://github.com/better-auth/better-auth.git "better-auth@${BETTER_AUTH_VERSION}" \
  "Better Auth matching packages/auth better-auth@${BETTER_AUTH_VERSION}; Alchemy's wrapper lives in alchemy-run/alchemy packages/better-auth."
clone_source TanStack router https://github.com/TanStack/router.git "@tanstack/react-start@${TANSTACK_START_VERSION}" \
  "TanStack Start and Router matching apps/web @tanstack/react-start@${TANSTACK_START_VERSION}; the router packages sit at that commit, not at the react-router pin."

echo "done — agent sources under ${PREFIX}"
