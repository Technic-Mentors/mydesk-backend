import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/middleware";
import pool from "../database/db";
import { processPayrollDocuments } from "../services/payrollDocuments";
import { payrollAvailability, payrollToday, readPayrollProcessingRule } from "../services/payrollProcessingRule";

const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const runSalaryCycle = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const year = Number(req.body.year);
  const index = months.findIndex(m => m.toLowerCase() === String(req.body.month || "").toLowerCase());
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || index < 0) {
    res.status(400).json({ message: "A valid payroll year and month are required" }); return;
  }
  const month = months[index];
  const start = year + "-" + String(index + 1).padStart(2, "0") + "-01";
  const end = year + "-" + String(index + 1).padStart(2, "0") + "-" + new Date(year, index + 1, 0).getDate();
  const days = new Date(year, index + 1, 0).getDate();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [calendar]: any = await connection.query(
      "SELECT id, session_name, calendarStatus FROM calendarsession WHERE year = ? AND LOWER(month) = LOWER(?) ORDER BY id FOR UPDATE",
      [year, month]);
    if (calendar.length !== 1) {
      await connection.rollback();
      res.status(409).json({ message: "Exactly one calendar month is required before payroll can run" }); return;
    }
    const [existing]: any = await connection.query(
      "SELECT id FROM salarycycle WHERE calendar_session_id = ? OR (year = ? AND LOWER(month) = LOWER(?)) LIMIT 1",
      [calendar[0].id, year, month]);
    const [accounts]: any = await connection.query(
      "SELECT id FROM employee_accounts WHERE refNo LIKE ? LIMIT 1",
      ["SALARY-" + month + "-" + year + "-%"]);
    if (existing.length || accounts.length) {
      await connection.rollback();
      res.status(409).json({ message: "Salary cycle has already been run for " + month + " " + year }); return;
    }
    const rule = await readPayrollProcessingRule(connection, true);
    const availability = payrollAvailability(year, month, rule, payrollToday());
    if (!availability.allowed) {
      await connection.rollback();
      res.status(409).json({ message: availability.reason, availableFrom: availability.availableFrom }); return;
    }
    if (calendar[0].calendarStatus !== "Active") {
      await connection.rollback();
      res.status(409).json({ message: "Calendar month must be active before payroll can run" }); return;
    }
    const [salaries]: any = await connection.query(
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
      [end, end, start, end]);
    if (!salaries.length) {
      await connection.rollback();
      res.status(400).json({ message: "No eligible salary configurations for this month" }); return;
    }
    let processedEmployees = 0;
    for (const sal of salaries) {
      const payEnd = sal.last_day && sal.last_day < end ? sal.last_day : end;
      const [configs]: any = await connection.query(
        "SELECT id, total_salary, salary_amount, emp_of_mon_allowance, transport_allowance, medical_allowance, attendance_base, " +
        "DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from " +
        "FROM configempsalaries WHERE employee_id = ? AND status = 'ACTIVE' " +
        "AND effective_from <= ? ORDER BY effective_from, id",
        [sal.employee_id, payEnd]);
      if (!configs.length) continue;
      const eligibleFrom = [start, sal.joined, configs[0].effective_from].sort().slice(-1)[0];
      if (eligibleFrom > payEnd) continue;
      const paid = new Map<string, number>();
      const [attendance]: any = await connection.query(
        "SELECT DATE_FORMAT(date, '%Y-%m-%d') AS day FROM attendance " +
        "WHERE userId = ? AND date BETWEEN ? AND ? AND status = 'Y' " +
        "AND LOWER(attendanceStatus) IN ('present', 'late', 'leave', 'short leave')",
        [sal.employee_id, eligibleFrom, payEnd]);
      for (const row of attendance) paid.set(row.day, 1);
      const [leaves]: any = await connection.query(
        "SELECT DATE_FORMAT(fromDate, '%Y-%m-%d') AS firstDay, " +
        "DATE_FORMAT(toDate, '%Y-%m-%d') AS lastDay, leaveType FROM leaves " +
        "WHERE userId = ? AND status = 'Y' AND leaveStatus = 'Approved' " +
        "AND fromDate <= ? AND toDate >= ?",
        [sal.employee_id, payEnd, eligibleFrom]);
      const [holidays]: any = await connection.query(
        "SELECT DATE_FORMAT(fromDate, '%Y-%m-%d') AS firstDay, " +
        "DATE_FORMAT(toDate, '%Y-%m-%d') AS lastDay FROM holidays " +
        "WHERE holidayStatus = 'Y' AND fromDate <= ? AND toDate >= ?",
        [payEnd, eligibleFrom]);
      const addPeriod = (first: string, last: string, value: number) => {
        const from = Math.max(Date.parse(first + "T00:00:00Z"), Date.parse(eligibleFrom + "T00:00:00Z"));
        const until = Math.min(Date.parse(last + "T00:00:00Z"), Date.parse(payEnd + "T00:00:00Z"));
        for (let stamp = from; stamp <= until; stamp += 86400000) {
          const day = new Date(stamp).toISOString().slice(0, 10);
          paid.set(day, Math.max(paid.get(day) || 0, value));
        }
      };
      for (const leave of leaves) addPeriod(leave.firstDay, leave.lastDay,
        leave.leaveType === "HALF DAY" ? 0.5 : 1);
      for (const holiday of holidays) addPeriod(holiday.firstDay, holiday.lastDay, 1);
      let paidDays = 0;
      let grossRaw = 0;
      let scheduledBasicRaw = 0, scheduledAllowancesRaw = 0, scheduledGrossRaw = 0, workingDays = 0;
      let configIndex = 0;
      const fromStamp = Date.parse(eligibleFrom + "T00:00:00Z");
      const endStamp = Date.parse(payEnd + "T00:00:00Z");
      for (let stamp = fromStamp; stamp <= endStamp; stamp += 86400000) {
        const day = new Date(stamp).toISOString().slice(0, 10);
        while (configIndex + 1 < configs.length && configs[configIndex + 1].effective_from <= day)
          configIndex++;
        const config = configs[configIndex];
        const dailySalary = Number(config.total_salary);
        const basic = Number(config.salary_amount);
        const allowances = Number(config.emp_of_mon_allowance || 0) + Number(config.transport_allowance || 0) + Number(config.medical_allowance || 0);
        if (!Number.isFinite(dailySalary) || dailySalary < 0 || !Number.isFinite(basic) || !Number.isFinite(allowances))
          throw new Error("Invalid salary configuration " + config.id);
        const fraction = config.attendance_base === "Y" ? (paid.get(day) || 0) : 1;
        paidDays += fraction;
        workingDays++;
        scheduledBasicRaw += basic / days;
        scheduledAllowancesRaw += allowances / days;
        scheduledGrossRaw += dailySalary / days;
        grossRaw += dailySalary * fraction / days;
      }
      const gross = Math.round(grossRaw * 100) / 100;
      const scheduledBasic = Math.round(scheduledBasicRaw * 100) / 100;
      const scheduledAllowances = Math.round(scheduledAllowancesRaw * 100) / 100;
      const absenceDeduction = Math.max(0, Math.round((scheduledGrossRaw - grossRaw) * 100) / 100);      if (!Number.isFinite(gross) || gross < 0) throw new Error("Invalid salary configuration " + sal.id);
      const [loans]: any = await connection.query(
        "SELECT id, remainingAmount, deduction FROM loan WHERE employee_id = ? " +
        "AND applyDate <= ? AND remainingAmount > 0 ORDER BY id FOR UPDATE",
        [sal.employee_id, payEnd]);
      let net = gross;
      for (const loan of loans) {
        const installment = Number(loan.deduction), balance = Number(loan.remainingAmount);
        if (!Number.isFinite(installment) || !Number.isFinite(balance) || installment < 0 || balance < 0)
          throw new Error("Invalid loan " + loan.id);
        const amount = Math.round(Math.min(installment, balance, net) * 100) / 100;
        if (amount > 0) {
          await connection.query(
            "UPDATE loan SET return_amount = return_amount + ?, remainingAmount = remainingAmount - ? WHERE id = ?",
            [amount, amount, loan.id]);
          net = Math.round((net - amount) * 100) / 100;
        }
      }
      const loanDeduction = Math.round((gross - net) * 100) / 100;
      // Overtime is already credited by createOvertime; record it for the
      // report without adding it to this salary account entry again.
      const [overtime]: any = await connection.query(
        "SELECT COALESCE(SUM(overtime_amount), 0) AS amount, COALESCE(SUM(TIME_TO_SEC(time)) / 3600, 0) AS hours FROM overtime " +
        "WHERE employee_id = ? AND date BETWEEN ? AND ?",
        [sal.employee_id, eligibleFrom, payEnd]);
      const overtimeAmount = Number(overtime[0].amount);
      const overtimeHours = Number(overtime[0].hours);
      const loanBalanceAfter = Math.max(0, loans.reduce((sum: number, loan: any) => sum + Number(loan.remainingAmount), 0) - loanDeduction);
      if (!Number.isFinite(overtimeAmount) || overtimeAmount < 0)
        throw new Error("Invalid overtime for employee " + sal.employee_id);

      await connection.query(
        "INSERT INTO invoice_sequence (id, employee_acc_no) VALUES (1, 0) " +
        "ON DUPLICATE KEY UPDATE id = id");
      const [seq]: any = await connection.query("SELECT employee_acc_no FROM invoice_sequence WHERE id = 1 FOR UPDATE");
      const number = Number(seq[0].employee_acc_no ?? 0) + 1;
      await connection.query("UPDATE invoice_sequence SET employee_acc_no = ? WHERE id = 1", [number]);
      const [last]: any = await connection.query(
        "SELECT balance FROM employee_accounts WHERE employee_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [sal.employee_id]);
      await connection.query(
        "INSERT INTO employee_accounts (employee_id, debit, credit, refNo, invoiceNo, payment_date, payment_method, balance) " +
        "VALUES (?, ?, 0, ?, ?, NOW(), 'Cash', ?)",
        [sal.employee_id, net, "SALARY-" + month + "-" + year + "-" + sal.employee_id,
          "INV-" + String(number).padStart(4, "0"), Number(last[0]?.balance || 0) + net]);
      await connection.query(
        "INSERT INTO payroll_run_items " +
        "(calendar_session_id, employee_id, salary_config_id, paid_days, gross_salary, " +
        "loan_deduction, overtime_amount, net_salary, scheduled_basic, scheduled_allowances, " +
        "absence_deduction, working_days, overtime_hours, loan_balance_after) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [calendar[0].id, sal.employee_id, sal.id, paidDays, gross,
          loanDeduction, overtimeAmount, net, scheduledBasic, scheduledAllowances,
          absenceDeduction, workingDays, overtimeHours, loanBalanceAfter]);
      processedEmployees++;
    }
    if (!processedEmployees) throw new Error("No employees had eligible payroll days");
    const [cycleResult]: any = await connection.query(
      "INSERT INTO salarycycle (calendar_session_id, session_name, year, month, status, run_date) " +
      "VALUES (?, ?, ?, ?, 'Completed', NOW())", [calendar[0].id, calendar[0].session_name, year, month]);
    await connection.query("UPDATE calendarsession SET calendarStatus = 'Processing' WHERE id = ?", [calendar[0].id]);
    await connection.commit();
    res.json({ message: "Salary cycle run successfully", processedEmployees, salaryCycleId: cycleResult.insertId });
    if (cycleResult.insertId) void processPayrollDocuments(cycleResult.insertId, req.user?.id).catch(error =>
      console.error("Post-payroll document processing failed:", (error as Error).message));
  } catch (error) {
    await connection.rollback();
    console.error("Salary cycle failed:", error);
    res.status(500).json({ message: "Salary cycle failed; no payroll changes were saved" });
  } finally {
    connection.release();
  }
};

