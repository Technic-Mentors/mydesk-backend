import pool from "../database/db";

async function main() {
  const columns: Array<[string,string]> = [
    ["must_change_password","BOOLEAN NOT NULL DEFAULT FALSE"],
    ["department","VARCHAR(120) NULL"],
    ["reporting_manager","VARCHAR(120) NULL"],
  ];
  const [existing]: any = await pool.query("SHOW COLUMNS FROM tbl_users");
  const names = new Set(existing.map((column: {Field:string}) => column.Field));
  for (const [name,definition] of columns) {
    if (!names.has(name)) await pool.query(`ALTER TABLE tbl_users ADD COLUMN ${name} ${definition}`);
  }
  console.log("Employee credential schema ready");
}
main().catch((error) => { console.error("Employee credential migration failed:",error); process.exitCode=1; })
  .finally(() => pool.end());
