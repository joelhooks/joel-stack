import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Repo-local Pi extension, auto-discovered from .pi/extensions/*.ts.
// Quiet by default: it registers one command and adds nothing at startup,
// so it can never collide with global extensions. Grow project behavior here.
export default function projectExtension(pi: ExtensionAPI) {
  pi.registerCommand("project-status", {
    description: "Show this project's task commands and law files.",
    handler: (_args, ctx) => {
      const lines = [
        "law: AGENTS.md (via CLAUDE.md @AGENTS.md) · intent: VISION.md",
        "check: pnpm check && pnpm test · fix: pnpm fix",
        "fence: no git --no-verify (lefthook + agent hooks)",
        "sources: .agent_sources/ via pnpm vendor:agent-sources",
      ];
      if (ctx.hasUI) {
        ctx.ui.notify(lines.join("\n"), "info");
      } else {
        console.log(lines.join("\n"));
      }
    },
  });
}
