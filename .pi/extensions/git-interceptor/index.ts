import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { applyCommandPolicy } from "./policy";

/**
 * Blocks `git … --no-verify` and forces non-interactive git/jj editors.
 */
export default function gitInterceptor(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const result = applyCommandPolicy(event.input.command);
    if (result.action === "block") {
      return { block: true, reason: result.reason };
    }

    event.input.command = result.command;
  });
}
