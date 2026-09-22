// Infrastructure as Effects: https://alchemy.run
//
// This is the whole cloud footprint of the project, as one Effect program.
// Auth comes from an Alchemy profile (`pnpm alchemy profile edit --add
// Cloudflare`), never from env vars in this repo. Preview with
// `pnpm infra:plan`; apply with `pnpm infra:deploy`; tear down with
// `pnpm infra:destroy`. Replace these with the project's real
// resources; keep the Stack as the single place they are declared.
//
// Today: the ratstack.sh zone (adopted) and the Mischief Worker that serves
// https://ratstack.sh. `alchemy dev` runs the Worker locally and skips the zone.
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import Mischief from "../mischief/src/worker.js";

export default Alchemy.Stack(
  "RatStack",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* stack() {
    const dev = yield* Alchemy.ALCHEMY_DEV;
    if (!dev) {
      // ratstack.sh already exists in the account, so adoption is explicit.
      // Zones retain on stack removal; there is no destroy() here on purpose.
      yield* Cloudflare.Zone.Zone("RatstackZone", { name: "ratstack.sh" }).pipe(
        adopt(true)
      );
    }
    const mischief = yield* Mischief;
    return { mischiefUrl: mischief.url };
  })
);
