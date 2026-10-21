import pool from "../database/db";

(async () => {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS payroll_run_items (" +
    "calendar_session_id INT NOT NULL, employee_id INT NOT NULL, salary_config_id INT NOT NULL, " +
    "paid_days DECIMAL(6,2) NOT NULL, gross_salary DECIMAL(14,2) NOT NULL, " +
    "loan_deduction DECIMAL(14,2) NOT NULL, overtime_amount DECIMAL(14,2) NOT NULL DEFAULT 0, " +
    "net_salary DECIMAL(14,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
    "PRIMARY KEY (calendar_session_id, employee_id), KEY idx_payroll_employee (employee_id))"
  );
  console.log("Payroll snapshot table is ready");
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
