import { Effect, FileSystem, Runtime, Schema } from "effect";

export interface FileStats {
  readonly path: string;
  readonly bytes: number;
  readonly characters: number;
  readonly lines: number;
  readonly words: number;
}

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

export const readFileStats = Effect.fn("FileStats.read")(
  function* readFileStats(path: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const content = yield* fileSystem.readFile(path).pipe(
      Effect.mapError(
        (error) =>
          new FileStatsError({
            path,
            reason: error.message,
          })
      )
    );

    return summarizeBytes(path, content);
  }
);

export const formatFileStats = (stats: FileStats): string =>
  [
    stats.path,
    `  bytes:      ${stats.bytes}`,
    `  characters: ${stats.characters}`,
    `  words:      ${stats.words}`,
    `  lines:      ${stats.lines}`,
  ].join("\n");
