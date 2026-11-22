#!/bin/bash
# Idempotent Travel-module migration, additive only.
# Usage:  bash 0024_travel_invoicing.sh [db_name] [mysql_extra_args...]
#   e.g.  bash 0024_travel_invoicing.sh erp_yasco_prod -uroot
#         bash 0024_travel_invoicing.sh yasco_test -uroot
set -u
DB="${1:-erp_yasco_prod}"
shift || true
MYSQL_ARGS="$*"

q() { mysql -N $MYSQL_ARGS -e "$1"; }
run() { mysql $MYSQL_ARGS -e "$1"; }

exists_col() {
  mysql -N $MYSQL_ARGS -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND table_name='$1' AND column_name='$2'"
}
exists_idx() {
  mysql -N $MYSQL_ARGS -e "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema='$DB' AND table_name='$1' AND index_name='$2'"
}

addcol() {
  tbl="$1"; col="$2"; ddl="$3"
  if [ "$(exists_col "$tbl" "$col")" = "0" ]; then
    run "ALTER TABLE \`$tbl\` ADD COLUMN $ddl" && echo "ADDED  $tbl.$col" || echo "FAILED $tbl.$col"
  else echo "EXISTS $tbl.$col"; fi
}
addidx() {
  tbl="$1"; idx="$2"; ddl="$3"
  if [ "$(exists_idx "$tbl" "$idx")" = "0" ]; then
    run "ALTER TABLE \`$tbl\` ADD $ddl" && echo "ADDED  index $idx" || echo "SKIP   index $idx"
  else echo "EXISTS index $idx"; fi
}
# Add an enum member to a column only when the current definition lacks it.
enum_member() {
  tbl="$1"; col="$2"; member="$3"; ddl="$4"
  cur="$(mysql -N $MYSQL_ARGS -e "SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema='$DB' AND table_name='$tbl' AND column_name='$col'")"
  case "$cur" in
    *"'$member'"*) echo "EXISTS $tbl.$col has '$member'";;
    "") echo "SKIP   $tbl.$col missing";;
    *) run "ALTER TABLE \`$tbl\` MODIFY COLUMN $ddl" && echo "MODIFIED $tbl.$col (+$member)" || echo "FAILED $tbl.$col";;
  esac
}

echo "== Travel migration on $DB =="

enum_member invoices invoice_type "ticket" \
  "\`invoice_type\` enum('standard','simplified','zatca','ticket') NOT NULL DEFAULT 'standard'"

addcol invoices travel_invoice_id "travel_invoice_id bigint unsigned NULL"
addidx invoices inv_travel_invoice_idx "KEY \`inv_travel_invoice_idx\` (travel_invoice_id)"

addcol invoice_items travel_invoice_id "travel_invoice_id bigint unsigned NULL"
addcol invoice_items ticket_ref "ticket_ref varchar(100) NULL"

# Travel margin lines tag each finance line with the ZATCA single-letter tax
# category ('S' standard / 'Z' zero-rated). Some existing databases created the
# shared column with word values only, so extend (never shrink) the enum.
tc_type="$(mysql -N $MYSQL_ARGS -e "SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema='$DB' AND table_name='invoice_items' AND column_name='tax_category'")"
if [ -n "$tc_type" ] && ! printf '%s' "$tc_type" | grep -q "'Z'"; then
  run "ALTER TABLE \`invoice_items\` MODIFY COLUMN \`tax_category\` enum('standard','zero_rated','exempt','out_of_scope','S','E','Z','O') DEFAULT 'standard'" \
    && echo "MODIFIED invoice_items.tax_category (+S,E,Z,O)" || echo "FAILED invoice_items.tax_category"
else
  echo "EXISTS invoice_items.tax_category supports 'Z'"
fi

# New columns on already-created travel tables (safe for re-runs)
addcol travel_invoices pricing_mode "pricing_mode enum('standard','margin') NOT NULL DEFAULT 'margin'"
addcol travel_invoices vat_mode "vat_mode enum('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'"
addcol travel_invoices non_taxable_amount "non_taxable_amount decimal(18,4) NOT NULL DEFAULT 0"
addcol travel_invoices taxable_amount "taxable_amount decimal(18,4) NOT NULL DEFAULT 0"
addcol travel_invoice_items base_fare "base_fare decimal(18,4) NOT NULL DEFAULT 0"
addcol travel_invoice_items service_fee "service_fee decimal(18,4) NOT NULL DEFAULT 0"
addcol travel_invoice_items non_taxable_amount "non_taxable_amount decimal(18,4) NOT NULL DEFAULT 0"

