// @effect-diagnostics nodeBuiltinImport:off -- This Node CLI reads manifests and a local roster directly from disk.
import { existsSync, globSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Schema } from "effect";

interface Line {
  readonly name: string;
  readonly prefix: string;
}

interface Peer {
  readonly repo: string;
  readonly stars: number;
  readonly lines: Set<string>;
}

const SOURCEGRAPH = "https://sourcegraph.com/.api/search/stream";

const Dependencies = Schema.optional(
  Schema.Record(Schema.String, Schema.String)
);

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Dependencies,
      devDependencies: Dependencies,
      peerDependencies: Dependencies,
    })
  )
);

const decodeMatches = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        repoStars: Schema.optional(Schema.Finite),
        repository: Schema.String,
      })
    )
  )
);

const { values } = parseArgs({
  options: {
    min: { default: "2", type: "string" },
    roster: { default: ".brain/resources/peers.svx", type: "string" },
  },
});

const minShared = Math.trunc(
  Schema.decodeSync(Schema.Finite)(Number(values.min))
);

const keyOf = (line: Line): string => `${line.name}@${line.prefix}`;

const familyKeyOf = (line: Line): string => {
  const scope = /^@(?<scope>[^/]+)\//u.exec(line.name)?.groups?.scope;

  return scope === undefined ? keyOf(line) : `${scope}@${line.prefix}`;
};

const prereleaseLine = (name: string, version: string): Line | undefined => {
  const prefix = /^[\^~]?(?<prefix>\d+\.\d+\.\d+-[a-z]+)[.\d]*/u.exec(version)
    ?.groups?.prefix;

  return prefix === undefined ? undefined : { name, prefix };
};

const linesIn = (path: string): readonly Line[] => {
  const manifest = decodeManifest(readFileSync(path, "utf-8"));

  const pins = {
    ...manifest.peerDependencies,
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };

  return Object.entries(pins).flatMap(
    ([name, version]) => prereleaseLine(name, version) ?? []
  );
};

const ourLines = (): readonly Line[] => {
  const manifests = globSync([
    "package.json",
    "apps/*/package.json",
    "packages/*/package.json",
  ]);

  const byKey = new Map(
    manifests.flatMap(linesIn).map((line) => [keyOf(line), line] as const)
  );

  return [...byKey.values()].filter(
    (line) => familyKeyOf(line) === keyOf(line) || !byKey.has(familyKeyOf(line))
  );
};

const escapeRegex = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

const queryFor = (line: Line): string =>
  `patterntype:regexp file:package.json "${escapeRegex(line.name)}":\\s*"[\\^~]?${escapeRegex(line.prefix)} count:1000`;

const matchesIn = (event: string) => {
  const [head, ...rest] = event.split("\n");
  const data = rest.find((row) => row.startsWith("data:"));

  return head === "event: matches" && data !== undefined
    ? decodeMatches(data.slice("data:".length))
    : [];
};

// @effect-diagnostics-next-line asyncFunction:off -- This one-shot Node CLI batches Sourcegraph requests with native Promise I/O.
const search = async (line: Line) => {
  const query = new URLSearchParams({
    display: "1000",
    q: queryFor(line),
  }).toString();

  // @effect-diagnostics-next-line globalFetch:off -- This Node CLI fetches a public Sourcegraph endpoint outside an Effect runtime.
  const response = await fetch(`${SOURCEGRAPH}?${query}`, {
    headers: {
      Accept: "text/event-stream",
      "User-Agent": "Mozilla/5.0 (rat-stack find-peers)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Sourcegraph answered ${response.status} for ${keyOf(line)}`
    );
  }

  const body = await response.text();

  return body.split("\n\n").flatMap(matchesIn);
};

const lines = ourLines();

const peers = new Map<string, Peer>();

const matchedSets = await Promise.all(lines.map(search));

const results = lines.map((line, index) => ({
  line,
  matches: matchedSets[index] ?? [],
}));

for (const { line, matches } of results) {
  for (const match of matches) {
    const repo = match.repository.replace(/^github\.com\//u, "");

    const peer = peers.get(repo) ?? {
      lines: new Set<string>(),
      repo,
      stars: match.repoStars ?? 0,
    };

    peer.lines.add(keyOf(line));
    peers.set(repo, peer);
  }
}

const roster = existsSync(values.roster)
  ? readFileSync(values.roster, "utf-8")
  : "";

const ranked = [...peers.values()]
  .filter(
    (peer) =>
      peer.lines.size >= minShared && peer.repo !== "joelhooks/rat-stack"
  )
  .toSorted((a, b) => b.lines.size - a.lines.size || b.stars - a.stars);

const rows = ranked.map((peer) => {
  const marker = roster.includes(peer.repo) ? "" : "new";
  const shared = [...peer.lines].join(", ");

  return `| ${marker} | [${peer.repo}](https://github.com/${peer.repo}) | ${peer.stars} | ${shared} |`;
});

process.stdout.write(
  `${[
    `Lines: ${lines.map(keyOf).join(", ")}`,
    `Peers sharing at least ${minShared}: ${ranked.length}`,
    "",
    "| New | Repo | Stars | Shared |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")}\n`
);
