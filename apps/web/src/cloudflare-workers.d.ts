declare module "cloudflare:workers" {
  export const env: {
    readonly BACKEND: {
      readonly fetch: (request: Request) => Promise<Response>;
    };
  };
}
