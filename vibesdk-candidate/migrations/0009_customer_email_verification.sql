ALTER TABLE `users` ADD `email_verified_at` integer;
--> statement-breakpoint
UPDATE `users`
SET `email_verified` = 0, `email_verified_at` = NULL
WHERE `provider` = 'email';
--> statement-breakpoint
UPDATE `password_reset_tokens`
SET `used` = 1
WHERE `used` = 0;