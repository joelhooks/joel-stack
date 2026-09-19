export { AppConfig } from "./app-config.js";
export { ConfigService } from "./config-service.js";
export { FileInspector } from "./file-inspector.js";
export { capabilities, inspectFile } from "./inspect-file.js";
export {
  inspectMachine,
  runInspectMachine,
  type InspectOutcome,
} from "./inspect-machine.js";
export {
  FileStatsError,
  FileStatsSchema,
  formatFileStats,
  summarizeBytes,
  summarizeText,
  type FileStats,
} from "./stats.js";
