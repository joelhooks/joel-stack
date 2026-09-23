import { env } from "cloudflare:workers";

import type { BackendFetch } from "./rpc.js";

// @effect-diagnostics-next-line asyncFunction:off -- Cloudflare service bindings return Promises.
export const backend: BackendFetch = async (request) =>
  await env.BACKEND.fetch(request);
