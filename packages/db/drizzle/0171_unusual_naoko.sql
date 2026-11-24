CREATE TABLE `queued_task_runs` (
	`queued_message_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`state` text NOT NULL,
	`original_request_id` text,
	`request_id` text,
	`provider_id` text,
	`provider_session_id` text,
	`turn_id` text,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "queued_task_runs_request_check" CHECK(("queued_task_runs"."original_request_id" IS NULL) = ("queued_task_runs"."request_id" IS NULL) AND ("queued_task_runs"."request_id" IS NULL) = ("queued_task_runs"."provider_id" IS NULL) AND ("queued_task_runs"."provider_id" IS NOT NULL OR "queued_task_runs"."provider_session_id" IS NULL) AND ("queued_task_runs"."turn_id" IS NULL OR "queued_task_runs"."request_id" IS NOT NULL)),
	CONSTRAINT "queued_task_runs_state_check" CHECK(CASE "queued_task_runs"."state"
        WHEN 'queued' THEN "queued_task_runs"."request_id" IS NULL AND "queued_task_runs"."turn_id" IS NULL AND "queued_task_runs"."failure_reason" IS NULL
        WHEN 'running' THEN "queued_task_runs"."request_id" IS NOT NULL AND "queued_task_runs"."failure_reason" IS NULL
        WHEN 'succeeded' THEN "queued_task_runs"."request_id" IS NOT NULL AND "queued_task_runs"."turn_id" IS NOT NULL AND "queued_task_runs"."failure_reason" IS NULL
        WHEN 'failed' THEN "queued_task_runs"."request_id" IS NOT NULL
        WHEN 'cancelled' THEN 1
        ELSE 0
      END)
);
--> statement-breakpoint
CREATE INDEX `queued_task_runs_thread_state_idx` ON `queued_task_runs` (`thread_id`,`state`);--> statement-breakpoint
CREATE INDEX `queued_task_runs_request_idx` ON `queued_task_runs` (`thread_id`,`request_id`) WHERE "queued_task_runs"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `queued_task_runs_original_request_idx` ON `queued_task_runs` (`thread_id`,`original_request_id`) WHERE "queued_task_runs"."original_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `queued_task_runs_turn_idx` ON `queued_task_runs` (`thread_id`,`turn_id`) WHERE "queued_task_runs"."turn_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `depends_on_queued_message_ids` text DEFAULT '[]' NOT NULL;