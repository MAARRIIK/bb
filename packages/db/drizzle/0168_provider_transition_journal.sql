CREATE TABLE `thread_provider_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`host_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`source_provider_id` text NOT NULL,
	`source_provider_session_id` text,
	`source_provider_thread_id` text,
	`source_model_override` text,
	`source_reasoning_level_override` text,
	`target_provider_id` text NOT NULL,
	`target_provider_session_id` text NOT NULL,
	`target_provider_thread_id` text,
	`execution` text NOT NULL,
	`context_text` text NOT NULL,
	`context_through_sequence` integer NOT NULL,
	`context_token_budget` integer NOT NULL,
	`context_window_tokens` integer,
	`context_window_source` text NOT NULL,
	`phase` text NOT NULL,
	`revision` integer NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_provider_transitions_revision_check" CHECK("thread_provider_transitions"."revision" >= 1),
	CONSTRAINT "thread_provider_transitions_generation_check" CHECK("thread_provider_transitions"."target_provider_session_id" IS NOT "thread_provider_transitions"."source_provider_session_id"),
	CONSTRAINT "thread_provider_transitions_phase_check" CHECK("thread_provider_transitions"."phase" IN ('preparing', 'prepared', 'adopting', 'committed', 'finalizing', 'rolling_back', 'completed', 'rolled_back')),
	CONSTRAINT "thread_provider_transitions_native_identity_check" CHECK("thread_provider_transitions"."phase" IN ('preparing', 'rolling_back', 'rolled_back') OR "thread_provider_transitions"."target_provider_thread_id" IS NOT NULL),
	CONSTRAINT "thread_provider_transitions_context_check" CHECK("thread_provider_transitions"."context_through_sequence" >= 0 AND "thread_provider_transitions"."context_token_budget" > 0 AND (("thread_provider_transitions"."context_window_tokens" IS NULL AND "thread_provider_transitions"."context_window_source" = 'unknown') OR ("thread_provider_transitions"."context_window_tokens" IS NOT NULL AND "thread_provider_transitions"."context_window_tokens" > 0 AND "thread_provider_transitions"."context_window_source" IN ('provider', 'host', 'user'))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_provider_transitions_active_thread_idx` ON `thread_provider_transitions` (`thread_id`) WHERE "thread_provider_transitions"."phase" NOT IN ('completed', 'rolled_back');--> statement-breakpoint
CREATE UNIQUE INDEX `thread_provider_transitions_target_generation_idx` ON `thread_provider_transitions` (`target_provider_session_id`);--> statement-breakpoint
CREATE INDEX `thread_provider_transitions_pending_host_idx` ON `thread_provider_transitions` (`host_id`,`updated_at`) WHERE "thread_provider_transitions"."phase" NOT IN ('completed', 'rolled_back');