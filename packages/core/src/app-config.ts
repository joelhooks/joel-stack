import { Config } from "effect";

import { ConfigService } from "./config-service.js";

export class AppConfig extends ConfigService.Service<AppConfig>()(
  "@rat-stack/core/AppConfig",
  {
    appEnv: Config.Literals(
      ["development", "test", "production"],
      "APP_ENV"
    ).pipe(Config.withDefault("development")),
  }
) {}
