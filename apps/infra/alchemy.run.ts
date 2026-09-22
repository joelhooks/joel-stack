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
      const zone = yield* Cloudflare.Zone.Zone("RatstackZone", {
        name: "ratstack.sh",
      }).pipe(adopt(true));

      const dnsAidService = (
        id: string,
        name:
          | `_a2a._agents.${string}`
          | `_index._agents.${string}`
          | `_mcp._agents.${string}`
      ) =>
        Cloudflare.DNS.Record(id, {
          content: {
            priority: 1,
            target: "ratstack.sh.",
            value: 'mandatory="alpn,port" alpn="h2" port="443"',
          },
          name,
          ttl: 3600,
          type: "SVCB",
          zoneId: zone.zoneId,
        });

      yield* dnsAidService("DnsAidIndexSvcb", "_index._agents.ratstack.sh");
      yield* dnsAidService("DnsAidA2aSvcb", "_a2a._agents.ratstack.sh");
      yield* dnsAidService("DnsAidMcpSvcb", "_mcp._agents.ratstack.sh");
      yield* Cloudflare.DNS.Record("DnsAidIndexTxt", {
        content: '"agents=rat-stack:mcp,rat-stack:a2a"',
        name: "_index._agents.ratstack.sh",
        ttl: 3600,
        type: "TXT",
        zoneId: zone.zoneId,
      });

      // Alchemy manages Cloudflare's per-zone DNSSEC setting. Adoption keeps
      // an already-signed zone instead of treating it as somebody else's state.
      yield* Cloudflare.DNS.Dnssec("RatstackDnssec", {
        status: "active",
        zoneId: zone.zoneId,
      }).pipe(adopt(true));
    }
    const mischief = yield* Mischief;
    return { mischiefUrl: mischief.url };
  })
);
