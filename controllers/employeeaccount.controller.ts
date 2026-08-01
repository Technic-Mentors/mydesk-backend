import { Request, Response } from "express";
import pool from "../database/db";

const generateRefNo = async (): Promise<string> => {
  try {
    const [rows]: any = await pool.query(
      `SELECT id FROM employee_accounts ORDER BY id ASC LIMIT 1`,
    );
    const nextId = rows.length ? rows[0].id + 1 : 1;
    return `REF-${Date.now()}`;
  } catch (error) {
    console.error("Error generating refNo:", error);
    return `REF-${Date.now()}`;
  }
};

// Add Employee Account
export const addEmployeeAccount = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { employee_id, payment_type, amount, payment_method, payment_date, refNo } =
    req.body;

  if (!employee_id || !payment_type || Number(amount) <= 0) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

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
    } else {
      await connection.query(
        `INSERT INTO invoice_sequence (id, employee_acc_no) VALUES (1, 0)`,
      );
    }

    const formattedInvoice = `INV-${String(nextNumber).padStart(4, "0")}`;
    const [last]: any = await connection.query(
      `SELECT balance FROM employee_accounts 
       WHERE employee_id = ? 
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [employee_id],
    );

    const debit = payment_type === "debit" ? Number(amount) : 0;
    const credit = payment_type === "credit" ? Number(amount) : 0;
    const previousBalance = last.length ? Number(last[0].balance) : 0;
    const currentBalance = previousBalance + debit - credit;

    const finalRefNo = refNo || `REF-${Date.now()}`;

    await connection.query(
      `INSERT INTO employee_accounts 
      (employee_id, refNo, invoiceNo, payment_date, debit, credit, balance, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        finalRefNo,
        formattedInvoice,
        payment_date,
        debit,
        credit,
        currentBalance,
        payment_method,
      ],
    );

    await connection.commit();
    res
      .status(201)
      .json({ 
        success: true,
        message: "Employee account entry added successfully",
        data: {
          invoiceNo: formattedInvoice,
          refNo: finalRefNo,
          balance: currentBalance
        }
      });
  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error("Add Employee Account Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Get Employee Account (Admin)
export const getEmployeeAccount = async (req: Request, res: Response) => {
  try {
    const { employee_id } = req.params;

    if (!employee_id) {
      res.status(400).json({ message: "Employee ID is required" });
      return;
    }

    // Get employee details with salary and image
    const [employeeRows]: any = await pool.query(
      `SELECT id, name, email, contact, salary, cnic, address, role, image
       FROM tbl_users 
       WHERE id = ? AND role = 'employee'`,
      [employee_id]
    );

    if (employeeRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const employee = employeeRows[0];
    const currentSalary = Number(employee.salary) || 0;

    // Get all account transactions for this employee
    const [rows]: any = await pool.query(
      `SELECT id, refNo, invoiceNo, debit, credit, payment_method, payment_date, balance
       FROM employee_accounts
       WHERE employee_id = ?
       ORDER BY payment_date ASC, id ASC`,
      [employee_id],
    );

    // Calculate previous month's balance
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    // Get previous month's first and last day
    const prevMonthFirstDay = new Date(currentYear, currentMonth - 1, 1);
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0);
    
    const prevMonthStart = prevMonthFirstDay.toISOString().split('T')[0];
    const prevMonthEnd = prevMonthLastDay.toISOString().split('T')[0];

    // Get all transactions up to previous month end
    const [prevMonthTransactions]: any = await pool.query(
      `SELECT debit, credit 
       FROM employee_accounts 
       WHERE employee_id = ? 
       AND payment_date <= ?`,
      [employee_id, prevMonthEnd]
    );

    // Calculate previous balance (sum of all transactions up to previous month)
    let previousBalance = 0;
    prevMonthTransactions.forEach((txn: any) => {
      previousBalance += Number(txn.debit) - Number(txn.credit);
    });

    // Get previous month's salary (assuming it's stored as credit with refNo containing 'SALARY')
    const [prevMonthSalaryRows]: any = await pool.query(
      `SELECT SUM(credit) as total_salary 
       FROM employee_accounts 
       WHERE employee_id = ? 
       AND payment_date BETWEEN ? AND ?
       AND refNo LIKE '%SALARY%'`,
      [employee_id, prevMonthStart, prevMonthEnd]
    );

    const previousMonthSalary = Number(prevMonthSalaryRows[0]?.total_salary) || 0;

    // Calculate current balance
    let currentBalance = 0;
    rows.forEach((txn: any) => {
      currentBalance += Number(txn.debit) - Number(txn.credit);
    });

    // Calculate net payable (current salary + previous balance)
    const payableAmount = currentSalary + previousBalance;

    // Format the transactions with running balance
    let runningBalance = 0;
    const formatted = rows.map((row: any) => {
      const netBalance = runningBalance + Number(row.debit) - Number(row.credit);
      const result = {
        id: row.id,
        refNo: row.refNo,
        invoiceNo: row.invoiceNo,
        debit: Number(row.debit),
        credit: Number(row.credit),
        payment_method: row.payment_method,
        payment_date: row.payment_date,
        balance: Number(row.balance),
        previous_balance: runningBalance,
        net_balance: netBalance,
      };
      runningBalance = netBalance;
      return result;
    });

    res.json({
      success: true,
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        contact: employee.contact || 'N/A',
        cnic: employee.cnic || 'N/A',
        address: employee.address || 'N/A',
        image: employee.image || null,
        currentSalary: currentSalary,
        previousMonthSalary: previousMonthSalary,
        previousBalance: previousBalance,
        currentBalance: currentBalance,
        payableAmount: payableAmount
      },
      accounts: formatted
    });
  } catch (error: any) {
    console.error("Get Employee Account Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Employee Account (User)
export const getEmployeeAccountForUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employee_id = user.id;

    // Get employee details with salary and image
    const [employeeRows]: any = await pool.query(
      `SELECT id, name, email, contact, salary, cnic, address, role, image
       FROM tbl_users 
       WHERE id = ?`,
      [employee_id]
    );

    if (employeeRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const employee = employeeRows[0];
    const currentSalary = Number(employee.salary) || 0;

    // Get all account transactions
    const [rows]: any = await pool.query(
      `SELECT id, refNo, invoiceNo, debit, credit, payment_method, payment_date, balance
       FROM employee_accounts
       WHERE employee_id = ?
       ORDER BY payment_date ASC, id ASC`,
      [employee_id],
    );

    // Calculate previous month's balance
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0);
    const prevMonthEnd = prevMonthLastDay.toISOString().split('T')[0];

    const [prevMonthTransactions]: any = await pool.query(
      `SELECT debit, credit 
       FROM employee_accounts 
       WHERE employee_id = ? 
       AND payment_date <= ?`,
      [employee_id, prevMonthEnd]
    );

    let previousBalance = 0;
    prevMonthTransactions.forEach((txn: any) => {
      previousBalance += Number(txn.debit) - Number(txn.credit);
    });

    // Calculate current balance
    let currentBalance = 0;
    rows.forEach((txn: any) => {
      currentBalance += Number(txn.debit) - Number(txn.credit);
    });

    // Calculate payable amount
    const payableAmount = currentSalary + previousBalance;

    // Format transactions
    let runningBalance = 0;
    const formatted = rows.map((row: any) => {
      const netBalance = runningBalance + Number(row.debit) - Number(row.credit);
      const result = {
        id: row.id,
        refNo: row.refNo,
        invoiceNo: row.invoiceNo,
        debit: Number(row.debit),
        credit: Number(row.credit),
        payment_method: row.payment_method,
        payment_date: row.payment_date,
        balance: Number(row.balance),
        previous_balance: runningBalance,
        net_balance: netBalance,
      };
      runningBalance = netBalance;
      return result;
    });

    res.json({
      success: true,
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        contact: employee.contact || 'N/A',
        cnic: employee.cnic || 'N/A',
        address: employee.address || 'N/A',
        image: employee.image || null,
        currentSalary: currentSalary,
        previousMonthSalary: 0,
        previousBalance: previousBalance,
        currentBalance: currentBalance,
        payableAmount: payableAmount
      },
      accounts: formatted
    });
  } catch (error: any) {
    console.error(
      "Get Employee Account For User Error:",
      error.message || error,
    );
    res.status(500).json({ message: "Server error" });
  }
};

// Get All Employees Accounts (Admin Dashboard)
export const getAllEmployeesAccounts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // Get all employees with their salary and account summary
    const [employees]: any = await pool.query(
      `SELECT u.id, u.name, u.email, u.contact, u.salary, u.role, u.image,
              COALESCE(SUM(ea.debit), 0) as total_debit,
              COALESCE(SUM(ea.credit), 0) as total_credit
       FROM tbl_users u
       LEFT JOIN employee_accounts ea ON u.id = ea.employee_id
       WHERE u.role = 'employee'
       GROUP BY u.id
       ORDER BY u.name ASC`
    );

    const accountsSummary = employees.map((emp: any) => ({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      contact: emp.contact || 'N/A',
      image: emp.image || null,
      salary: Number(emp.salary) || 0,
      total_debit: Number(emp.total_debit) || 0,
      total_credit: Number(emp.total_credit) || 0,
      balance: (Number(emp.total_debit) || 0) - (Number(emp.total_credit) || 0)
    }));

    res.json({ 
      success: true,
      employees: accountsSummary 
    });
  } catch (error: any) {
    console.error("Get All Employee Accounts Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};