import { Request, Response } from "express";
import pool from "../database/db";

export const runSalaryCycle = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { year, month } = req.body;

    // Get calendar session ID
    const [calendarSession]: any = await pool.query(
      `SELECT id, session_name FROM calendarsession WHERE year = ? AND month = ? AND calendarStatus = 'Active'`,
      [year, month]
    );

    if (calendarSession.length === 0) {
      res.status(400).json({ 
        message: `No active calendar session found for ${month} ${year}. Please activate the calendar session first.` 
      });
      return;
    }

    const calendarId = calendarSession[0].id;
    const sessionName = calendarSession[0].session_name;

    // Check if salary cycle already exists for this calendar session
    const [existing]: any = await pool.query(
      `SELECT id FROM salarycycle WHERE calendar_session_id = ?`,
      [calendarId]
    );

    if (existing.length > 0) {
      res.status(400).json({
        message: `Salary cycle has already been run for ${month} ${year}`,
      });
      return;
    }

    // Check if employee accounts already exist for this period
    const [existingAccounts]: any = await pool.query(
      `SELECT id FROM employee_accounts WHERE refNo LIKE ? LIMIT 1`,
      [`SALARY-${month}-${year}-%`],
    );

    if (existingAccounts.length > 0) {
      res.status(400).json({
        message: `Salary cycle has already been run for ${month} ${year}`,
      });
      return;
    }

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthIndex = monthNames.indexOf(month);
    const salaryDate = new Date(`${year}-${month}-01`);

    const [salaries]: any = await pool.query(
      `SELECT 
        c.id,
        c.employee_id,
        c.total_salary,
        c.attendance_base,
        c.config_date,
        c.effective_from,

        DAY(LAST_DAY(c.config_date)) AS total_days,

        COUNT(
          CASE 
            WHEN a.attendanceStatus IN ('present','Late')
            THEN 1
          END
        ) AS present_days,

        ROUND(c.total_salary / DAY(LAST_DAY(c.config_date))) AS per_day_salary,

        ROUND(
          (c.total_salary / DAY(LAST_DAY(c.config_date))) *
          COUNT(
            CASE 
              WHEN a.attendanceStatus IN ('present','Late')
              THEN 1
            END
          )
        ) AS attendance_salary,

        COALESCE(SUM(CAST(l.deduction AS DECIMAL(10,2))),0) AS total_loan_deduction

      FROM configempsalaries c

      LEFT JOIN attendance a
        ON a.userId = c.employee_id
        AND MONTH(a.date) = MONTH(c.config_date)
        AND YEAR(a.date) = YEAR(c.config_date)
        AND a.status = 'Y'

      LEFT JOIN loan l
        ON l.employee_id = c.employee_id
        AND l.remainingAmount > 0

      WHERE c.status='ACTIVE'
      AND c.effective_from <= LAST_DAY(?)

      GROUP BY
        c.id,
        c.employee_id,
        c.total_salary,
        c.config_date,
        c.effective_from,
        c.attendance_base`,
      [salaryDate],
    );

    if (salaries.length === 0) {
      res.status(400).json({ message: "No active salaries to run" });
      return;
    }

    for (const sal of salaries) {
      let salaryAmount = 0;

      if (sal.attendance_base === "Y") {
        salaryAmount = sal.attendance_salary;
      } else {
        salaryAmount = sal.total_salary;
      }

      const debit = Number(salaryAmount - sal.total_loan_deduction);

      if (isNaN(debit) || debit < 0) continue;

      // Update loan return amounts if needed
      if (sal.total_loan_deduction > 0) {
        const [activeLoans]: any = await pool.query(
          `SELECT id, remainingAmount, deduction 
           FROM loan 
           WHERE employee_id = ? AND remainingAmount > 0`,
          [sal.employee_id],
        );

        for (const loan of activeLoans) {
          const deductNow = Math.min(loan.deduction, loan.remainingAmount);
          await pool.query(
            `UPDATE loan SET return_amount = return_amount + ?, remainingAmount = remainingAmount - ? WHERE id = ?`,
            [deductNow, deductNow, loan.id],
          );
        }
      }

      const [last]: any = await pool.query(
        `SELECT balance FROM employee_accounts WHERE employee_id=? ORDER BY id ASC LIMIT 1`,
        [sal.employee_id],
      );

      const previousBalance = last.length ? Number(last[0].balance) : 0;
      const credit = 0;
      const currentBalance = previousBalance + debit - credit;
      const refNo = `SALARY-${month}-${year}-${sal.employee_id}`;

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [rows]: any = await connection.query(
          `SELECT employee_acc_no FROM invoice_sequence WHERE id = 1 FOR UPDATE`,
        );

        let nextNumber = 1;
        if (rows.length > 0) {
          nextNumber = rows[0].employee_acc_no + 1;
          await connection.query(
            `UPDATE invoice_sequence SET employee_acc_no = ? WHERE id = 1`,
            [nextNumber],
          );
        }

        const formattedInvoice = `INV-${String(nextNumber).padStart(4, "0")}`;

        await connection.query(
          `INSERT INTO employee_accounts 
            (employee_id, debit, credit, refNo, invoiceNo, payment_date, payment_method, balance) 
            VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
          [
            sal.employee_id,
            debit,
            credit,
            refNo,
            formattedInvoice,
            "Cash",
            currentBalance,
          ],
        );

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }

    // ✅ Insert into salarycycle with 'Processing' status
    await pool.query(
      `INSERT INTO salarycycle 
        (calendar_session_id, session_name, year, month, status, run_date) 
        VALUES (?, ?, ?, ?, 'Processing', NOW())`,
      [calendarId, sessionName, year, month]
    );

    // ✅ Update calendar session status to 'Processing'
    await pool.query(
      `UPDATE calendarsession SET calendarStatus = 'Processing' WHERE id = ?`,
      [calendarId]
    );

    res.json({ 
      message: "Salary cycle run successfully",
      processedEmployees: salaries.length 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error running salary cycle" });
  }
};