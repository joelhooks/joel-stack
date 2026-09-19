import { Runtime, Schema } from "effect";

// A Schema rather than an interface so the same shape serves as a Capability
// output: encoded for the CLI's --json, the REST body, and MCP structured
// content, and described in OpenAPI and MCP tool listings.
export const FileStatsSchema = Schema.Struct({
  bytes: Schema.Int,
  characters: Schema.Int,
  lines: Schema.Int,
  path: Schema.String,
  words: Schema.Int,
});
export type FileStats = typeof FileStatsSchema.Type;

export class FileStatsError extends Schema.TaggedError<FileStatsError>()(
  "FileStatsError",
  {
    path: Schema.String,
    reason: Schema.String,
  }
) {
  override readonly [Runtime.errorExitCode] = 1;
  override readonly [Runtime.errorReported] = false;

  override get message(): string {
    return `Could not read ${this.path}: ${this.reason}`;
  }
}

export const summarizeText = (path: string, text: string): FileStats => {
  const trailingLineBreak = /(?:\r\n|\r|\n)$/u.test(text);
  const lines =
    text.length === 0
      ? 0
      : text.split(/\r\n|\r|\n/u).length - (trailingLineBreak ? 1 : 0);

  return {
    bytes: new TextEncoder().encode(text).byteLength,
    characters: text.match(/./gsu)?.length ?? 0,
    lines,
    path,
    words: text.match(/\S+/gu)?.length ?? 0,
  };
};

export const summarizeBytes = (
  path: string,
  content: Uint8Array
): FileStats => ({
  ...summarizeText(path, new TextDecoder().decode(content)),
  bytes: content.byteLength,
});

export const formatFileStats = (stats: FileStats): string =>
  [
    stats.path,
    `  bytes:      ${stats.bytes}`,
    `  characters: ${stats.characters}`,
    `  words:      ${stats.words}`,
    `  lines:      ${stats.lines}`,
  ].join("\n");
