import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Comment = ESTree.Comment;

type Kind = "directive" | "safety" | "types" | "prose";

interface Entry {
  readonly comment: Comment;
  readonly kind: Kind;
  readonly text: string;
}

const directivePattern =
  /^(?:oxlint-(?:disable|enable)(?:-next-line|-line)?\b|@effect-diagnostics\b|\/ <reference )/u;

const safetyPattern = /^SAFETY:\s*\S/u;

const scriptFilePattern = /\.[cm]?js$/u;

const typeTagPattern =
  /^@(?:type|typedef|template|param|returns|satisfies)\s+\{.*\}(?:\s+[\w$.[\]]+)?$/u;

const isTypeAnnotation = (comment: Comment) =>
  comment.type === "Block" &&
  comment.value.startsWith("*") &&
  comment.value
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/u, "").trim())
    .filter((line) => line !== "")
    .every((line) => typeTagPattern.test(line));

const textOf = (comment: Comment): string =>
  comment.type === "Block"
    ? comment.value
        .split("\n")
        .map((line) => line.replace(/^\s*\*?\s?/u, ""))
        .join(" ")
        .replaceAll(/\s+/gu, " ")
        .trim()
    : comment.value.trim();

const kindOf = (comment: Comment, text: string, filename: string): Kind => {
  const raw = comment.type === "Line" ? comment.value : text;

  if (scriptFilePattern.test(filename) && isTypeAnnotation(comment)) {
    return "types";
  }

  if (directivePattern.test(raw.trimStart())) {
    return "directive";
  }

  return safetyPattern.test(text) ? "safety" : "prose";
};

const lineStartOf = (source: string, offset: number) =>
  source.lastIndexOf("\n", offset - 1) + 1;

const lineEndOf = (source: string, offset: number) => {
  const end = source.indexOf("\n", offset);

  return end === -1 ? source.length : end;
};

const standsAlone = (source: string, comment: Comment) =>
  source.slice(lineStartOf(source, comment.start), comment.start).trim() ===
    "" &&
  source.slice(comment.end, lineEndOf(source, comment.end)).trim() === "";

const lineOf = (source: string, offset: number) =>
  source.slice(0, offset).split("\n").length;

const runsOf = (source: string, entries: readonly Entry[]) => {
  const runs: Entry[][] = [];

  for (const entry of entries) {
    const previous = runs.at(-1)?.at(-1);

    if (
      previous !== undefined &&
      standsAlone(source, entry.comment) &&
      standsAlone(source, previous.comment) &&
      lineOf(source, entry.comment.start) ===
        lineOf(source, previous.comment.end) + 1
    ) {
      runs.at(-1)?.push(entry);
    } else {
      runs.push([entry]);
    }
  }

  return runs;
};

const tripleSlash = (text: string) => text.startsWith("/ ");

const withReason = (directive: string, reason: string) =>
  reason === "" || directive.includes(" -- ") || tripleSlash(directive)
    ? directive
    : `${directive} -- ${reason}`;

const lastParagraph = (lines: readonly string[]) => {
  const breakAt = lines.lastIndexOf("");

  return lines
    .slice(breakAt + 1)
    .join(" ")
    .trim();
};

const isSentenceEnd = (line: string) => line.endsWith(".") || line === "";

const firstSentence = (lines: readonly string[]) => {
  const end = lines.findIndex(isSentenceEnd);
  const taken = end === -1 ? lines : lines.slice(0, end + 1);

  return taken
    .filter((line) => line !== "")
    .join(" ")
    .trim();
};

const rebuild = (run: readonly Entry[]): readonly string[] => {
  const kept: string[] = [];
  let before: string[] = [];
  let after: string[] = [];
  let reasonless = -1;

  const settle = () => {
    const reason = firstSentence(after);
    const directive = kept[reasonless];

    if (reasonless !== -1 && directive !== undefined && reason !== "") {
      kept[reasonless] = withReason(directive, reason);
    }

    after = [];
    reasonless = -1;
  };

  for (const entry of run) {
    if (entry.kind === "prose") {
      const previous = kept.at(-1);

      if (
        previous !== undefined &&
        safetyPattern.test(previous) &&
        reasonless === -1 &&
        entry.text !== ""
      ) {
        kept[kept.length - 1] = `${previous} ${entry.text}`;
      } else if (reasonless === -1) {
        before.push(entry.text);
      } else {
        after.push(entry.text);
      }

      continue;
    }

    settle();

    if (entry.kind === "safety") {
      kept.push(entry.text);
      before = [];
      continue;
    }

    const own =
      entry.comment.type === "Line" ? entry.comment.value.trim() : entry.text;

    const directive = withReason(own, lastParagraph(before));
    kept.push(directive);
    before = [];

    if (!directive.includes(" -- ") && !tripleSlash(directive)) {
      reasonless = kept.length - 1;
    }
  }

  settle();

  return kept;
};

const render = (entry: Entry, text: string) => {
  if (entry.kind === "directive" && entry.comment.type === "Block") {
    return `/* ${text} */`;
  }

  return tripleSlash(text) ? `//${text}` : `// ${text}`;
};

const noComments = defineRule({
  create(context) {
    return {
      Program() {
        const source = context.sourceCode.text;

        const entries = context.sourceCode
          .getAllComments()
          .filter((comment) => comment.type !== "Shebang")
          .map((comment) => {
            const text = textOf(comment);

            return {
              comment,
              kind: kindOf(comment, text, context.filename),
              text,
            };
          })
          .filter((entry) => entry.kind !== "types");

        for (const run of runsOf(source, entries)) {
          const [first] = run;
          const last = run.at(-1);

          if (
            first === undefined ||
            last === undefined ||
            (run.every((entry) => entry.kind !== "prose") &&
              run.every(
                (entry) =>
                  entry.kind !== "safety" || entry.comment.type === "Line"
              ))
          ) {
            continue;
          }

          const alone = standsAlone(source, first.comment);

          const start = alone
            ? lineStartOf(source, first.comment.start)
            : source.slice(0, first.comment.start).trimEnd().length;

          const end = alone
            ? Math.min(lineEndOf(source, last.comment.end) + 1, source.length)
            : last.comment.end;

          const indent = source.slice(
            lineStartOf(source, first.comment.start),
            first.comment.start
          );

          const kept = rebuild(run);
          const survivors = run.filter((entry) => entry.kind !== "prose");

          const replacement = kept
            .map(
              (text, index) =>
                `${alone ? indent : " "}${render(survivors[index] ?? first, text)}${alone ? "\n" : ""}`
            )
            .join("");

          context.report({
            fix: (fixer) => fixer.replaceTextRange([start, end], replacement),
            loc: first.comment.loc,
            messageId: "comment",
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Ban comments. Tool directives (reason after --), one-line SAFETY invariants, and JSDoc type tags in plain JS remain.",
    },
    fixable: "code",
    messages: {
      comment:
        "Comments are banned. Say it in a name, a type, a test, or the commit. Tool directives carry their reason after --; a type assertion takes a one-line SAFETY: invariant.",
    },
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "no-comments" },
  rules: { "no-comments": noComments },
});
