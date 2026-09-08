CREATE TABLE `blobs` (
	`key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`bytes` blob NOT NULL,
	PRIMARY KEY(`key`, `ordinal`)
);
