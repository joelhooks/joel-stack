import { toExecuteCapability } from "@rat-stack/capability/code-mode";

import { read } from "./read.js";
import { search } from "./search.js";

export { read } from "./read.js";
export {
  ReadOutput,
  ResourceNotFound,
  SearchMatch,
  SearchOutput,
} from "./schemas.js";
export { search } from "./search.js";

export const contentCapabilities = [search, read] as const;

const generatedExecuteProjection = toExecuteCapability(contentCapabilities);
const executeDescription = [
  generatedExecuteProjection.capability.description,
  "",
  "Pass the program in the `code` argument. Example:",
  "",
  "```js",
  'const found = await tools.search({ query: "capability", limit: 1 });',
  "return await tools.read({ id: found.matches[0].id });",
  "```",
].join("\n");

export const execute = {
  ...generatedExecuteProjection.capability,
  description: executeDescription,
};
export const executeProjection = {
  ...generatedExecuteProjection,
  capability: execute,
};
export const capabilities = [search, read, execute] as const;
