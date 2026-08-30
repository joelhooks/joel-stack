#!/usr/bin/env node
/**
 * Multiplexed shell gate for Cursor (`beforeShellExecution`) and Claude Code (`PreToolUse` Bash).
 * Reads JSON on stdin. Never prints secrets. Fail-open only on unreadable input.
 */
import { applyCommandPolicy } from "../vcs-command-policy.js";

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const extractCommand = (payload) => {
  if (typeof payload?.command === "string") {
    return payload.command;
  }
  if (typeof payload?.tool_input?.command === "string") {
    return payload.tool_input.command;
  }
  if (typeof payload?.input?.command === "string") {
    return payload.input.command;
  }
  return "";
};

const isClaudePreToolUse = (payload) =>
  typeof payload?.tool_name === "string" ||
  payload?.hook_event_name === "PreToolUse" ||
  typeof payload?.tool_input === "object";

let payload = {};
try {
  const raw = await readStdin();
  if (raw.trim() !== "") {
    payload = JSON.parse(raw);
  }
} catch {
  process.exit(0);
}

const command = extractCommand(payload);
const result = applyCommandPolicy(command);

if (result.action === "block") {
  if (isClaudePreToolUse(payload)) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
      })}\n`
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({
        permission: "deny",
        user_message: result.reason,
        agent_message: result.reason,
      })}\n`
    );
  }
  process.exit(0);
}

if (!isClaudePreToolUse(payload)) {
  process.stdout.write(`${JSON.stringify({ permission: "allow" })}\n`);
}

process.exit(0);
