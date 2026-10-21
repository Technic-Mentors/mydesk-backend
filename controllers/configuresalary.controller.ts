import { Request, Response } from "express";
import pool from "../database/db";

const validSalaryAmounts = (base: unknown, employeeAllowance: unknown, transport: unknown,
  medical: unknown, total: unknown): boolean => {
  const values = [base, employeeAllowance, transport, medical, total].map(Number);
  return values.every(Number.isFinite) && values[0] > 0 &&
    values.slice(1).every((value) => value >= 0) &&
    Math.abs(values[0] + values[1] + values[2] + values[3] - values[4]) < 0.01;
};
export const getSalaries = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
SELECT
  c.id,
  c.employee_id,
  u.name AS employee_name,
  c.salary_amount,
  c.emp_of_mon_allowance,
  c.transport_allowance,
  c.medical_allowance,
  c.total_salary,
  c.attendance_base,
  c.salary_month,
  c.description,
  c.config_date,
  c.effective_from,

  -- Loan Deduction (SAFE)
  COALESCE(l.total_loan_deduction, 0) AS total_loan_deduction,

  -- Total Days in Month
  DAY(LAST_DAY(COALESCE(c.config_date, CURRENT_DATE))) AS total_days,

  -- Present Days
  COALESCE(a.present_days, 0) AS present_days,

  -- Per Day Salary
  ROUND(
    c.total_salary / DAY(LAST_DAY(COALESCE(c.config_date, CURRENT_DATE)))
  ) AS per_day_salary,

  -- Attendance Salary
  ROUND(
    (c.total_salary / DAY(LAST_DAY(COALESCE(c.config_date, CURRENT_DATE))))
    * COALESCE(a.present_days, 0)
  ) AS attendance_salary,

  -- Effective Days
  (DATEDIFF(c.config_date, c.effective_from) + 1) AS effective_days,

  -- Net Salary
  ROUND(
    c.total_salary - COALESCE(l.total_loan_deduction, 0)
  ) AS net_salary

FROM configempsalaries c

LEFT JOIN tbl_users u
  ON c.employee_id = u.id

-- âœ… Attendance Aggregated Separately (FIX DUPLICATION)
LEFT JOIN (
  SELECT
    userId,
    MONTH(date) AS month,
    YEAR(date) AS year,
    COUNT(
      CASE
        WHEN attendanceStatus IN ('present','Late','Leave')
        THEN 1
      END
    ) AS present_days
  FROM attendance
  WHERE status = 'Y'
  GROUP BY userId, MONTH(date), YEAR(date)
) a
  ON a.userId = c.employee_id
  AND a.month = MONTH(c.effective_from)
  AND a.year = YEAR(c.effective_from)

-- âœ… Loan Aggregated Separately (SAFE CAST)
LEFT JOIN (
  SELECT
    employee_id,
    SUM(LEAST(CAST(IFNULL(deduction, 0) AS DECIMAL(10,2)), CAST(IFNULL(remainingAmount, 0) AS DECIMAL(10,2)))) AS total_loan_deduction
  FROM loan
  WHERE remainingAmount > 0 AND applyDate <= CURRENT_DATE()
  GROUP BY employee_id
) l
  ON l.employee_id = c.employee_id

WHERE c.status = 'ACTIVE'

ORDER BY c.config_date DESC
`);

    res.json({
      salaries: rows,
      total: (rows as any[]).length,
    });
  } catch (error: any) {
    console.error("FULL SQL ERROR:", error);
    res.status(500).json({
      message: "Error fetching salaries",
    });
  }
};

export const getSalaryById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM configempsalaries WHERE id = ? AND status='ACTIVE'`,
      [id],
    );

    if ((rows as any).length === 0) {
      res.status(404).json({ message: "Salary not found" }); return;
    }

    res.json((rows as any)[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching salary" });
  }
};

