CREATE TABLE `run_logs` (
	`id` text PRIMARY KEY,
	`person_id` text NOT NULL,
	`capability` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`failure_tag` text,
	CONSTRAINT "run_logs_outcome_check" CHECK("outcome" IN ('Succeeded', 'Failed')),
	CONSTRAINT "run_logs_failure_tag_check" CHECK(("outcome" = 'Succeeded' AND "failure_tag" IS NULL) OR ("outcome" = 'Failed' AND "failure_tag" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `run_logs_person_recent_idx` ON `run_logs` (`person_id`,`recorded_at`,`id`);