import { describe, expect, it } from "@effect/vitest";
import { defineContract, implement } from "@rat-stack/capability";
import { PersonIdSchema } from "@rat-stack/database";
import { CallLog, devtools, devtoolsLayer } from "@rat-stack/devtools";
import type { InvokeResult } from "@rat-stack/devtools";
import { RuntimeContext } from "alchemy";
import { Effect, Layer, Schema } from "effect";

import {
  ratTestPerson,
  runAsPerson,
  testPersonLayer,
} from "../src/devtools.js";
import { Auth, CurrentPerson } from "../src/index.js";

const whoAmI = implement(
  defineContract("whoAmI", {
    description: "Return the id of the person making the call.",
    failure: Schema.Never,
    input: Schema.Struct({ note: Schema.optional(Schema.String) }),
    output: Schema.Struct({ personId: PersonIdSchema }),
  }),
  () =>
    Effect.gen(function* whoAmIHandler() {
      return { personId: yield* CurrentPerson };
    })
);

const TestPersonResult = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({
    cookie: Schema.String,
    email: Schema.String,
    personId: PersonIdSchema,
  }),
});

const WhoAmIResult = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ personId: PersonIdSchema }),
});

const Refusal = Schema.Struct({
  error: Schema.Struct({ reason: Schema.String }),
  ok: Schema.Literal(false),
});

const personOf = (result: InvokeResult) =>
  Schema.decodeUnknownEffect(WhoAmIResult)(result).pipe(
    Effect.map(({ value }) => value.personId)
  );

const setup = devtools([whoAmI, ratTestPerson], { runAs: runAsPerson });

const call = setup.pipe(Effect.map(({ tools }) => tools[5]));

const replayCall = setup.pipe(Effect.map(({ tools }) => tools[6]));

const base = Layer.mergeAll(
  Auth.memoryLayer("devtools-test-secret-with-enough-entropy"),
  RuntimeContext.phantom
);

const services = Layer.mergeAll(
  devtoolsLayer(),
  testPersonLayer("default").pipe(Layer.provide(base)),
  base
);

describe("devtools with auth", () => {
  it.effect("signs a test person in and runs a call as them", () =>
    Effect.gen(function* runsAsTestPerson() {
      const dispatch = yield* call;

      const created = yield* dispatch.handler({
        capability: "rat_test_person",
        input: { name: "ada" },
      });

      const again = yield* dispatch.handler({
        capability: "rat_test_person",
        input: { name: "ada" },
      });

      const ada = yield* Schema.decodeUnknownEffect(TestPersonResult)(
        created.result
      );

      const adaAgain = yield* Schema.decodeUnknownEffect(TestPersonResult)(
        again.result
      );

      const asAda = yield* dispatch.handler({
        as: ada.value.personId,
        capability: "whoAmI",
        input: {},
      });

      const asDefault = yield* dispatch.handler({
        capability: "whoAmI",
        input: {},
      });

      const auth = yield* Auth;

      const session = yield* auth.getSession(
        new Headers({ cookie: ada.value.cookie })
      );

      expect(ada.value.email).toBe("ada@rat.test");
      expect(adaAgain.value.personId).toBe(ada.value.personId);
      expect(session?.user.id).toBe(ada.value.personId);
      expect(yield* personOf(asAda.result)).toBe(ada.value.personId);
      expect(yield* personOf(asDefault.result)).toBe(yield* CurrentPerson);
    }).pipe(Effect.provide(services))
  );

  it.effect("records who made each call and replays as the same person", () =>
    Effect.gen(function* recordsIdentity() {
      const dispatch = yield* call;
      const replay = yield* replayCall;

      const created = yield* dispatch.handler({
        capability: "rat_test_person",
        input: { name: "grace" },
      });

      const grace = yield* Schema.decodeUnknownEffect(TestPersonResult)(
        created.result
      );

      yield* dispatch.handler({
        as: grace.value.personId,
        capability: "whoAmI",
        input: {},
      });

      const { entries } = yield* (yield* CallLog).snapshot;
      const recorded = entries.find((entry) => entry.capability === "whoAmI");
      const replayed = yield* replay.handler({ index: recorded?.index ?? -1 });

      expect(recorded?.as).toBe(grace.value.personId);
      expect(replayed.changes).toEqual([]);
    }).pipe(Effect.provide(services))
  );

  it.effect("refuses an identity that is not a person id", () =>
    Effect.gen(function* refusesBadIdentity() {
      const dispatch = yield* call;

      const refused = yield* dispatch.handler({
        as: "",
        capability: "whoAmI",
        input: {},
      });

      const { error } = yield* Schema.decodeUnknownEffect(Refusal)(
        refused.result
      );

      expect(error.reason).toBe("`as` is not a valid person id");
    }).pipe(Effect.provide(services))
  );
});
