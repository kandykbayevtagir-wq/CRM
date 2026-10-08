-- Synthetic fixture ONLY for an isolated local/staging D1. Never import into production.
INSERT INTO branches(id,name,address,is_active) VALUES('qa-branch','QA Centre','Test address',1);
INSERT INTO clients(id,full_name,phone,phone_normalized,is_active) VALUES('qa-client','QA Client','77000000001','77000000001',1);
INSERT INTO users(id,telegram_id,name,role,active,client_id,notifications_allowed)
VALUES('qa-owner','990000001','QA Owner','OWNER',1,NULL,0),('qa-user','990000002','QA Client','CLIENT',1,'qa-client',0);
INSERT INTO employees(id,full_name,position,is_active) VALUES('qa-employee','QA Specialist','Specialist',1);
INSERT INTO employee_branches(employee_id,branch_id) VALUES('qa-employee','qa-branch');
INSERT INTO services(id,name,price,duration_minutes,is_active) VALUES('qa-service','QA Service',10000,60,1);
INSERT INTO employee_services(id,employee_id,service_id) VALUES('qa-assignment','qa-employee','qa-service');
INSERT INTO employee_schedules(id,employee_id,day_of_week,starts_time,ends_time,is_active)
VALUES('qa-mon','qa-employee',1,'09:00','18:00',1),('qa-tue','qa-employee',2,'09:00','18:00',1),
('qa-wed','qa-employee',3,'09:00','18:00',1),('qa-thu','qa-employee',4,'09:00','18:00',1),
('qa-fri','qa-employee',5,'09:00','18:00',1),('qa-sat','qa-employee',6,'09:00','18:00',1),
('qa-sun','qa-employee',7,'09:00','18:00',1);
UPDATE organization_settings SET working_days='1,2,3,4,5,6,7';
