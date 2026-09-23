// @effect-diagnostics nodeBuiltinImport:off asyncFunction:off newPromise:off globalTimers:off globalFetch:off -- Black-box test of `vite dev`: it spawns the real dev server and talks HTTP to it, so Node built-ins, Promises, and fetch are the right tools at that boundary.
import { spawn } from "node:child_process";
import path from "node:path";

import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");

const vite = path.join(webRoot, "node_modules/.bin/vite");

const server = spawn(vite, ["dev", "--port", "0", "--host", "127.0.0.1"], {
  cwd: webRoot,
  env: { ...process.env, NODE_ENV: "development", NO_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

// oxlint-disable-next-line promise/avoid-new -- A child process's first log line has no library Promise to await.
const origin = new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error("vite dev did not report a local URL in 30 seconds"));
  }, 30_000);

  server.stdout.setEncoding("utf-8");
  server.stdout.on("data", (chunk: string) => {
    const url = /http:\/\/127\.0\.0\.1:\d+/u.exec(chunk);

    if (url !== null) {
      clearTimeout(timer);
      resolve(url[0]);
    }
  });
  server.on("error", reject);
});

const RpcExit = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Struct({
      exit: Schema.Struct({ _tag: Schema.String, value: Schema.Unknown }),
    }),
  ])
);

const callRpc = async (tag: string, payload: Schema.JsonObject) => {
  // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- This is the Effect RPC wire message the browser sends; the black-box test writes it by hand on purpose.
  const request = { _tag: "Request", headers: [], id: "1", payload, tag };

  const response = await fetch(`${await origin}/rpc`, {
    body: JSON.stringify(request),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.status).toBe(200);

  const [message] = Schema.decodeUnknownSync(RpcExit)(await response.text());

  return message.exit;
};

beforeAll(async () => {
  await origin;
}, 40_000);

afterAll(() => {
  server.kill();
});

describe("vite dev", () => {
  it("serves the search page", async () => {
    const response = await fetch(`${await origin}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Find the rule or skill you need.");
  });

  it("answers search and read over /rpc in process", async () => {
    const search = await callRpc("search", { limit: 1, query: "capability" });

    const found = Schema.decodeUnknownSync(
      Schema.Struct({
        matches: Schema.Array(Schema.Struct({ id: Schema.String })),
      })
    )(search.value);

    const [first] = found.matches;

    expect(search._tag).toBe("Success");
    expect(first).toBeDefined();

    const read = await callRpc("read", { id: first?.id ?? "" });

    expect(read._tag).toBe("Success");
    expect(read.value).toMatchObject({ id: first?.id });
  });
});
