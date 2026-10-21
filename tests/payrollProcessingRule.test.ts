import assert from "node:assert/strict";
import { payrollAvailability } from "../services/payrollProcessingRule";

const monthEnd = { mode: "AFTER_MONTH_END" as const, cutoffDay: 25 };
const cutoff = { mode: "AFTER_CUTOFF" as const, cutoffDay: 25 };
assert.equal(payrollAvailability(2026, "October", monthEnd, "2026-10-31").allowed, false);
assert.equal(payrollAvailability(2026, "October", monthEnd, "2026-10-31").reason,
  "Salary Cycle cannot be processed because October 2026 has not completed yet.");
assert.equal(payrollAvailability(2026, "October", monthEnd, "2026-11-01").allowed, true);
assert.equal(payrollAvailability(2026, "September", monthEnd, "2026-10-01").allowed, true);
assert.equal(payrollAvailability(2026, "October", cutoff, "2026-10-25").allowed, false);
assert.equal(payrollAvailability(2026, "October", cutoff, "2026-10-26").allowed, true);
assert.equal(payrollAvailability(2026, "October", cutoff, "2026-09-30").allowed, false);
assert.equal(payrollAvailability(2026, "February", { mode: "AFTER_CUTOFF", cutoffDay: 31 }, "2026-03-01").allowed, true);
assert.equal(payrollAvailability(2026, "February", { mode: "AFTER_CUTOFF", cutoffDay: 31 }, "2026-02-28").allowed, false);
assert.equal(payrollAvailability(2024, "February", monthEnd, "2024-02-29").allowed, false);
assert.equal(payrollAvailability(2024, "February", monthEnd, "2024-03-01").allowed, true);
console.log("Payroll processing rule: month end, cutoff, future month, and short-month boundaries passed");
