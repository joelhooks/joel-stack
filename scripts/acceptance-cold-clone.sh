#!/usr/bin/env bash
set -euo pipefail

step="starting"
tmp_parent="$(mktemp -d "${TMPDIR:-/tmp}/rat-stack-acceptance.XXXXXX")"
tmp="$tmp_parent/clone"
server_pid=""

cleanup() {
  local status=$?
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "${KEEP:-0}" == "1" ]]; then
    printf 'KEEP=1; preserved acceptance copy at %s\n' "$tmp_parent" >&2
  else
    rm -rf "$tmp_parent"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'acceptance failed [%s]: %s\n' "$step" "$*" >&2
  exit 1
}

printf '== cold-clone acceptance ==\n'
if [[ $# -gt 0 ]]; then
  source_url="$1"
else
  repo_root="$(git rev-parse --show-toplevel)" || fail "could not find the repository root"
  source_url="file://${repo_root}"
fi
printf 'source: %s\n' "$source_url"

step="clone"
if ! git clone --depth 1 "$source_url" "$tmp"; then
  fail "git clone failed"
fi
cd "$tmp"
printf 'clone: %s\n' "$tmp"

step="cold install"
if ! pnpm install --frozen-lockfile; then
  fail "pnpm install --frozen-lockfile failed"
fi

step="rename workspace"
acceptance_scope="@acceptance-$((RANDOM * 32768 + RANDOM))"
replace_refs() {
  local file="$1"
  if sed --version >/dev/null 2>&1; then
    sed -i "s|@rat-stack/|${acceptance_scope}/|g" "$file"
  else
    sed -i '' "s|@rat-stack/|${acceptance_scope}/|g" "$file"
  fi
}
while IFS= read -r -d '' file; do
  replace_refs "$file"
done < <(
  rg --hidden --files-with-matches --null -F '@rat-stack/' \
    -g '!.git/**' -g '!node_modules/**' -g '!.agent_sources/**' . || true
)
remaining="$(rg --hidden --files-with-matches -F '@rat-stack/' \
  -g '!.git/**' -g '!node_modules/**' -g '!.agent_sources/**' . || true)"
if [[ -n "$remaining" ]]; then
  printf 'remaining @rat-stack/ references:\n%s\n' "$remaining" >&2
  fail "workspace rename left old package references"
fi
printf 'renamed workspace scope to %s\n' "$acceptance_scope"

step="post-rename install"
if ! pnpm install --frozen-lockfile; then
  fail "pnpm install --frozen-lockfile failed after the workspace rename"
fi

# A longer or shorter scope changes line lengths, so the formatter rewraps.
# README's Make it yours path tells a clone to run the same command.
step="generate worker content"
if ! pnpm --filter "${acceptance_scope}/mischief" generate; then
  fail "mischief content generation failed after the workspace rename"
fi

step="post-rename format"
if ! pnpm fix; then
  fail "pnpm fix failed after the workspace rename"
fi

step="add throwaway capability"
cat > packages/core/src/acceptance-probe.ts <<EOF
import { defineContract, implement } from "${acceptance_scope}/capability";
import { Effect, Schema } from "effect";

const acceptanceProbeContract = defineContract("acceptanceProbe", {
  annotations: { idempotent: true, readOnly: true },
  description: "Return a deterministic value for template acceptance tests",
  failure: Schema.Never,
  input: Schema.Struct({}),
  output: Schema.Struct({ value: Schema.String }),
});

export const acceptanceProbe = implement(acceptanceProbeContract, () =>
  Effect.succeed({ value: "acceptance-ok" })
);
EOF
if ! node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const inspectPath = "packages/core/src/inspect-file.ts";
const inspect = await readFile(inspectPath, "utf8");
const imported = inspect.replace(
  'import { runInspectMachine } from "./inspect-machine.js";',
  'import { acceptanceProbe } from "./acceptance-probe.js";\nimport { runInspectMachine } from "./inspect-machine.js";'
);
const registered = imported.replace(
  "export const capabilities = [inspectFile] as const;",
  "export const capabilities = [inspectFile, acceptanceProbe] as const;"
);
if (registered === inspect) {
  throw new Error("add-a-capability registration text did not match inspect-file.ts");
}
await writeFile(inspectPath, registered);

const indexPath = "packages/core/src/index.ts";
const index = await readFile(indexPath, "utf8");
const exported = index.replace(
  'export { capabilities, inspectFile } from "./inspect-file.js";',
  'export { acceptanceProbe } from "./acceptance-probe.js";\nexport { capabilities, inspectFile } from "./inspect-file.js";'
);
if (exported === index) {
  throw new Error("add-a-capability export text did not match core/index.ts");
}
await writeFile(indexPath, exported);
NODE
then
  fail "add-a-capability instructions did not match the scaffold"
fi
printf 'registered acceptanceProbe in packages/core/src/inspect-file.ts\n'

step="full gate"
if ! pnpm turbo run check test build; then
  fail "pnpm turbo run check test build failed"
fi

step="CLI capability help"
help_output="$tmp/cli-help.txt"
if ! node apps/cli/dist/cli.js --help >"$help_output" 2>&1; then
  cat "$help_output" >&2
  fail "CLI --help failed"
fi
cat "$help_output"
if ! grep -Fq "acceptanceProbe" "$help_output"; then
  fail "CLI --help did not register acceptanceProbe"
fi
printf 'CLI: acceptanceProbe appears in --help\n'

step="HTTP capability route"
port="$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')"
http_log="$tmp/http.log"
node apps/cli/dist/cli.js serve --port "$port" >"$http_log" 2>&1 &
server_pid=$!
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:${port}/openapi.json" >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$http_log" >&2
    fail "serve exited before becoming ready"
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  cat "$http_log" >&2
  fail "serve did not become ready on port ${port}"
fi
http_body="$tmp/http.json"
if ! curl --silent --show-error --fail --request POST "http://127.0.0.1:${port}/acceptanceProbe" \
  --header 'content-type: application/json' --data '{}' >"$http_body"; then
  cat "$http_body" >&2 || true
  fail "POST /acceptanceProbe failed"
fi
cat "$http_body"
if ! grep -Fq 'acceptance-ok' "$http_body"; then
  fail "HTTP response did not contain acceptance-ok"
fi
openapi_body="$tmp/openapi.json"
if ! curl --silent --show-error --fail "http://127.0.0.1:${port}/openapi.json" >"$openapi_body"; then
  fail "GET /openapi.json failed"
fi
if ! grep -Fq '"/acceptanceProbe"' "$openapi_body"; then
  fail "OpenAPI did not document /acceptanceProbe"
fi
printf 'HTTP: /acceptanceProbe and /openapi.json passed\n'
kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=""

step="MCP capability tool"
mcp_output="$tmp/mcp.jsonl"
mcp_error="$tmp/mcp.stderr"
if ! printf '%s\n' \
  '{"id":1,"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{},"clientInfo":{"name":"acceptance","version":"0.0.0"},"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"id":2,"jsonrpc":"2.0","method":"tools/list","params":{}}' \
  | node apps/cli/dist/cli.js mcp >"$mcp_output" 2>"$mcp_error"; then
  cat "$mcp_error" >&2 || true
  fail "MCP stdio conversation failed"
fi
cat "$mcp_output"
if ! grep -Fq 'acceptanceProbe' "$mcp_output"; then
  fail "MCP tools/list did not include acceptanceProbe"
fi
printf 'MCP: acceptanceProbe appears in tools/list\n'

step="code-mode declaration"
types_output="$tmp/types.txt"
if ! node apps/cli/dist/cli.js catalog --types >"$types_output" 2>&1; then
  cat "$types_output" >&2
  fail "catalog --types failed"
fi
if ! grep -Fq 'readonly acceptanceProbe' "$types_output"; then
  cat "$types_output" >&2
  fail "catalog --types did not include acceptanceProbe"
fi
printf 'code mode: acceptanceProbe appears in catalog --types\n'
printf 'cold-clone acceptance passed\n'
