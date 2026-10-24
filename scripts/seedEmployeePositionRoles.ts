import { readFileSync } from "fs";
import path from "path";
import pool from "../database/db";

async function main() {
  const sql = readFileSync(path.join(__dirname, "../database/migrations/20261024_seed_employee_position_roles.sql"), "utf8");
  const [result]: any = await pool.query(sql);
  const [rows]: any = await pool.query(
    "SELECT roleName FROM roles WHERE roleName IN ('Intern', 'Junior Developer', 'Senior Developer', 'Team Lead', 'Project Manager', 'HR Executive', 'Accountant', 'Sales Executive', 'Admin Staff', 'Office Boy')"
  );
  console.log("Employee position roles ready:", rows.length, "of 10; inserted:", result.affectedRows);
  if (rows.length !== 10) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Employee position role seed failed:", error.code || error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
