import { describe, expect, it } from "@effect/vitest";

import {
  searchCatalog,
  toCatalog,
  toTypeScript,
  typeOf,
} from "../src/catalog.js";
import { echo, greet, mixed } from "./fixtures.js";

const catalog = toCatalog([echo, greet, mixed]);

describe("toCatalog", () => {
  it("records every capability with JSON Schema for each channel", () => {
    expect(catalog.version).toBe("1");
    expect(catalog.capabilities.map((entry) => entry.name)).toEqual([
      "echo",
      "greet",
      "mixed",
    ]);
    const [, greetEntry] = catalog.capabilities;
    expect(greetEntry?.input).toMatchObject({
      properties: { name: { type: "string" } },
      required: ["name"],
      type: "object",
    });
    expect(greetEntry?.failure).toMatchObject({
      $ref: "#/$defs/NotFoundEncoded",
    });
  });
});

describe("typeOf", () => {
  it("prints the JSON Schema shapes Effect emits", () => {
    expect(typeOf({ enum: ["fast", "slow"], type: "string" })).toBe(
      '"fast" | "slow"'
    );
    expect(typeOf({ anyOf: [{ type: "number" }, { type: "null" }] })).toBe(
      "number | null"
    );
    expect(typeOf({ items: { type: "string" }, type: "array" })).toBe(
      "ReadonlyArray<string>"
    );
    expect(typeOf({ not: {} })).toBe("never");
    expect(typeOf({ $ref: "#/$defs/NotFoundEncoded" })).toBe("NotFoundEncoded");
    expect(typeOf({ type: 7 })).toBe("unknown");
  });
});

describe("toTypeScript", () => {
  it("declares named failures and a tools object with doc comments", () => {
    const declarations = toTypeScript(catalog);

    expect(declarations).toContain(
      'type NotFoundEncoded = { readonly _tag: "NotFound"; readonly name: string };'
    );
    expect(declarations).toContain("declare const tools: {");
    expect(declarations).toContain(
      "readonly greet: (input: { readonly name: string }) => Promise<{ readonly greeting: string }>;"
    );
    expect(declarations).toContain("@throws NotFoundEncoded");
    expect(declarations).toContain("Read-only.");
    expect(declarations).toContain(
      "readonly text: string; readonly times?: number | null"
    );
  });
});

describe("searchCatalog", () => {
  it("ranks by name, field, then description overlap", () => {
    const matches = searchCatalog(catalog, "greet someone by name");

    expect(matches[0]?.name).toBe("greet");
    expect(matches[0]?.signature).toContain("readonly greet:");
    expect(matches.every((match) => match.score > 0)).toBe(true);
  });

  it("returns everything for an empty query, within the limit", () => {
    expect(searchCatalog(catalog, "", 2)).toHaveLength(2);
    expect(searchCatalog(catalog, "")).toHaveLength(3);
  });

  it("returns nothing when no token matches", () => {
    expect(searchCatalog(catalog, "zebra")).toHaveLength(0);
  });
});
