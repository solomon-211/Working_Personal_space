-- COMMUNITY CLINIC MANAGEMENT SYSTEM
-- Data for Testing

USE healthbridge_db;

-- patients
INSERT INTO `patients` VALUES
(1, 'Akol',    'Deng',     '1990-04-12', 'M', '+211 912 100 001', 'akol.deng@email.com',    'Juba, Tongping',          'O+', NOW(), 'Mary Deng — +211 912 100 009',    'SSRA Health',  'SS-NID-00101', 'CLN-0001'),
(2, 'Achol',   'Majok',    '1985-07-22', 'F', '+211 912 100 002', 'achol.majok@email.com',  'Juba, Gudele',            'A+', NOW(), 'Peter Majok — +211 912 100 010',   'None',         'SS-NID-00102', 'CLN-0002'),
(3, 'Garang',  'Kuol',     '2001-11-05', 'M', '+211 912 100 003', 'garang.kuol@email.com',  'Wau, Central',            'B+', NOW(), 'Ayen Kuol — +211 912 100 011',     'NHIF',         'SS-NID-00103', 'CLN-0003'),
(4, 'Nyakim',  'Gatkuoth', '1995-02-18', 'F', '+211 912 100 004', 'nyakim.g@email.com',     'Malakal, Township',       'AB+',NOW(), 'Riek Gatkuoth — +211 912 100 012', 'SSRA Health',  'SS-NID-00104', 'CLN-0004'),
(5, 'Thon',    'Ayuen',    '1978-09-30', 'M', '+211 912 100 005', 'thon.ayuen@email.com',   'Bor, Jonglei',            'O−', NOW(), 'Adut Ayuen — +211 912 100 013',    'None',         'SS-NID-00105', 'CLN-0005');

-- doctors
INSERT INTO `doctors` VALUES
(1, 'Dr. James Lual',    'General Practice',  '+211 922 200 001', 'j.lual@clinic.ss',    1),
(2, 'Dr. Grace Akuei',   'Pediatrics',        '+211 922 200 002', 'g.akuei@clinic.ss',   1),
(3, 'Dr. Samuel Dut',    'Internal Medicine', '+211 922 200 003', 's.dut@clinic.ss',     1),
(4, 'Dr. Rebecca Ayen',  'Obstetrics',        '+211 922 200 004', 'r.ayen@clinic.ss',    1),
(5, 'Dr. Moses Maker',   'Surgery',           '+211 922 200 005', 'm.maker@clinic.ss',   0);

-- doctor_schedule
INSERT INTO `doctor_schedule` VALUES
(1, 1, 'Mon', '08:00:00'),
(2, 1, 'Wed', '08:00:00'),
(3, 2, 'Tue', '09:00:00'),
(4, 3, 'Thu', '08:30:00'),
(5, 4, 'Fri', '10:00:00');

