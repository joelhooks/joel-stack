import { Context, Effect, FileSystem, Layer } from "effect";

import { FileStatsError, summarizeBytes } from "./stats.js";
import type { FileStats } from "./stats.js";

export class FileInspector extends Context.Service<
  FileInspector,
  {
    readonly inspect: (
      path: string
    ) => Effect.Effect<FileStats, FileStatsError>;
  }
>()("@rat-stack/core/FileInspector", {
  make: Effect.gen(function* makeFileInspector() {
    const fileSystem = yield* FileSystem.FileSystem;

    const inspect = Effect.fn("FileInspector.inspect")(function* inspect(
      path: string
    ) {
      const content = yield* fileSystem
        .readFile(path)
        .pipe(
          Effect.mapError(
            (error) => new FileStatsError({ path, reason: error.message })
          )
        );

      return summarizeBytes(path, content);
    });

    return { inspect } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
