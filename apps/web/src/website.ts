import RpcBackend from "@rat-stack/mischief/rpc-worker";
import * as Cloudflare from "alchemy/Cloudflare";

export class Website extends Cloudflare.Website.Vite<Website>()("Website", {
  env: { BACKEND: RpcBackend },
  rootDir: "../web",
}) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