-- appointments
INSERT INTO `appointments` VALUES
(1,  1, 1, '2025-06-10 09:00:00', 'Persistent fever and headache',          'Completed', NOW()),
(2,  2, 2, '2025-06-11 10:30:00', 'Child routine checkup',                  'Completed', NOW()),
(3,  3, 3, '2025-06-12 08:30:00', 'Hypertension follow-up',                 'Completed', NOW()),
(4,  4, 4, '2025-06-13 11:00:00', 'Antenatal care visit',                   'Completed', NOW()),
(5,  5, 1, '2025-06-14 09:00:00', 'Chest pain and shortness of breath',     'No-show',   NOW()),
(6,  1, 1, CURDATE() + INTERVAL 1 DAY + INTERVAL 9 HOUR,  'Follow-up on malaria treatment',         'Scheduled', NOW()),
(7,  2, 2, CURDATE() + INTERVAL 1 DAY + INTERVAL 10 HOUR, 'Child vaccination — 18 months',           'Scheduled', NOW()),
(8,  3, 3, CURDATE() + INTERVAL 2 DAY + INTERVAL 8 HOUR,  'Blood pressure review',                  'Scheduled', NOW()),
(9,  4, 4, CURDATE() + INTERVAL 2 DAY + INTERVAL 11 HOUR, 'Antenatal care — 32 weeks',               'Scheduled', NOW()),
(10, 1, 3, CURDATE() + INTERVAL 3 DAY + INTERVAL 9 HOUR,  'General fatigue and dizziness',          'Scheduled', NOW()),
(11, 3, 1, CURDATE() + INTERVAL 3 DAY + INTERVAL 10 HOUR, 'Routine checkup',                        'Scheduled', NOW()),
(12, 5, 3, CURDATE() + INTERVAL 4 DAY + INTERVAL 8 HOUR,  'Diabetes management follow-up',          'Scheduled', NOW()),
(13, 2, 4, CURDATE() + INTERVAL 4 DAY + INTERVAL 11 HOUR, 'Postpartum checkup',                     'Scheduled', NOW()),
(14, 4, 1, CURDATE() + INTERVAL 5 DAY + INTERVAL 9 HOUR,  'Skin rash and itching',                  'Scheduled', NOW()),
(15, 1, 2, CURDATE() + INTERVAL 5 DAY + INTERVAL 10 HOUR, 'Child growth assessment',                'Scheduled', NOW());

-- medical_visits
INSERT INTO `medical_visits` VALUES
(1, 1, 1, 1, '2025-06-10', 'Patient had 38.9°C fever. Malaria RDT positive. Treatment initiated.'),
(2, 2, 2, 2, '2025-06-11', 'Child is healthy. Weight and height within normal range for age.'),
(3, 3, 3, 3, '2025-06-12', 'BP recorded at 142/88. Medication adjusted. Advised low-salt diet.'),
(4, 4, 4, 4, '2025-06-13', 'Pregnancy at 28 weeks. Fetal heartbeat normal. Iron supplements prescribed.'),
(5, 2, 2, NULL,'2025-06-14', 'Walk-in. Child presented with diarrhea and mild dehydration. ORS administered.');

-- diagnoses
INSERT INTO `diagnoses` VALUES
(1, 1, 'Plasmodium falciparum malaria — uncomplicated'),
(2, 2, 'Healthy child — no pathology identified'),
(3, 3, 'Stage 1 hypertension — under medication management'),
(4, 4, 'Normal pregnancy — 28 weeks gestation'),
(5, 5, 'Acute gastroenteritis with mild dehydration');

-- prescriptions
INSERT INTO `prescriptions` VALUES
(1, 1, 'Artemether-Lumefantrine (Coartem)', '4 tablets twice daily', '3 days',  '2025-06-13 00:00:00'),
(2, 1, 'Paracetamol',                       '500mg three times daily','5 days',  '2025-06-15 00:00:00'),
(3, 3, 'Amlodipine',                        '5mg once daily',         '30 days', '2025-07-12 00:00:00'),
(4, 4, 'Ferrous Sulfate (Iron)',             '200mg once daily',       '60 days', '2025-08-12 00:00:00'),
(5, 5, 'ORS Sachets',                       '1 sachet after each stool','5 days', '2025-06-19 00:00:00');

-- services
INSERT INTO `services` VALUES
(1, 'General Consultation', 'Standard outpatient doctor consultation',        500.00,  'Consultation'),
(2, 'Malaria Rapid Test',   'RDT blood test for malaria detection',            300.00,  'Lab'),
(3, 'Antenatal Care Visit', 'Routine checkup for pregnant mothers',            400.00,  'Consultation'),
(4, 'Pediatric Checkup',    'Routine growth and health check for children',    350.00,  'Consultation'),
(5, 'ORS Administration',   'Oral rehydration therapy for dehydration cases',  150.00,  'Procedures');

