#!/usr/bin/env bash
set -euo pipefail

base_url="${MISCHIEF_URL:-https://ratstack.sh}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

routes=(
  "/"
  "/llms.txt"
  "/openapi.json"
  "/.well-known/mcp.json"
  "/.well-known/agent-skills/index.json"
)

for route in "${routes[@]}"; do
  status="$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "${base_url}${route}")"
  printf '%s %s\n' "$status" "$route"
done

curl --fail --silent --show-error \
  --request POST "${base_url}/mcp" \
  --header 'accept: application/json, text/event-stream' \
  --header 'content-type: application/json' \
  --header 'MCP-Protocol-Version: 2026-07-28' \
  --header 'Mcp-Method: tools/list' \
  --data '{"jsonrpc":"2.0","id":"smoke-tools","method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"rat-stack-smoke","version":"0.1.0"},"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' \
  >"$tmp_dir/tools.json"

node --input-type=module - "$tmp_dir/tools.json" <<'NODE'
import { readFile } from "node:fs/promises";

const response = JSON.parse(await readFile(process.argv[2], "utf8"));
const names = response?.result?.tools?.map((tool) => tool.name);
if (!Array.isArray(names) || !["search", "read", "execute"].every((name) => names.includes(name))) {
  throw new Error("MCP tools/list did not return search, read, and execute");
}
console.log(`MCP tools: ${names.join(", ")}`);
NODE

curl --fail --silent --show-error \
  --request POST 'https://isitagentready.com/api/scan' \
  --header 'content-type: application/json' \
  --data "{\"url\":\"${base_url}\"}" \
  >"$tmp_dir/scan.json"

node --input-type=module - "$tmp_dir/scan.json" <<'NODE'
import { readFile } from "node:fs/promises";

const scan = JSON.parse(await readFile(process.argv[2], "utf8"));
if (typeof scan.level !== "number" || typeof scan.levelName !== "string") {
  throw new Error("isitagentready response did not contain a level");
}
console.log(`isitagentready: ${scan.level}/5 (${scan.levelName})`);
NODE
