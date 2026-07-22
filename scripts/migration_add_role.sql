-- Run this on your Aiven MySQL database to add the role column
-- Connect via: mysql -h mysql-freeschoolsmodel-jonathankiranga-f092.l.aivencloud.com -P 19518 -u avnadmin -p defaultdb --ssl-mode=REQUIRED

ALTER TABLE teachers ADD COLUMN role ENUM('teacher','head') DEFAULT 'teacher' AFTER phone;
