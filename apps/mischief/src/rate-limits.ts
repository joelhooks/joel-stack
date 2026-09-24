import { Effect } from "effect";

const stageHash = (stage: string) => {
  let hash = 5381;

  for (const character of stage) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined) {
      hash = (hash * 33 + codePoint) % 2 ** 32;
    }
  }

  return hash % 100_000_000;
};

export const rateLimitNamespaceIds = (stage: string) => {
  if (stage === "prod") {
    return {
      API_PER_IP: 1001,
      EXECUTE_GLOBAL: 1002,
      EXECUTE_PER_IP: 1003,
    } as const;
  }

  const blockStart = 1_000_000 + stageHash(stage) * 4;

  return {
    API_PER_IP: blockStart + 1,
    EXECUTE_GLOBAL: blockStart + 2,
    EXECUTE_PER_IP: blockStart + 3,
  };
};

export const rateLimitDeclarations = (stage: string) => {
  const namespaceIds = rateLimitNamespaceIds(stage);

  return {
    API_PER_IP: {
      namespaceId: namespaceIds.API_PER_IP,
      simple: { limit: 120, period: 60 },
    },
    EXECUTE_GLOBAL: {
      namespaceId: namespaceIds.EXECUTE_GLOBAL,
      simple: { limit: 300, period: 60 },
    },
    EXECUTE_PER_IP: {
      namespaceId: namespaceIds.EXECUTE_PER_IP,
      simple: { limit: 6, period: 60 },
    },
  } as const;
};

export type RateLimitName = keyof ReturnType<typeof rateLimitDeclarations>;

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

export const rateLimitsFrom = (bindings: RateLimitBindings): RateLimits => ({
  limit: (name, key) =>
    Effect.tryPromise(
      // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare owns this Promise-returning runtime boundary.
      () => bindings[name].limit({ key })
    ).pipe(
      Effect.map(({ success }) => success),
      Effect.orDie
    ),
});
