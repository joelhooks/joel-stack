import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { routes } from "./app.js";
import { layerWorkerLoader } from "./sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "./sandbox-worker-loader.js";

export default class Mischief extends Cloudflare.Worker<Mischief>()(
  "Mischief",
  {
    // Relative to the Alchemy cwd (apps/infra): og.png and the favicons.
    // The asset layer answers matching paths before the Worker runs.
    assets: { directory: "../mischief/public" },
    compatibility: { date: "2026-05-28" },
    dev: { port: 1337 },
    domain: { name: "ratstack.sh", redirects: ["www.ratstack.sh"] },
    main: import.meta.url,
  },
  Effect.gen(function* makeMischief() {
    yield* Cloudflare.WorkerLoader("CODE_SANDBOX");
    const environment = yield* Cloudflare.WorkerEnvironment;
    // This is the native runtime binding declared by WorkerLoader above.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const loader = environment.CODE_SANDBOX as WorkerLoaderBinding;
    const workerRoutes = routes.pipe(
      Layer.provide(
        layerWorkerLoader(loader, {
          compatibilityDate: "2026-05-28",
          cpuMs: 100,
          subRequests: 5,
          timeout: "10 seconds",
        })
      )
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(workerRoutes).pipe(Effect.orDie),
    };
  })
) {}