# Create tables from the documented SQL (CREATE TABLE IF NOT EXISTS is idempotent)
SQL_DIR="$(cd "$(dirname "$0")" && pwd)"
run "source placeholder" 2>/dev/null || true
mysql $MYSQL_ARGS -e "
CREATE TABLE IF NOT EXISTS \`travel_invoices\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`invoice_id\` bigint unsigned NULL,\`invoice_number\` varchar(50) NOT NULL,\`mode\` enum('zatca','non_tax') NOT NULL,\`pricing_mode\` enum('standard','margin') NOT NULL DEFAULT 'margin',\`vat_mode\` enum('exclusive','inclusive') NOT NULL DEFAULT 'exclusive',\`vat_percent\` decimal(5,2) NOT NULL DEFAULT 15,\`customer_id\` bigint unsigned NULL,\`customer_name\` varchar(255) NULL,\`customer_name_ar\` varchar(255) NULL,\`customer_phone\` varchar(50) NULL,\`customer_vat\` varchar(15) NULL,\`booking_id\` bigint unsigned NULL,\`booking_number\` varchar(50) NULL,\`travel_type\` enum('flight','hotel','package','car_rental','insurance','visa','other') NOT NULL DEFAULT 'other',\`service_ref\` varchar(100) NULL,\`pnr\` varchar(50) NULL,\`ticket_number\` varchar(50) NULL,\`origin\` varchar(255) NULL,\`destination\` varchar(255) NULL,\`depart_date\` date NULL,\`arrive_date\` date NULL,\`passenger_name\` varchar(255) NULL,\`passenger_name_ar\` varchar(255) NULL,\`date\` date NOT NULL,\`due_date\` date NULL,\`currency\` varchar(10) NOT NULL DEFAULT 'SAR',\`sub_total\` decimal(18,4) NOT NULL DEFAULT 0,\`non_taxable_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`taxable_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`discount_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`tax_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`total_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`paid_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`balance_due\` decimal(18,4) NOT NULL DEFAULT 0,\`payment_method\` varchar(50) NULL,\`notes\` text NULL,\`notes_ar\` text NULL,\`status\` enum('draft','issued','paid','cancelled','refunded') NOT NULL DEFAULT 'issued',\`created_by\` bigint unsigned NULL,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),KEY \`travel_invoices_tenant_idx\` (\`tenant_id\`),KEY \`travel_invoices_invoice_idx\` (\`invoice_id\`),KEY \`travel_invoices_booking_idx\` (\`booking_id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS \`travel_invoice_items\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`travel_invoice_id\` bigint unsigned NOT NULL,\`invoice_item_id\` bigint unsigned NULL,\`sku\` varchar(100) NULL,\`description\` text NULL,\`description_ar\` text NULL,\`ticket_ref\` varchar(100) NULL,\`route\` varchar(100) NULL,\`quantity\` int NOT NULL,\`unit_price\` decimal(18,4) NOT NULL,\`base_fare\` decimal(18,4) NOT NULL DEFAULT 0,\`service_fee\` decimal(18,4) NOT NULL DEFAULT 0,\`non_taxable_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`tax_percent\` decimal(5,2) NOT NULL DEFAULT 15,\`taxable_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`tax_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`total_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),KEY \`travel_invoice_items_tenant_idx\` (\`tenant_id\`),KEY \`travel_invoice_items_inv_idx\` (\`travel_invoice_id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS \`travel_settings\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`tourism_license_no\` varchar(50) NULL,\`tourism_license_type_ar\` varchar(100) NULL,\`tourism_license_type_en\` varchar(100) NULL,\`tagline\` varchar(255) NULL,\`tagline_ar\` varchar(255) NULL,\`default_currency\` varchar(10) NOT NULL DEFAULT 'SAR',\`default_vat_percent\` decimal(5,2) NOT NULL DEFAULT 15,\`invoice_prefix\` varchar(20) NOT NULL DEFAULT 'TICK-',\`notes\` text NULL,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),UNIQUE KEY \`travel_settings_tenant_uidx\` (\`tenant_id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS \`travel_passengers\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`customer_id\` bigint unsigned NULL,\`full_name\` varchar(255) NOT NULL,\`full_name_ar\` varchar(255) NULL,\`passport_no\` varchar(50) NULL,\`nationality\` varchar(100) NULL,\`date_of_birth\` date NULL,\`passport_expiry\` date NULL,\`gender\` enum('male','female') NULL,\`phone\` varchar(50) NULL,\`whatsapp\` varchar(50) NULL,\`email\` varchar(320) NULL,\`notes\` text NULL,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),KEY \`travel_passengers_tenant_idx\` (\`tenant_id\`),KEY \`travel_passengers_customer_idx\` (\`customer_id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS \`travel_packages\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`code\` varchar(50) NULL,\`name\` varchar(255) NOT NULL,\`name_ar\` varchar(255) NULL,\`package_type\` enum('umrah','hajj','tour','holiday','corporate') NOT NULL DEFAULT 'umrah',\`supplier_id\` bigint unsigned NULL,\`duration_days\` int NULL,\`nights_makkah\` int NULL,\`nights_madinah\` int NULL,\`cost_price\` decimal(18,4) NOT NULL DEFAULT 0,\`selling_price\` decimal(18,4) NOT NULL DEFAULT 0,\`currency\` varchar(10) NOT NULL DEFAULT 'SAR',\`includes\` text NULL,\`excludes\` text NULL,\`itinerary_notes\` text NULL,\`is_active\` tinyint(1) DEFAULT 1,\`notes\` text NULL,\`created_by\` bigint unsigned NULL,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),KEY \`travel_packages_tenant_idx\` (\`tenant_id\`),KEY \`travel_packages_type_idx\` (\`package_type\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS \`travel_visas\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`reference_number\` varchar(50) NULL,\`passenger_id\` bigint unsigned NULL,\`customer_id\` bigint unsigned NULL,\`passenger_name\` varchar(255) NOT NULL,\`passport_no\` varchar(50) NULL,\`nationality\` varchar(100) NULL,\`visa_type\` enum('umrah','visit','work','business','transit','hajj','other') NOT NULL DEFAULT 'umrah',\`visa_country\` varchar(100) NULL,\`supplier_id\` bigint unsigned NULL,\`application_date\` date NULL,\`issue_date\` date NULL,\`expiry_date\` date NULL,\`cost_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`fee_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`currency\` varchar(10) NOT NULL DEFAULT 'SAR',\`status\` enum('draft','submitted','processing','approved','rejected','issued','cancelled') NOT NULL DEFAULT 'draft',\`notes\` text NULL,\`created_by\` bigint unsigned NULL,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),KEY \`travel_visas_tenant_idx\` (\`tenant_id\`),KEY \`travel_visas_status_idx\` (\`status\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS \`travel_hotels\` (\`id\` bigint unsigned NOT NULL AUTO_INCREMENT,\`tenant_id\` bigint unsigned NOT NULL,\`booking_ref\` varchar(50) NULL,\`customer_id\` bigint unsigned NULL,\`passenger_name\` varchar(255) NOT NULL,\`hotel_name\` varchar(255) NOT NULL,\`hotel_city\` varchar(100) NULL,\`room_type\` varchar(100) NULL,\`rooms\` int DEFAULT 1,\`guests\` int DEFAULT 1,\`check_in\` date NULL,\`check_out\` date NULL,\`nights\` int NULL,\`supplier_id\` bigint unsigned NULL,\`cost_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`selling_amount\` decimal(18,4) NOT NULL DEFAULT 0,\`currency\` varchar(10) NOT NULL DEFAULT 'SAR',\`status\` enum('draft','confirmed','cancelled','completed') NOT NULL DEFAULT 'confirmed',\`notes\` text NULL,\`created_by\` bigint unsigned NULL,\`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY (\`id\`),KEY \`travel_hotels_tenant_idx\` (\`tenant_id\`),KEY \`travel_hotels_status_idx\` (\`status\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"
echo "== done =="
