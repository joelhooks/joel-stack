#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Approval } from "@rat-stack/capability";
import { FileInspector } from "@rat-stack/core";
import { Console, Effect, Layer } from "effect";

import { runCommand } from "./command.js";

const program = runCommand(process.argv.slice(2)).pipe(
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Oxlint mistakes this Effect handler for an async Promise callback.
  Effect.catchTag("FileStatsError", (error) =>
    Console.error(error.message).pipe(Effect.andThen(Effect.fail(error)))
  ),
  Effect.provide(
    Layer.mergeAll(
      Layer.provideMerge(FileInspector.layer, NodeServices.layer),
      Approval.denyAll
    )
  )
);

NodeRuntime.runMain(program);
