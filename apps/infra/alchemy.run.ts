// Infrastructure as Effects: https://alchemy.run
//
// This is the whole cloud footprint of the project, as one Effect program.
// Auth comes from an Alchemy profile (`pnpm alchemy profile edit --add
// Cloudflare`), never from env vars in this repo. Preview with
// `pnpm infra:plan`; apply with `pnpm infra:deploy`; tear down with
// `pnpm infra:destroy`. Replace the example bucket with the project's real
// resources; keep the Stack as the single place they are declared.
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "TsCliTemplate",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* stack() {
    const bucket = yield* Cloudflare.R2.Bucket("Bucket");
    return {
      bucketName: bucket.bucketName,
    };
  })
);
