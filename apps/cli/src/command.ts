import { formatFileStats, readFileStats } from "@ts-cli-template/core";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

export const VERSION = "0.1.0";

const statsCommand = Command.make(
  "stats",
  {
    file: Argument.path("file", {
      mustExist: true,
      pathType: "file",
    }).pipe(Argument.withDescription("File to inspect")),
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON")
    ),
  },
  ({ file, json }) =>
    readFileStats(file).pipe(
      Effect.flatMap((stats) =>
        Console.log(
          json ? JSON.stringify(stats, null, 2) : formatFileStats(stats)
        )
      )
    )
).pipe(Command.withDescription("Count bytes, characters, words, and lines"));

export const rootCommand = Command.make("ts-cli-template").pipe(
  Command.withDescription("A small Effect v4 file-inspection CLI"),
  Command.withSubcommands([statsCommand])
);

export const runCommand = Command.runWith(rootCommand, { version: VERSION });