export const getPayrollReport = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query(
      "SELECT sc.year, sc.month, sc.status, ea.employee_id, u.name AS employee_name, " +
      "ea.refNo, pri.paid_days, pri.gross_salary, pri.loan_deduction, " +
      "pri.overtime_amount, COALESCE(pri.net_salary, ea.debit) AS net_salary, " +
      "COALESCE(pri.net_salary, ea.debit) + COALESCE(pri.overtime_amount, 0) AS total_compensation, " +
      "ea.payment_date AS run_date " +
      "FROM salarycycle sc JOIN employee_accounts ea " +
      "ON ea.refNo = CONCAT('SALARY-', sc.month, '-', sc.year, '-', ea.employee_id) " +
      "LEFT JOIN payroll_run_items pri ON pri.calendar_session_id = sc.calendar_session_id " +
      "AND pri.employee_id = ea.employee_id " +
      "LEFT JOIN tbl_users u ON u.id = ea.employee_id " +
      "ORDER BY CAST(sc.year AS UNSIGNED) DESC, FIELD(sc.month, 'December','November','October','September'," +
      "'August','July','June','May','April','March','February','January'), u.name"
    );
    res.json({ salaries: rows, total: (rows as any[]).length });
  } catch (error) {
    console.error("Payroll report failed:", error);
    res.status(500).json({ message: "Could not load payroll report" });
  }
};
