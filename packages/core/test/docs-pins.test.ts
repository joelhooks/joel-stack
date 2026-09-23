// @effect-diagnostics nodeBuiltinImport:off -- This test reads the repository's manifests and docs from disk.
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const docs = ["AGENTS.md", "README.md"];

const Dependencies = Schema.optional(
  Schema.Record(Schema.String, Schema.String)
);

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Dependencies,
      devDependencies: Dependencies,
    })
  )
);

const prereleasePins = () => {
  const manifests = globSync(
    ["package.json", "apps/*/package.json", "packages/*/package.json"],
    { cwd: repoRoot }
  );

  const pins = manifests.flatMap((manifest) => {
    const { dependencies, devDependencies } = decodeManifest(
      readFileSync(path.join(repoRoot, manifest), "utf-8")
    );

    return Object.values({ ...devDependencies, ...dependencies });
  });

  return [
    ...new Set(pins.filter((version) => /^\d+\.\d+\.\d+-/u.test(version))),
  ];
};

const releaseLineOf = (version: string) => version.replace(/\d+$/u, "");

const escapeRegex = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const mentionsOf = (line: string) =>
  docs.flatMap((doc) => {
    const text = readFileSync(path.join(repoRoot, doc), "utf-8");
    const pattern = new RegExp(`\`(${escapeRegex(line)}\\d+)\``, "gu");

    return [...text.matchAll(pattern)].map((match) => ({
      doc,
      version: match[1],
    }));
  });

describe("documented versions", () => {
  it("match the pinned prerelease versions in the workspace manifests", () => {
    const checks = prereleasePins().map((pinned) => ({
      mentions: mentionsOf(releaseLineOf(pinned)),
      pinned,
    }));

    const stale = checks.flatMap(({ mentions, pinned }) =>
      mentions
        .filter((mention) => mention.version !== pinned)
        .map(
          (mention) => `${mention.doc}: ${mention.version}, pinned ${pinned}`
        )
    );

    expect(checks.flatMap(({ mentions }) => mentions).length).toBeGreaterThan(
      0
    );
    expect(stale).toEqual([]);
  });
});
