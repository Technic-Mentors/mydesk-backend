import { Request, Response } from "express";
import pool from "../database/db";

export const getPayments = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
  SELECT 
    p.id,
    p.customerId,
    c.customerName,
    p.amount,
    p.paymentStatus,
    p.paymentMethod,
    p.description,
    p.date
  FROM payments p
  LEFT JOIN customers c ON c.id = p.customerId
  WHERE p.paymentStatus = 'Y'
  ORDER BY p.id ASC
`);

    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch payments" });
  }
};

export const addPayment = async (req: Request, res: Response) => {
  try {
    const { paymentMethod, customerId, description, amount, date } = req.body;

    const formattedDate = date ? date.split("T")[0] : null;

    await pool.query(
      `INSERT INTO payments 
       (paymentMethod, customerId, description, amount, date)
       VALUES (?, ?, ?, ?, ?)`,
      [paymentMethod, customerId, description, amount, formattedDate],
    );

    res.status(201).json({ message: "Payment added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add payment" });
  }
};

export const updatePayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { paymentMethod, customerId, description, amount, date } = req.body;

    const formattedDate = date ? date.split("T")[0] : null;

    await pool.query(
      `UPDATE payments 
       SET paymentMethod = ?, customerId = ?, description = ?, amount = ?, date = ?
       WHERE id = ?`,
      [paymentMethod, customerId, description, amount, formattedDate, id],
    );

    res.status(200).json({ message: "Payment updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update payment" });
  }
};

export const deletePayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await pool.query(`UPDATE payments SET paymentStatus = 'N' WHERE id = ?`, [
      id,
    ]);

    res.status(200).json({ message: "Payment deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete payment" });
  }
};
