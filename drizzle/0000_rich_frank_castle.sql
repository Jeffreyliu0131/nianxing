CREATE TABLE `ai_rate_limits` (
	`user_id` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`user_id`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `user_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`user_email` text,
	`display_name` text,
	`schema_version` integer DEFAULT 2 NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
