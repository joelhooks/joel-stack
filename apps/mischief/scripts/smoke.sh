#!/usr/bin/env bash
set -euo pipefail

base_url="${RATSTACK_BASE_URL:-https://ratstack.sh}"
base_url="${base_url%/}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
fail() { printf 'smoke failed: %s\n' "$*" >&2; exit 1; }

post_json() {
  local path="$1" body="$2" output="$3" max_time="$4" status
  if ! status="$(curl --silent --show-error --max-time "$max_time" --output "$output" --write-out '%{http_code}' --request POST "${base_url}${path}" --header 'content-type: application/json' --data "$body")"; then
    fail "POST ${path} did not complete within ${max_time}s; response: $(cat "$output" 2>/dev/null || true)"
  fi
  printf '%s' "$status"
}

assert_json() {
  node --input-type=module - "$1" "$2" "${3:-}" <<'NODE'
import { readFile } from "node:fs/promises";
const [file, kind, status] = process.argv.slice(2);
const response = JSON.parse(await readFile(file, "utf8"));
const raw = JSON.stringify(response);
const fail = (message) => { throw new Error(message); };
switch (kind) {
  case "tools": {
    const names = response?.result?.tools?.map((tool) => tool.name);
    if (!Array.isArray(names) || !["search", "read", "execute"].every((name) => names.includes(name))) fail("MCP tools/list did not return search, read, and execute");
    console.log(`MCP tools: ${names.join(", ")}`); break;
  }
  case "execute": {
    const result = response?.result;
    if (result?.id !== "ratstack://skills/learn-rat-stack" || typeof result?.text !== "string" || result.text.trim() === "") fail("search -> read did not return learn-rat-stack with non-empty text");
    console.log(`execute search -> read: ${result.id} (${result.text.length} chars)`); break;
  }
  case "network": {
    const message = [response?.message, response?.result?.message, response?.error?.message, raw].filter((value) => typeof value === "string").join(" ").toLowerCase();
    if (/<html/iu.test(raw) || !message.includes("not permitted to access the internet")) fail("network access was not rejected as a SandboxError");
    console.log(`execute network blocked: HTTP ${status}`); break;
  }
  case "timeout":
    if (response?._tag !== "SandboxError" || response?.reason !== "timeout" || !/CPU time limit|did not finish within|timeout/iu.test(raw)) fail("infinite program did not return a typed timeout SandboxError");
    console.log("execute timeout: typed SandboxError (timeout)"); break;
  case "mcp": {
    const matches = response?.result?.structuredContent?.matches;
    if (!Array.isArray(matches) || matches.length === 0 || typeof matches[0]?.id !== "string") fail("MCP search did not return a hit");
    console.log(`MCP tools/call search: ${matches[0].id}`); break;
  }
  case "rate": {
    const responses = response?.paths?.["/api/execute"]?.post?.responses;
    if (responses?.["429"] === undefined) { console.error(`documented /api/execute responses: ${JSON.stringify(responses)}`); fail("OpenAPI does not document the fail-closed 429 rate-limit response"); }
    console.log("rate limit: /api/execute documents HTTP 429"); break;
  }
  case "ready":
    if (typeof response.level !== "number" || typeof response.levelName !== "string") fail("isitagentready response did not contain a level");
    if (response.level !== 5) fail(`isitagentready level was ${response.level}/5, not 5/5`);
    console.log(`isitagentready: ${response.level}/5 (${response.levelName})`); break;
  default: fail(`unknown JSON assertion: ${kind}`);
}
NODE
}

routes=( "/" "/llms.txt" "/openapi.json" "/.well-known/mcp.json" "/.well-known/agent-skills/index.json" )
for route in "${routes[@]}"; do
  status="$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "${base_url}${route}")"
  printf '%s %s\n' "$status" "$route"
done

curl --fail --silent --show-error --request POST "${base_url}/mcp" \
  --header 'accept: application/json, text/event-stream' --header 'content-type: application/json' \
  --header 'MCP-Protocol-Version: 2026-07-28' --header 'Mcp-Method: tools/list' \
  --data '{"jsonrpc":"2.0","id":"smoke-tools","method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"rat-stack-smoke","version":"0.1.0"},"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' >"$tmp_dir/tools.json"
if ! tools_summary="$(assert_json "$tmp_dir/tools.json" tools)"; then printf 'MCP tools/list response: '; cat "$tmp_dir/tools.json"; printf '\n'; fail "MCP tools/list assertion failed"; fi
printf '%s\n' "$tools_summary"

