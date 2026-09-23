import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { devtoolsContracts } from "@rat-stack/devtools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as AtomRpc from "effect/unstable/reactivity/AtomRpc";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

const { group } = toRpcGroup(devtoolsContracts);

export class DevtoolsClient extends AtomRpc.Service<DevtoolsClient>()(
  "RatDevtoolsClient",
  {
    group,
    protocol: RpcClient.layerProtocolHttp({ url: "/__rat/rpc" }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(RpcSerialization.layerJson)
    ),
  }
) {}

export const devtoolsKeys = ["rat-devtools"] as const;

export const recentCalls = DevtoolsClient.query(
  "rat_list_calls",
  { fromEnd: true, limit: 25 },
  { reactivityKeys: devtoolsKeys }
);

export const contracts = DevtoolsClient.query(
  "rat_list_contracts",
  {},
  { reactivityKeys: devtoolsKeys }
);

export const actors = DevtoolsClient.query(
  "rat_list_actors",
  {},
  { reactivityKeys: devtoolsKeys }
);

export const describeContract = (name: string) =>
  DevtoolsClient.query("rat_describe_contract", { name });

export const dispatchCall = DevtoolsClient.mutation("rat_call");

export const runAsPerson = Atom.make<string | null>(null).pipe(Atom.keepAlive);

const REPORT_EVERY = "1500 millis";

const encodeJson = Schema.encodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown)
);

const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json)
);

const jsonOf = (node: AtomRegistry.Node<unknown>): Schema.Json =>
  encodeJson(node.value()).pipe(
    Option.flatMap(decodeJson),
    Option.getOrElse((): Schema.Json => ({ unencodable: true }))
  );

const keyOf = (
  key: Atom.Atom<unknown> | string,
  node: AtomRegistry.Node<unknown>
) => (Predicate.isString(key) ? key : node.atom.label?.[0]);

export const snapshotOf = (registry: AtomRegistry.AtomRegistry) =>
  [...registry.getNodes()].flatMap(([key, node]) => {
    const name = keyOf(key, node);

    return name === undefined
      ? []
      : [
          {
            key: name,
            state: node.currentState(),
            value: node.currentState() === "valid" ? jsonOf(node) : null,
          },
        ];
  });

export const reportAtoms = Atom.family((registry: AtomRegistry.AtomRegistry) =>
  DevtoolsClient.runtime.atom(
    Effect.gen(function* reportAtomsForever() {
      const client = yield* DevtoolsClient;
      const tabId = yield* Ref.make<string | null>(null);
      const last = yield* Ref.make("");

      const report = Effect.gen(function* reportOnce() {
        const atoms = snapshotOf(registry);
        const fingerprint = encodeJson(atoms).pipe(Option.getOrElse(() => ""));

        if (fingerprint === (yield* Ref.get(last))) {
          return;
        }

        const current = yield* Ref.get(tabId);

        const reported = yield* client(
          "rat_report_atoms",
          current === null ? { atoms } : { atoms, tabId: current }
        );

        yield* Ref.set(tabId, reported.tabId);
        yield* Ref.set(last, fingerprint);
      });

      return yield* report.pipe(
        Effect.ignore,
        Effect.repeat(Schedule.spaced(REPORT_EVERY))
      );
    })
  )
);
