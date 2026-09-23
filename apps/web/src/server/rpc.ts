export type BackendFetch = (request: Request) => Promise<Response>;

export const rpcRouteHandler =
  (fetchBackend: BackendFetch) =>
  // @effect-diagnostics-next-line asyncFunction:off -- The TanStack route handler is a Promise boundary.
  async ({ request }: { readonly request: Request }) =>
    await fetchBackend(request);
