import { Request, Response } from "express";
import pool from "../database/db";

export const getSales = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
      SELECT
  s.id AS id,
  s.invoiceNo,
  s.salesStatus,
  s.customerId,
  c.customerName,
  DATE_FORMAT(s.saleDate, '%Y-%m-%d') AS saleDate,
  si.projectId,
  p.projectName,
  si.QTY,
  si.UnitPrice
FROM sales s
INNER JOIN customers c ON c.id = s.customerId
INNER JOIN sale_items si ON si.saleId = s.id
INNER JOIN projects p ON p.id = si.projectId
WHERE s.salesStatus = 'Y'
ORDER BY s.id DESC;

    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch sales" });
  }
};

export const addSale = async (req: Request, res: Response): Promise<void> => {
  const connection = await pool.getConnection();

  try {
    const { customerId, saleDate, items } = req.body;

    if (!customerId || !saleDate || !items?.length) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    await connection.beginTransaction();

    // LOCK row
    const [rows]: any = await connection.query(
      `SELECT sale_number FROM invoice_sequence WHERE id = 1 FOR UPDATE`,
    );

    let currentNumber = rows?.[0]?.sale_number || 0;
    let nextNumber = currentNumber + 1;

    const formattedInvoice = `INV-${String(nextNumber).padStart(4, "0")}`;

    // ❗ No need duplicate check if UNIQUE constraint exists (recommended)

    // Insert sale
    const [saleResult]: any = await connection.query(
      `INSERT INTO sales (customerId, invoiceNo, saleDate, salesStatus)
   VALUES (?, ?, ?, 'Y')`,
      [customerId, formattedInvoice, saleDate],
    );

    const saleId = saleResult.insertId;

    // Insert items
    for (const item of items) {
      const { projectId, QTY, UnitPrice } = item;

      await connection.query(
        `INSERT INTO sale_items (saleId, projectId, QTY, UnitPrice)
     VALUES (?, ?, ?, ?)`,
        [saleId, projectId, QTY, UnitPrice],
      );
    }

    // ✅ NOW update sequence AFTER success
    if (rows.length > 0) {
      await connection.query(
        `UPDATE invoice_sequence SET sale_number = ? WHERE id = 1`,
        [nextNumber],
      );
    } else {
      await connection.query(
        `INSERT INTO invoice_sequence (id, sale_number) VALUES (1, ?)`,
        [nextNumber],
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Sale added successfully",
      invoiceNo: formattedInvoice,
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to add sale" });
  } finally {
    connection.release();
  }
};

export const deleteSale = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await pool.query(`UPDATE sales SET salesStatus = 'N' WHERE id = ?`, [id]);

    res.status(200).json({ message: "Sale deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete sale" });
  }
};
