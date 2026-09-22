declare const caches: {
  readonly default: {
    readonly match: (request: Request) => Promise<Response | undefined>;
    readonly put: (request: Request, response: Response) => Promise<void>;
  };
};

declare module "cloudflare:workers" {
  const rpcTargetBrand: unique symbol;

  export class RpcTarget {
    readonly [rpcTargetBrand]: true;
  }
}
