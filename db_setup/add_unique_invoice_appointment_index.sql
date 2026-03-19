-- Migration: prevent duplicate invoices for the same appointment
-- Run this on existing databases after resolving any duplicates.

USE healthbridge_db;

-- 1) Optional check: identify duplicates before adding the unique index.
SELECT appointment_id, COUNT(*) AS duplicate_count
FROM invoices
WHERE appointment_id IS NOT NULL
GROUP BY appointment_id
HAVING COUNT(*) > 1;

-- 2) Add unique index (allows multiple NULL appointment_id rows).
ALTER TABLE invoices
ADD UNIQUE INDEX uq_invoices_appointment_id (appointment_id);
