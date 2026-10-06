CREATE TABLE `acknowledgements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bed_id` integer NOT NULL,
	`alert_id` integer,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`bed_id` integer,
	`details` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_log_created_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` integer PRIMARY KEY NOT NULL,
	`critical_minutes` integer NOT NULL,
	`critical_percent` integer NOT NULL,
	`attention_minutes` integer NOT NULL,
	`attention_percent` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bed_id` integer NOT NULL,
	`severity` text NOT NULL,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alerts_bed_created_idx` ON `alerts` (`bed_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bed_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bed_id` integer NOT NULL,
	`nurse_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	`assigned_by` text NOT NULL,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nurse_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bed_assignments_bed_unique` ON `bed_assignments` (`bed_id`);--> statement-breakpoint
CREATE TABLE `beds` (
	`id` integer PRIMARY KEY NOT NULL,
	`patient_initials` text NOT NULL,
	`patient_age` integer NOT NULL,
	`fluid_name` text NOT NULL,
	`bag_ml` real NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device_beds` (
	`device_id` text NOT NULL,
	`bed_id` integer NOT NULL,
	`channel` integer NOT NULL,
	PRIMARY KEY(`device_id`, `channel`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_beds_channel_range" CHECK("device_beds"."channel" between 1 and 8)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_beds_bed_unique` ON `device_beds` (`bed_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_beds_unit_channel_unique` ON `device_beds` (`device_id`,`channel`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`unit` text NOT NULL,
	`key_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_reading_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_unit_unique` ON `devices` (`unit`);--> statement-breakpoint
CREATE TABLE `readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bed_id` integer NOT NULL,
	`channel` integer NOT NULL,
	`bag_ml` real NOT NULL,
	`volume_ml` real NOT NULL,
	`flow_ml_h` real NOT NULL,
	`smoothed_flow_ml_h` real NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `readings_bed_recorded_idx` ON `readings` (`bed_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_staff_id_unique` ON `users` (`staff_id`);