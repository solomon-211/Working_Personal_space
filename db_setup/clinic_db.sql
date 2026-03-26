CREATE DATABASE IF NOT EXISTS healthbridge_db;
USE healthbridge_db;

-- TABLE 1: users
CREATE TABLE `users` (
  `user_id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(64) NOT NULL,
  `role` ENUM('admin','doctor','receptionist') NOT NULL,
  `fullname` VARCHAR(100),
  `created_at` DATETIME DEFAULT NOW()
);

-- TABLE 2: patients
CREATE TABLE `patients` (
  `patient_id` INT AUTO_INCREMENT PRIMARY KEY,
  `first_name` VARCHAR(50) NOT NULL,
  `last_name` VARCHAR(50) NOT NULL,
  `date_of_birth` DATE NOT NULL,
  `gender` ENUM('M','F','O'),
  `phone` VARCHAR(20),
  `email` VARCHAR(100),
  `address` TEXT,
  `blood_type` VARCHAR(5),
  `registered_at` DATETIME DEFAULT NOW(),
  `emergency_contact` VARCHAR(100),
  `insurance_provider` VARCHAR(100),
  `national_id` VARCHAR(50),
  `clinic_number` VARCHAR(50) UNIQUE
);

-- TABLE 3: doctors
CREATE TABLE `doctors` (
  `doctor_id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(100) NOT NULL,
  `specialization` VARCHAR(100),
  `phone` VARCHAR(20),
  `email` VARCHAR(100),
  `is_active` TINYINT(1)
);

-- TABLE 4: doctor_schedule
CREATE TABLE `doctor_schedule` (
  `schedule_id` INT AUTO_INCREMENT PRIMARY KEY,
  `doctor_id` INT NOT NULL,
  `day_of_week` ENUM('Mon','Tue','Wed','Thu','Fri','Sat','Sun'),
  `start_time` TIME NOT NULL,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`doctor_id`)
);

-- TABLE 5: appointments
CREATE TABLE `appointments` (
  `appointment_id` INT AUTO_INCREMENT PRIMARY KEY,
  `patient_id` INT NOT NULL,
  `doctor_id` INT NOT NULL,
  `appointment_datetime` DATETIME NOT NULL,
  `reason` TEXT,
  `status` ENUM('Scheduled','Completed','Cancelled','No-show'),
  `created_at` DATETIME DEFAULT NOW(),
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`patient_id`),
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`doctor_id`)
);

-- TABLE 6: medical_visits
CREATE TABLE `medical_visits` (
  `visit_id` INT AUTO_INCREMENT PRIMARY KEY,
  `patient_id` INT NOT NULL,
  `doctor_id` INT NOT NULL,
  `appointment_id` INT,
  `visit_date` DATE NOT NULL,
  `notes` TEXT,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`patient_id`),
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`doctor_id`),
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`appointment_id`)
);

-- TABLE 7: diagnoses
CREATE TABLE `diagnoses` (
  `diagnosis_id` INT AUTO_INCREMENT PRIMARY KEY,
  `visit_id` INT NOT NULL,
  `description` TEXT,
  FOREIGN KEY (`visit_id`) REFERENCES `medical_visits`(`visit_id`)
);

-- TABLE 8: prescriptions
CREATE TABLE `prescriptions` (
  `prescription_id` INT AUTO_INCREMENT PRIMARY KEY,
  `visit_id` INT NOT NULL,
  `drug_name` VARCHAR(150) NOT NULL,
  `dosage` VARCHAR(100),
  `duration` VARCHAR(50),
  `end_time` DATETIME,
  FOREIGN KEY (`visit_id`) REFERENCES `medical_visits`(`visit_id`)
);

-- TABLE 9: services
CREATE TABLE `services` (
  `service_id` INT AUTO_INCREMENT PRIMARY KEY,
  `service_name` VARCHAR(100) NOT NULL,
  `description` TEXT,
  `unit_price` DECIMAL(10,2) NOT NULL,
  `category` VARCHAR(50)
);

-- TABLE 10: invoices
CREATE TABLE `invoices` (
  `invoice_id` INT AUTO_INCREMENT PRIMARY KEY,
  `patient_id` INT NOT NULL,
  `appointment_id` INT,
  `invoice_date` DATE NOT NULL,
  `total_amount` DECIMAL(10,2) DEFAULT 0.00,
  `discount` DECIMAL(10,2) DEFAULT 0.00,
  `amount_due` DECIMAL(10,2) DEFAULT 0.00,
  `payment_status` ENUM('Unpaid','Partial','Paid'),
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`patient_id`),
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`appointment_id`)
);

-- TABLE 11: invoice_items
CREATE TABLE `invoice_items` (
  `item_id` INT AUTO_INCREMENT PRIMARY KEY,
  `invoice_id` INT NOT NULL,
  `service_id` INT NOT NULL,
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(10,2),
  `subtotal` DECIMAL(10,2),
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`invoice_id`),
  FOREIGN KEY (`service_id`) REFERENCES `services`(`service_id`)
);

-- TABLE 12: payments
CREATE TABLE `payments` (
  `payment_id` INT AUTO_INCREMENT PRIMARY KEY,
  `invoice_id` INT NOT NULL,
  `payment_date` DATE NOT NULL,
  `amount_paid` DECIMAL(10,2) NOT NULL,
  `payment_method` ENUM('Cash','Card','Mobile','Insurance'),
  `reference_no` VARCHAR(100),
  `received_by` VARCHAR(100),
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`invoice_id`)
);

-- TABLE 13: analytics_snapshots
CREATE TABLE `analytics_snapshots` (
  `snapshot_id` INT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_date` DATE NOT NULL,
  `total_patients` INT,
  `total_appointments` INT,
  `total_revenue` DECIMAL(12,2),
  `top_diagnosis` VARCHAR(200),
  `cancellation_rate` DECIMAL(5,2),
  `avg_wait_time_min` INT
);

-- TABLE 14: reports
CREATE TABLE `reports` (
  `report_id` INT AUTO_INCREMENT PRIMARY KEY,
  `report_name` VARCHAR(150) NOT NULL,
  `report_type` ENUM('Financial','Clinical','Operational'),
  `date_from` DATE,
  `date_to` DATE,
  `generated_by` VARCHAR(100),
  `generated_at` DATETIME DEFAULT NOW(),
  `summary_data` JSON
);
