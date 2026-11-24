ALTER TABLE `queued_thread_messages` ADD `provider_switch_policy` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `provider_switch_operation_id` text;