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
export const executeProjection = toExecuteCapability(contentCapabilities);
export const execute = executeProjection.capability;
export const capabilities = [search, read, execute] as const;
