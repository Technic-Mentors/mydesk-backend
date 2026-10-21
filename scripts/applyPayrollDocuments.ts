import pool from "../database/db";

const columns: Record<string,string> = {
  scheduled_basic: "DECIMAL(14,2) NULL",
  scheduled_allowances: "DECIMAL(14,2) NULL",
  absence_deduction: "DECIMAL(14,2) NULL",
  working_days: "DECIMAL(6,2) NULL",
  overtime_hours: "DECIMAL(8,2) NULL",
  loan_balance_after: "DECIMAL(14,2) NULL",
};
(async () => {
  for (const [name, definition] of Object.entries(columns)) {
    const [found]: any = await pool.query(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payroll_run_items' AND COLUMN_NAME=?",
      [name]);
    if (!found.length) await pool.query(`ALTER TABLE payroll_run_items ADD COLUMN ${name} ${definition}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS payroll_documents (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    salary_cycle_id INT NOT NULL,
    employee_id INT NULL,
    document_key VARCHAR(50) NOT NULL,
    generated_at DATETIME NULL,
    email_status ENUM('Pending','Sending','Sent','Failed','Skipped') NOT NULL DEFAULT 'Pending',
    email_sent_at DATETIME NULL,
    email_error VARCHAR(500) NULL,
    email_attempts INT NOT NULL DEFAULT 0,
    email_claimed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payroll_document (salary_cycle_id,document_key),
    KEY idx_payroll_document_employee (employee_id,salary_cycle_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS payroll_admin_deliveries (
    salary_cycle_id INT NOT NULL,
    recipient_id INT NOT NULL,
    status ENUM('Pending','Sending','Sent','Failed') NOT NULL DEFAULT 'Pending',
    sent_at DATETIME NULL,
    error VARCHAR(500) NULL,
    attempts INT NOT NULL DEFAULT 0,
    claimed_at DATETIME NULL,
    PRIMARY KEY (salary_cycle_id,recipient_id)
  )`);  console.log("Payroll document schema is ready");
})().catch(e => { console.error(e); process.exitCode=1; }).finally(() => pool.end());

