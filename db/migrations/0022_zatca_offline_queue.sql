-- ZATCA Phase 2 — offline B2C queue.
-- Non-destructive: the table exists in db/schema.ts but was missing from the
-- SQL migrations, so fresh databases could not queue offline invoices.
CREATE TABLE IF NOT EXISTS `zatca_offline_queue` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `invoice_id` bigint unsigned NOT NULL,
  `action` enum('clearance','reporting') NOT NULL,
  `uuid` varchar(255) NOT NULL,
  `xml_payload` text NOT NULL,
  `signed_xml` text,
  `invoice_hash` varchar(255),
  `previous_invoice_hash` varchar(255),
  `status` enum('pending','submitted','cleared','rejected','retrying') NOT NULL DEFAULT 'pending',
  `retry_count` int DEFAULT 0,
  `last_error` text,
  `zatca_response` text,
  `submitted_at` timestamp NULL,
  `cleared_at` timestamp NULL,
  `next_retry_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `zatca_queue_tenant_idx` (`tenant_id`),
  KEY `zatca_queue_status_idx` (`tenant_id`,`status`),
  KEY `zatca_queue_invoice_idx` (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;