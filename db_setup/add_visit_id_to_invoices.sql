-- Migration: add visit_id to invoices so each visit can only ever have one invoice.
-- Run this once on your existing database.

USE healthbridge_db;

-- 1) Add the visit_id column (nullable for any legacy rows that predate this change)
ALTER TABLE invoices
ADD COLUMN `visit_id` INT NULL AFTER `patient_id`;

-- 2) Add the unique constraint (NULL values are excluded, so legacy rows are safe)
ALTER TABLE invoices
ADD UNIQUE INDEX `uq_invoices_visit_id` (`visit_id`);

-- 3) Add the foreign key
ALTER TABLE invoices
ADD CONSTRAINT `fk_invoices_visit_id`
FOREIGN KEY (`visit_id`) REFERENCES `medical_visits`(`visit_id`);
