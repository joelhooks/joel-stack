import { implement } from "@rat-stack/capability/implement";

import { inspectFileContract } from "./contracts.js";
import { runInspectMachine } from "./inspect-machine.js";

export const inspectFile = implement(inspectFileContract, ({ path }) =>
  runInspectMachine(path)
);

export const capabilities = [inspectFile] as const;
