import { env } from "cloudflare:workers";

import type { BackendFetch } from "./rpc.js";

// @effect-diagnostics-next-line asyncFunction:off -- Cloudflare service bindings return Promises.
export const backend: BackendFetch = async (request) =>
  await env.BACKEND.fetch(request);

// @effect-diagnostics-next-line asyncFunction:off -- The TanStack route handler is a Promise boundary.
export const devtoolsBackend: BackendFetch = async () =>
  await Promise.resolve(new Response("Not found", { status: 404 }));
