import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import Mischief from "../mischief/src/worker.js";
import { Website } from "../web/src/website.js";

export default Alchemy.Stack(
  "RatStack",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* stack() {
    const dev = yield* Alchemy.ALCHEMY_DEV;

    if (!dev) {
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

      yield* Cloudflare.DNS.Dnssec("RatstackDnssec", {
        status: "active",
        zoneId: zone.zoneId,
      }).pipe(adopt(true));
    }

    const mischief = yield* Mischief;
    const website = yield* Website;

    return { mischiefUrl: mischief.url, websiteUrl: website.url };
  })
);
