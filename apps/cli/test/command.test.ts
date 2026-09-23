import { describe, expect, it } from "@effect/vitest";
import { capabilities } from "@rat-stack/core";

import { rootCommand } from "../src/command.js";

describe("command registration", () => {
  it("registers every capability by its name", () => {
    const names = rootCommand.subcommands.flatMap((group) =>
      group.commands.map((command) => command.name)
    );

    for (const capability of capabilities) {
      expect(names).toContain(capability.name);
    }

    expect(
      rootCommand.subcommands.flatMap((group) => group.commands)
    ).toHaveLength(capabilities.length + 4);
  });
});