execute_body='{"code":"const found = await tools.search({ query: \"learn-rat-stack\", limit: 1 });\nreturn await tools.read({ id: found.matches[0].id });"}'
execute_status="$(post_json /api/execute "$execute_body" "$tmp_dir/execute.json" 20)"
[[ "$execute_status" == "200" ]] || { printf 'execute search/read response: '; cat "$tmp_dir/execute.json"; printf '\n'; fail "search -> read execute returned HTTP ${execute_status}, expected 200"; }
if ! execute_summary="$(assert_json "$tmp_dir/execute.json" execute)"; then printf 'execute search/read response: '; cat "$tmp_dir/execute.json"; printf '\n'; fail "search -> read execute assertion failed"; fi
printf '%s\n' "$execute_summary"

network_status="$(post_json /api/execute '{"code":"return await fetch(\"https://example.com\");"}' "$tmp_dir/network.json" 20)"
if ! network_summary="$(assert_json "$tmp_dir/network.json" network "$network_status")"; then printf 'network response (HTTP %s): ' "$network_status"; cat "$tmp_dir/network.json"; printf '\n'; fail "sandbox network check failed"; fi
printf '%s\n' "$network_summary"

timeout_status="$(post_json /api/execute '{"code":"while(true){}"}' "$tmp_dir/timeout.json" 15)"
if ! timeout_summary="$(assert_json "$tmp_dir/timeout.json" timeout)"; then printf 'timeout response (HTTP %s): ' "$timeout_status"; cat "$tmp_dir/timeout.json"; printf '\n'; fail "sandbox timeout check failed"; fi
printf '%s\n' "$timeout_summary"

mcp_status="$(curl --silent --show-error --max-time 20 --output "$tmp_dir/mcp-call.json" --write-out '%{http_code}' --request POST "${base_url}/mcp" --header 'accept: application/json, text/event-stream' --header 'content-type: application/json' --header 'MCP-Protocol-Version: 2026-07-28' --header 'Mcp-Method: tools/call' --header 'Mcp-Name: search' --data '{"jsonrpc":"2.0","id":"smoke-search","method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"rat-stack-smoke","version":"0.1.0"},"io.modelcontextprotocol/protocolVersion":"2026-07-28"},"name":"search","arguments":{"query":"learn-rat-stack","limit":1}}}')" || fail "MCP tools/call did not complete"
[[ "$mcp_status" == "200" ]] || { printf 'MCP tools/call response: '; cat "$tmp_dir/mcp-call.json"; printf '\n'; fail "MCP search returned HTTP ${mcp_status}, expected 200"; }
if ! mcp_summary="$(assert_json "$tmp_dir/mcp-call.json" mcp)"; then printf 'MCP tools/call response: '; cat "$tmp_dir/mcp-call.json"; printf '\n'; fail "MCP tools/call search assertion failed"; fi
printf '%s\n' "$mcp_summary"

curl --fail --silent --show-error --max-time 20 "${base_url}/openapi.json" >"$tmp_dir/openapi.json" || fail "GET /openapi.json did not complete"
if ! rate_summary="$(assert_json "$tmp_dir/openapi.json" rate)"; then fail "rate-limit check failed; see documented responses above"; fi
printf '%s\n' "$rate_summary"
if [[ "${RATSTACK_SMOKE_BURST:-0}" == "1" ]]; then
  burst_429=0
  for _ in 1 2 3 4 5 6 7; do
    burst_status="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' --request POST "${base_url}/api/execute" --header 'content-type: application/json' --data '{"code":"return 1"}')"
    printf 'execute burst: %s\n' "$burst_status"
    [[ "$burst_status" == "429" ]] && burst_429=$((burst_429 + 1))
  done
  (( burst_429 > 0 )) || fail "RATSTACK_SMOKE_BURST=1 sent 7 calls without a 429"
fi

curl --fail --silent --show-error --request POST 'https://isitagentready.com/api/scan' --header 'content-type: application/json' --data "{\"url\":\"${base_url}\"}" >"$tmp_dir/scan.json"
if ! readiness_summary="$(assert_json "$tmp_dir/scan.json" ready)"; then printf 'isitagentready response: '; cat "$tmp_dir/scan.json"; printf '\n'; fail "isitagentready is below the required 5/5"; fi
printf '%s\n' "$readiness_summary"
