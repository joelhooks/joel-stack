import { Effect } from "effect";

// Cloudflare rejects non-numeric namespace ids at deploy time ("must have
// valid namespace_id") even though Alchemy's type allows strings and its
// local provider accepts them. Ids are account-unique; 1001-1003 are ours.
export const rateLimitDeclarations = {
  API_PER_IP: {
    namespaceId: 1001,
    simple: { limit: 120, period: 60 },
  },
  EXECUTE_GLOBAL: {
    namespaceId: 1002,
    simple: { limit: 300, period: 60 },
  },
  EXECUTE_PER_IP: {
    namespaceId: 1003,
    simple: { limit: 6, period: 60 },
  },
} as const;

export type RateLimitName = keyof typeof rateLimitDeclarations;

export interface NativeRateLimitBinding {
  readonly limit: (options: {
    readonly key: string;
  }) => Promise<{ readonly success: boolean }>;
}

export interface RateLimitBindings {
  readonly API_PER_IP: NativeRateLimitBinding;
  readonly EXECUTE_GLOBAL: NativeRateLimitBinding;
  readonly EXECUTE_PER_IP: NativeRateLimitBinding;
}

export interface RateLimits {
  readonly limit: (name: RateLimitName, key: string) => Effect.Effect<boolean>;
}

export const makeRateLimits = (bindings: RateLimitBindings): RateLimits => ({
  limit: (name, key) =>
    Effect.tryPromise(
      // Cloudflare owns this Promise-returning runtime boundary.
      // oxlint-disable-next-line typescript/promise-function-async
      () => bindings[name].limit({ key })
    ).pipe(
      Effect.map(({ success }) => success),
      // A broken cost-control binding must not fail open and create workers.
      Effect.orDie
    ),
});
