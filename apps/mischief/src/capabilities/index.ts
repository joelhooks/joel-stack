import { toExecuteCapability } from "@rat-stack/capability/code-mode";

import { read } from "./read.js";
import { search } from "./search.js";

export { read } from "./read.js";

export {
  ReadOutput,
  ResourceNotFound,
  SearchMatch,
  SearchOutput,
} from "@rat-stack/core/contracts";

export { search } from "./search.js";

export const contentCapabilities = [search, read] as const;

const generatedExecuteProjection = toExecuteCapability(contentCapabilities);

const executeDescription = [
  generatedExecuteProjection.capability.contract.description,
  "",
  "The program is the body of an async function: `return` sets the result, and `console.log` output is returned in `logs`. Imports, exports, and `fetch` are unavailable; call tools as `await tools.search({...})` or `await tools.read({...})`.",
  "Pass the program in the `code` argument. Example:",
  "",
  "```js",
  'const found = await tools.search({ query: "capability", limit: 1 });',
  "return await tools.read({ id: found.matches[0].id });",
  "```",
].join("\n");

export const execute = {
  ...generatedExecuteProjection.capability,
  contract: {
    ...generatedExecuteProjection.capability.contract,
    description: executeDescription,
  },
};

export const executeProjection = {
  ...generatedExecuteProjection,
  capability: execute,
};

export const capabilities = [search, read, execute] as const;
