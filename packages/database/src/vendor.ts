import type * as Cloudflare from "alchemy/Cloudflare";
import type { StaticConnectionSource } from "alchemy/SQL/ConnectionSource";
import { Context } from "effect";

export type DatabaseVendorResource =
  | {
      readonly _tag: "D1";
      readonly database: Cloudflare.D1.Database;
    }
  | {
      readonly _tag: "HyperdrivePostgres";
      readonly connection: Cloudflare.Hyperdrive.Connection;
      readonly migrationUrl: StaticConnectionSource;
    };

export class DatabaseVendor extends Context.Service<
  DatabaseVendor,
  DatabaseVendorResource
>()("@rat-stack/database/DatabaseVendor") {}
