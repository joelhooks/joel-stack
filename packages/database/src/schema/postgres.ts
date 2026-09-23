import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

export const RunLogs = pgTable(
  "run_logs",
  {
    capability: text("capability").notNull(),
    failureTag: text("failure_tag"),
    id: uuid("id").primaryKey().notNull(),
    outcome: text("outcome").notNull(),
    personId: text("person_id").notNull(),
    recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("run_logs_person_recent_idx").on(
      table.personId,
      table.recordedAt,
      table.id
    ),
    check(
      "run_logs_outcome_check",
      sql`${table.outcome} IN ('Succeeded', 'Failed')`
    ),
    check(
      "run_logs_failure_tag_check",
      sql`(${table.outcome} = 'Succeeded' AND ${table.failureTag} IS NULL) OR (${table.outcome} = 'Failed' AND ${table.failureTag} IS NOT NULL)`
    ),
  ]
);
