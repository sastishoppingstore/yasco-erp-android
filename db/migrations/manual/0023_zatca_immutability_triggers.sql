-- ZATCA Phase 2 — DB-level immutability rails (OPTIONAL, apply manually).
--
-- These triggers are intentionally kept OUT of db/migrations/*.sql because the
-- migration bundler (scripts/compile-schema.js) concatenates files and the
-- MySQL DELIMITER directive below is a client-side command. Apply this file
-- with the mysql CLI as a one-off after the column migration:
--
--   mysql -u <user> -p <db> < db/migrations/manual/0023_zatca_immutability_triggers.sql
--
-- Semantics: once signed_xml is set, the legal content (UUID, hash chain, ICV,
-- XML) cannot change; only status timestamps may. Deleting a signed/cleared
-- invoice is refused outright — corrections must be credit/debit notes.

DELIMITER $$

DROP TRIGGER IF EXISTS `invoices_block_signed_update`$$
CREATE TRIGGER `invoices_block_signed_update`
BEFORE UPDATE ON `invoices`
FOR EACH ROW
BEGIN
  IF OLD.`signed_xml` IS NOT NULL THEN
    IF NOT (NEW.`uuid` <=> OLD.`uuid`
        AND NEW.`invoice_hash` <=> OLD.`invoice_hash`
        AND NEW.`previous_invoice_hash` <=> OLD.`previous_invoice_hash`
        AND NEW.`icv` <=> OLD.`icv`
        AND NEW.`egs_device_id` <=> OLD.`egs_device_id`
        AND NEW.`signed_xml` <=> OLD.`signed_xml`) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'ZATCA: signed invoice content is immutable; issue a credit/debit note instead';
    END IF;
  END IF;
END$$

DROP TRIGGER IF EXISTS `invoices_block_signed_delete`$$
CREATE TRIGGER `invoices_block_signed_delete`
BEFORE DELETE ON `invoices`
FOR EACH ROW
BEGIN
  IF OLD.`signed_xml` IS NOT NULL
     OR OLD.`submission_status` IN ('signed','submitted','cleared','cleared_with_warnings','reported','reported_with_warnings') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ZATCA: a signed/cleared invoice cannot be deleted; issue a credit/debit note instead';
  END IF;
END$$

DELIMITER ;
