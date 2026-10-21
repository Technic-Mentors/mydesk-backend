import type { PoolConnection } from "mysql2/promise";

export type PayrollProcessingMode = "AFTER_MONTH_END" | "AFTER_CUTOFF";
export type PayrollProcessingRule = { mode: PayrollProcessingMode; cutoffDay: number };
export const defaultPayrollProcessingRule: PayrollProcessingRule = { mode: "AFTER_MONTH_END", cutoffDay: 25 };
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const payrollToday = (): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export const readPayrollProcessingRule = async (connection: PoolConnection, lock = false): Promise<PayrollProcessingRule> => {
  const [rows]: any = await connection.query(
    "SELECT rule_mode, cutoff_day FROM payroll_processing_settings WHERE id = 1" + (lock ? " FOR UPDATE" : ""));
  if (rows.length !== 1) throw new Error("Payroll processing rule is not configured");
  const mode = rows[0].rule_mode;
  const cutoffDay = Number(rows[0].cutoff_day);
  if ((mode !== "AFTER_MONTH_END" && mode !== "AFTER_CUTOFF") || !Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 31)
    throw new Error("Payroll processing rule is invalid");
  return { mode, cutoffDay };
};

export const payrollAvailability = (year: number, month: string, rule: PayrollProcessingRule, today = payrollToday()) => {
  const index = months.findIndex(value => value.toLowerCase() === month.toLowerCase());
  if (!Number.isInteger(year) || index < 0) return { allowed: false, availableFrom: null, reason: "A valid payroll year and month are required" };
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7)) - 1;
  if (year > currentYear || (year === currentYear && index > currentMonth))
    return { allowed: false, availableFrom: null, reason: "Future payroll months cannot be processed." };
  const daysInMonth = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const eligibleDay = rule.mode === "AFTER_MONTH_END" ? daysInMonth : Math.min(rule.cutoffDay, daysInMonth);
  const availableFrom = new Date(Date.UTC(year, index, eligibleDay + 1)).toISOString().slice(0, 10);
  if (today >= availableFrom) return { allowed: true, availableFrom, reason: "" };
  const reason = rule.mode === "AFTER_MONTH_END"
    ? `Salary Cycle cannot be processed because ${months[index]} ${year} has not completed yet.`
    : `Salary Cycle cannot be processed before the configured cutoff date. Available from ${new Date(availableFrom + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}.`;
  return { allowed: false, availableFrom, reason };
};
