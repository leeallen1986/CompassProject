ALTER TABLE `projects` ADD `discoveryStatus` enum('no_contacts','discovery_queued','discovery_running','role_only','named_contact_no_email','send_ready_contact','blocked_government_owner','blocked_dirty_owner','blocked_no_usable_domain') DEFAULT 'no_contacts';--> statement-breakpoint
ALTER TABLE `projects` ADD `discoveryPriority` enum('A','B','C') DEFAULT 'C';--> statement-breakpoint
ALTER TABLE `projects` ADD `lastDiscoveryAt` timestamp;--> statement-breakpoint
ALTER TABLE `projects` ADD `discoveryAttempts` int DEFAULT 0;