import { defineContract } from "@rat-stack/capability/contract";
import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { Schema } from "effect";
import { expect, it } from "vitest";

const input = Schema.Struct({ query: Schema.String });

const output = Schema.Struct({ matches: Schema.Array(Schema.String) });

const failure = Schema.Never;

const searchContract = defineContract("search", {
  description: "Search resources",
  failure,
  input,
  output,
});

const group = toRpcGroup([searchContract]);

it("builds the client RPC group from contracts alone", () => {
  expect([...group.group.requests.keys()]).toEqual(["search"]);
  expect(group.group.requests.get("search")?.payloadSchema).toBe(input);
  expect(group.group.requests.get("search")?.successSchema).toBe(output);
  expect(group.group.requests.get("search")?.errorSchema).toBe(failure);
});
