-- ZATCA Phase 2 — legal artefacts on the invoices table.
-- ADDITIVE ONLY: every column is nullable (or has a safe default), so existing
-- rows keep working and nothing is dropped. Safe to run once on a live DB.

ALTER TABLE `invoices`
  ADD COLUMN `uuid` varchar(36) NULL,
  ADD COLUMN `invoice_hash` varchar(255) NULL,
  ADD COLUMN `previous_invoice_hash` varchar(255) NULL,
  ADD COLUMN `icv` bigint unsigned NULL,
  ADD COLUMN `egs_device_id` varchar(100) NULL DEFAULT 'default',
  ADD COLUMN `signed_xml` longtext NULL,
  ADD COLUMN `qr_phase2` text NULL,
  ADD COLUMN `submission_status` enum(
    'draft','signed','submitted','cleared','cleared_with_warnings',
    'reported','reported_with_warnings','rejected'
  ) NULL DEFAULT 'draft',
  ADD COLUMN `cleared_at` timestamp NULL,
  ADD COLUMN `reported_at` timestamp NULL,
  ADD COLUMN `supply_date` date NULL;

-- A UUID and an ICV are unique per tenant. NULLs are allowed to repeat in
-- MySQL unique indexes, so legacy invoices without artefacts stay valid.
ALTER TABLE `invoices`
  ADD UNIQUE KEY `inv_tenant_uuid_uidx` (`tenant_id`, `uuid`),
  ADD UNIQUE KEY `inv_tenant_egs_icv_uidx` (`tenant_id`, `egs_device_id`, `icv`);

-- Tax category per line (S/E/Z/O) + exemption reason, required by the UBL
-- Data Dictionary for zero-rated / exempt / out-of-scope supplies.
ALTER TABLE `invoice_items`
  ADD COLUMN `tax_category` enum('S','E','Z','O') NULL DEFAULT 'S',
  ADD COLUMN `exemption_reason` varchar(255) NULL,
  ADD COLUMN `exemption_reason_code` varchar(20) NULL;
