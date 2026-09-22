declare module "cloudflare:workers" {
  const rpcTargetBrand: unique symbol;

  export class RpcTarget {
    readonly [rpcTargetBrand]: true;
  }
}
