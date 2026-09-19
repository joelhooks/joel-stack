import { Config } from "effect";

import { ConfigService } from "./config-service.js";

// Every variable here is also declared in .env.schema for varlock. Effect
// Config reads it in-process; varlock checks it at the shell boundary.
export class AppConfig extends ConfigService.Service<AppConfig>()(
  "@rat-stack/core/AppConfig",
  {
    appEnv: Config.Literals(
      ["development", "test", "production"],
      "APP_ENV"
    ).pipe(Config.withDefault("development")),
  }
) {}
