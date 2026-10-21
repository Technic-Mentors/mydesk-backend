import pool from "../database/db";

async function main() {
  const duplicates = [
    ["calendar months", "SELECT year, month, COUNT(*) n FROM calendarsession GROUP BY year, month HAVING COUNT(*) > 1 LIMIT 1"],
    ["salary periods", "SELECT year, month, COUNT(*) n FROM salarycycle GROUP BY year, month HAVING COUNT(*) > 1 LIMIT 1"],
    ["salary calendar links", "SELECT calendar_session_id, COUNT(*) n FROM salarycycle GROUP BY calendar_session_id HAVING COUNT(*) > 1 LIMIT 1"],
  ] as const;
  for (const [label, sql] of duplicates) {
    const [rows]: any = await pool.query(sql);
    if (rows.length) throw new Error("Duplicate " + label + " exist; resolve them before adding Payroll constraints");
  }
  const indexes = [
    { table: "calendarsession", name: "uq_calendar_period", columns: ["year", "month"] },
    { table: "salarycycle", name: "uq_salary_period", columns: ["year", "month"] },
    { table: "salarycycle", name: "uq_salary_calendar", columns: ["calendar_session_id"] },
  ] as const;
  for (const index of indexes) {
    const [rows]: any = await pool.query(
      "SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list, " +
      "MIN(NON_UNIQUE) AS non_unique FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? GROUP BY INDEX_NAME",
      [index.table]);
    if (rows.some((r: any) => Number(r.non_unique) === 0 &&
        r.columns_list === index.columns.join(","))) {
      console.log(index.table + ": unique " + index.columns.join(",") + " already exists");
      continue;
    }
    // Identifiers are fixed literals above, never user input.
    await pool.query("ALTER TABLE " + index.table + " ADD UNIQUE KEY " +
      index.name + " (" + index.columns.join(",") + ")");
    console.log(index.table + ": added " + index.name);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
