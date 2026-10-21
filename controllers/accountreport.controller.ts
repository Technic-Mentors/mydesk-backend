import { Request, Response } from "express";
import pool from "../database/db";

export const getAccountReport = async (req: Request, res: Response) => {
  try {
    const [employeeAccounts]: any = await pool.query(`
      SELECT 
  ea.id,
  ea.employee_id AS ownerId,
  'Employee' AS account_type,
  COALESCE(NULLIF(u.name, ''), CONCAT('Employee #', ea.employee_id)) AS name,
  ea.refNo,
  ea.invoiceNo,
  ea.debit,
  ea.credit,
  ea.payment_method AS paymentMethod,
  ea.payment_date AS paymentDate
FROM employee_accounts ea
LEFT JOIN tbl_users u ON u.id = ea.employee_id
ORDER BY ea.payment_date ASC, ea.id ASC
    `);

    const [customerAccounts]: any = await pool.query(`
      SELECT 
        ca.id,
        'Customer' AS account_type,
        c.customerName AS name,
        ca.refNo,
        ca.invoiceNo,
        ca.debit,
        ca.credit,
        ca.paymentMethod,
        ca.paymentDate
      FROM customer_accounts ca
      JOIN customers c ON c.id = ca.customerId
      ORDER BY ca.paymentDate ASC
    `);

    const [supplierAccounts]: any = await pool.query(`
      SELECT 
        sa.id,
        'Supplier' AS account_type,
        s.supplierName AS name,
        sa.refNo,
        sa.invoiceNo,
        sa.debit,
        sa.credit,
        sa.paymentMethod,
        sa.paymentDate
      FROM supplier_accounts sa
      JOIN suppliers s ON s.supplierId = sa.supplierId
      ORDER BY sa.paymentDate ASC
    `);

    const report = [
      ...employeeAccounts,
      ...customerAccounts,
      ...supplierAccounts,
    ];

    report.sort(
      (a, b) =>
        new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime(),
    );

    await pool.query("DELETE FROM accounts_ledger");

    let runningBalance = 0;

    if (report.length > 0) {
      const values = report.map((entry) => {
        runningBalance +=
          (Number(entry.debit) || 0) - (Number(entry.credit) || 0);
        return [
          entry.account_type,
          entry.id,
          entry.debit || 0,
          entry.credit || 0,
          runningBalance,
          entry.invoiceNo,
          entry.refNo,
          entry.paymentMethod,
          entry.paymentDate,
          new Date(), // createdAt
          new Date(), // updatedAt
        ];
      });

      await pool.query(
        `INSERT INTO accounts_ledger 
        (account_type, account_id, debit, credit, balance, invoiceNo, refNo, paymentMethod, paymentDate, createdAt, updatedAt) 
        VALUES ?`,
        [values],
      );
    }

    res.json({
      success: true,
      message: "Ledger table rebuilt successfully",
      report,
    });
  } catch (error: any) {
    console.error("Account Report Error:", error);
    res.status(500).json({ message: "Failed to generate account report" });
  }
};
