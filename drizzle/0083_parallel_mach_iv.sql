CREATE TABLE `repDigestGateResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`weekKey` varchar(16) NOT NULL,
	`decision` varchar(8) NOT NULL,
	`blockers` json,
	`top3Snapshot` json,
	`rescueAttempted` boolean NOT NULL DEFAULT false,
	`rescueResult` json,
	`deltaComparison` json,
	`phase` varchar(16) NOT NULL DEFAULT 'pre_digest',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repDigestGateResults_id` PRIMARY KEY(`id`)
);