-- invoices
INSERT INTO `invoices` VALUES
(1, 1, 1, '2025-06-10', 800.00,  0.00,   800.00,  'Paid'),
(2, 2, 2, '2025-06-11', 350.00,  0.00,   350.00,  'Paid'),
(3, 3, 3, '2025-06-12', 500.00,  50.00,  450.00,  'Paid'),
(4, 4, 4, '2025-06-13', 400.00,  0.00,   400.00,  'Unpaid'),
(5, 2, NULL,'2025-06-14', 650.00, 0.00,   650.00,  'Partial');

-- invoice_items
INSERT INTO `invoice_items` VALUES
(1, 1, 1, 1, 500.00, 500.00),
(2, 1, 2, 1, 300.00, 300.00),
(3, 2, 4, 1, 350.00, 350.00),
(4, 3, 1, 1, 500.00, 500.00),
(5, 5, 4, 1, 350.00, 350.00);

-- payments
INSERT INTO `payments` VALUES
(1, 1, '2025-06-10', 800.00, 'Cash',      'RCP-SS-001', 'Amina Lado'),
(2, 2, '2025-06-11', 350.00, 'Mobile',    'MTN-SS-441', 'Amina Lado'),
(3, 3, '2025-06-12', 450.00, 'Insurance', 'INS-SS-882', 'John Ladu'),
(4, 5, '2025-06-14', 300.00, 'Cash',      'RCP-SS-002', 'John Ladu'),
(5, 4, '2025-06-15', 200.00, 'Mobile',    'MTN-SS-443', 'Amina Lado');

-- users
-- admin.juba: admin123 | j.lual, g.akuei: doctor123 | amina.lado, john.ladu: recep123
INSERT INTO `users` VALUES
(1, 'admin.juba',    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin',        'System Administrator', NOW()),
(2, 'j.lual',        'f348d5628621f3d8f59c8cabda0f8eb0aa7e0514a90be7571020b1336f26c113', 'doctor',       'Dr. James Lual',       NOW()),
(3, 'g.akuei',       'f348d5628621f3d8f59c8cabda0f8eb0aa7e0514a90be7571020b1336f26c113', 'doctor',       'Dr. Grace Akuei',      NOW()),
(4, 'amina.lado',    '5d37ed314cf2b5c8462b52b12cd512e2ac4a180e75598da4f12bfb0dea6d0a67', 'receptionist', 'Amina Lado',           NOW()),
(5, 'john.ladu',     '5d37ed314cf2b5c8462b52b12cd512e2ac4a180e75598da4f12bfb0dea6d0a67', 'receptionist', 'John Ladu',            NOW());

-- reports
INSERT INTO `reports` VALUES
(1, 'June 2025 Revenue Report',        'Financial',   '2025-06-01', '2025-06-30', 'admin.juba', NOW(), '{"total_revenue": 2300.00, "paid_invoices": 3}'),
(2, 'Top Diagnoses — June 2025',       'Clinical',    '2025-06-01', '2025-06-30', 'admin.juba', NOW(), '{"top": "Malaria", "total_diagnoses": 5}'),
(3, 'Appointment Utilization Report',  'Operational', '2025-06-01', '2025-06-30', 'admin.juba', NOW(), '{"total": 5, "completed": 3, "no_show": 1}'),
(4, 'Pediatric Visit Summary',         'Clinical',    '2025-06-01', '2025-06-30', 'admin.juba', NOW(), '{"pediatric_visits": 2, "avg_age": 4}'),
(5, 'Staff Activity Report',           'Operational', '2025-06-01', '2025-06-30', 'admin.juba', NOW(), '{"active_doctors": 4, "total_visits": 5}');

-- analytics_snapshots
INSERT INTO `analytics_snapshots` VALUES
(1, '2025-06-10', 120, 18, 2500.00, 'Malaria',         '5.56',  12),
(2, '2025-06-11', 121, 22, 3100.00, 'Gastroenteritis', '9.09',  15),
(3, '2025-06-12', 123, 20, 2800.00, 'Hypertension',    '10.00', 18),
(4, '2025-06-13', 125, 17, 2200.00, 'Malaria',         '5.88',  10),
(5, '2025-06-14', 126, 19, 2950.00, 'Malaria',         '10.53', 14);