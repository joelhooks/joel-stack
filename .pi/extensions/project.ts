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
        "check: npx turbo run check test · fix: npm run fix",
        "sources: .agent-sources/ (committed shallow subtrees)",
      ];
      if (ctx.hasUI) {
        ctx.ui.notify(lines.join("\n"), "info");
      } else {
        console.log(lines.join("\n"));
      }
    },
  });
}
