import { definePlugin, defineRule } from "@oxlint/plugins";

type DebtKind = "oxlint" | "effect-diagnostics" | "typescript";

const debtPatterns = [
  { kind: "oxlint", pattern: /\boxlint-disable(?:-[a-z-]+)?\b/gu },
  {
    kind: "effect-diagnostics",
    pattern: /@effect-diagnostics(?:-next-line)?\b/gu,
  },
  {
    kind: "typescript",
    pattern: /@ts-(?:expect-error|ignore|nocheck)\b/gu,
  },
] as const satisfies readonly {
  readonly kind: DebtKind;
  readonly pattern: RegExp;
}[];

const debtLedger = defineRule({
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") {
            continue;
          }

          for (const { kind, pattern } of debtPatterns) {
            for (const match of comment.value.matchAll(pattern)) {
              const index = match.index ?? 0;

              const line = comment.value
                .slice(index)
                .split(/\r?\n/u, 1)[0]
                ?.replace(/^\*+\s*/u, "")
                .trim();

              if (line === undefined) {
                continue;
              }

              const reason = /\s--\s*(?<reason>.*)$/u
                .exec(line)
                ?.groups?.reason?.trim();

              const directive = line.split(" -- ", 1)[0]?.trim() ?? line;

              context.report({
                loc: context.sourceCode.getLocFromIndex(
                  comment.start + 2 + index
                ),
                message: JSON.stringify({
                  directive,
                  kind,
                  reason: reason === "" ? undefined : reason,
                }),
              });
            }
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Report source-comment directives for the debt ledger.",
    },
    messages: {},
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "rat-stack-debt" },
  rules: { "debt-ledger": debtLedger },
});
