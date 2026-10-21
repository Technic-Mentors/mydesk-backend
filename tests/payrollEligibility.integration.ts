import pool from "../database/db";

(async () => {
  const [rows]: any = await pool.query(
    "SELECT c.id, c.employee_id, c.total_salary, c.attendance_base, " +
    "DATE_FORMAT(c.effective_from, '%Y-%m-%d') AS effective_from, " +
    "DATE_FORMAT(e.joined, '%Y-%m-%d') AS joined, " +
    "DATE_FORMAT(w.last_day, '%Y-%m-%d') AS last_day " +
    "FROM configempsalaries c " +
    "JOIN (SELECT employee_id, MIN(date) AS joined FROM employee_lifeline GROUP BY employee_id) e ON e.employee_id = c.employee_id " +
    "JOIN tbl_users u ON u.id = c.employee_id " +
    "LEFT JOIN (SELECT employee_id, MAX(last_working_day) AS last_day FROM withdrawals " +
    "WHERE withdrawStatus = 'Y' GROUP BY employee_id) w ON w.employee_id = c.employee_id " +
    "WHERE c.status = 'ACTIVE' AND c.effective_from <= ? AND e.joined <= ? " +
    "AND (u.status = 'Active' OR w.last_day >= ?) " +
    "AND c.id = (SELECT c2.id FROM configempsalaries c2 WHERE c2.employee_id = c.employee_id " +
    "AND c2.status = 'ACTIVE' AND c2.effective_from <= ? " +
    "ORDER BY c2.effective_from DESC, c2.id DESC LIMIT 1) ORDER BY c.employee_id",
    ["2026-10-31", "2026-10-31", "2026-10-01", "2026-10-31"]);
  console.log("Payroll eligibility SQL valid; eligible configurations:", rows.length);
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