export const addSalary = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      employee_id,
      salary_amount,
      emp_of_mon_allowance = 0,
      transport_allowance = 0,
      medical_allowance = 0,
      total_salary,
      config_date,
      effective_from,
      attendance_base,
      salary_month,
      description = "",
    } = req.body;

    if (!Number.isInteger(Number(employee_id)) || Number(employee_id) <= 0 ||
        !/^\d{4}-\d{2}$/.test(String(salary_month || "")) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(config_date || "")) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(effective_from || "")) ||
        !validSalaryAmounts(salary_amount, emp_of_mon_allowance, transport_allowance,
          medical_allowance, total_salary)) {
      res.status(400).json({ message: "Valid employee, dates, and salary amounts are required; total must equal base plus allowances" });
      return;
    }
    const [existing]: any = await pool.query(
      `SELECT id FROM configempsalaries
   WHERE employee_id = ?
   AND salary_month = ?
   AND status = 'ACTIVE'`,
      [employee_id, salary_month],
    );

    if (existing.length > 0) {
      res.status(400).json({
        message:
          "Salary for this employee has already been configured for this month.",
      });
      return;
    }

    const [empRows]: any = await pool.query(
      `SELECT date FROM employee_lifeline WHERE employee_id = ?`,
      [employee_id],
    );

    if (empRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(empRows[0].date);
    const configDate = new Date(config_date);

    if (configDate < joiningDate) {
      res.status(400).json({
        message: "Cannot configure salary before employee joining date.",
      });
      return;
    }

    const configDateObj = new Date(config_date);
    const effectDateObj = new Date(effective_from);

    const year = configDateObj.getFullYear();
    const month = configDateObj.getMonth() + 1;

    const totalDaysInMonth = new Date(year, month, 0).getDate();

    const diffTime = configDateObj.getTime() - effectDateObj.getTime();
    const effectiveDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (effectiveDays <= 0) {
      res.status(400).json({
        message: "Effect date cannot be after config date",
      });

      return;
    }

    const perDaySalary = total_salary / totalDaysInMonth;
    const calculatedSalary = Math.round(perDaySalary * effectiveDays);

    const [result] = await pool.query(
      `INSERT INTO configempsalaries
       (employee_id, salary_amount, emp_of_mon_allowance, transport_allowance, medical_allowance, total_salary,
       config_date , salary_month , effective_from, attendance_base , status , description)
       VALUES (?, ?, ?, ?, ?, ?, ? , ? , ? , ? , "ACTIVE" , ?)`,
      [
        employee_id,
        salary_amount,
        emp_of_mon_allowance,
        transport_allowance,
        medical_allowance,
        total_salary,
        config_date,
        salary_month,
        effective_from,
        attendance_base,
        description || "",
      ],
    );

    res
      .status(201)
      .json({ message: "Salary added", id: (result as any).insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding salary" });
  }
};

export const updateSalary = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      employee_id,
      salary_amount,
      emp_of_mon_allowance = 0,
      transport_allowance = 0,
      medical_allowance = 0,
      total_salary,
      config_date,
      salary_month,
      effective_from,
      attendance_base,
      description,
    } = req.body;

    if (!Number.isInteger(Number(employee_id)) || Number(employee_id) <= 0 ||
        !/^\d{4}-\d{2}$/.test(String(salary_month || "")) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(config_date || "")) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(effective_from || "")) ||
        !validSalaryAmounts(salary_amount, emp_of_mon_allowance, transport_allowance,
          medical_allowance, total_salary)) {
      res.status(400).json({ message: "Valid employee, dates, and salary amounts are required; total must equal base plus allowances" });
      return;
    }
    const [existing]: any = await pool.query(
      `SELECT id FROM configempsalaries
   WHERE employee_id = ?
   AND salary_month = ?
   AND status = 'ACTIVE'
   AND id != ?`,
      [employee_id, salary_month, id],
    );

    if (existing.length > 0) {
      res.status(400).json({
        message:
          "A configuration for this employee already exists in the selected month.",
      });
      return;
    }

    const [empRows]: any = await pool.query(
      `SELECT date FROM employee_lifeline WHERE employee_id = ?`,
      [employee_id],
    );

    if (empRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(empRows[0].date);
    const configDate = new Date(config_date);

    if (configDate < joiningDate) {
      res.status(400).json({
        message: "Cannot configure salary before employee joining date.",
      });
      return;
    }

    const configDateObj = new Date(config_date);
    const effectDateObj = new Date(effective_from);

    const year = configDateObj.getFullYear();
    const month = configDateObj.getMonth();

    const totalDaysInMonth = new Date(year, month, 0).getDate();

    const diffTime = configDateObj.getTime() - effectDateObj.getTime();
    const effectiveDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (effectiveDays <= 0) {
      res.status(400).json({
        message: "Effect date cannot be after config date",
      });

      return;
    }

    const perDaySalary = total_salary / totalDaysInMonth;
    const calculatedSalary = Math.round(perDaySalary * effectiveDays);

    if (effectDateObj.getMonth() !== configDateObj.getMonth()) {
      res.status(400).json({
        message: "Effect date must be within same month",
      });
      return;
    }

    await pool.query(
      `UPDATE configempsalaries
       SET salary_amount=?, emp_of_mon_allowance=?, transport_allowance=?, medical_allowance=?,
       total_salary=?, config_date=? , effective_from=? , salary_month=?, attendance_base=?, description=?
       WHERE id=?`,
      [
        salary_amount,
        emp_of_mon_allowance,
        transport_allowance,
        medical_allowance,
        total_salary,
        config_date,
        effective_from,
        salary_month,
        attendance_base,
        description,
        id,
      ],
    );

    res.json({ message: "Salary updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating salary" });
  }
};

export const deleteSalary = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE configempsalaries SET status='INACTIVE' WHERE id=?`,
      [id],
    );
    res.json({ message: "Salary deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting salary" });
  }
};
