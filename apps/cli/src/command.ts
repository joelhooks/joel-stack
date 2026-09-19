import { formatFileStats } from "@rat-stack/core";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { inspectFile } from "./inspect-machine.js";

export const VERSION = "0.1.0";

const statsCommand = Command.make(
  "stats",
  {
    file: Argument.Path("file", {
      mustExist: true,
      pathType: "file",
    }).pipe(Argument.withDescription("File to inspect")),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print machine-readable JSON")
    ),
  },
  ({ file, json }) =>
    inspectFile(file).pipe(
      Effect.flatMap((stats) =>
        Console.log(
          json ? JSON.stringify(stats, null, 2) : formatFileStats(stats)
        )
      )
    )
).pipe(Command.withDescription("Count bytes, characters, words, and lines"));

export const rootCommand = Command.make("rat-stack").pipe(
  Command.withDescription("A small Effect v4 file-inspection CLI"),
  Command.withSubcommands([statsCommand])
);

export const runCommand = Command.runWith(rootCommand, { version: VERSION });
