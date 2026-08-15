import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket } from "mysql2";

interface Login extends RowDataPacket {
  id: number;
  name: string;
  loginStatus: string;
  projectName: string;
}

interface EmployeeLifeLine {
  employee_id: number;
  employeeName: string;
  email: string;
  contact: string;
  position: string;
  date: string;
}

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<Login[]>(
      `SELECT 
         id,
         name,
         loginStatus,
         status
       FROM tbl_users
       WHERE status = 'Y'
       ORDER BY id DESC`,
    );

    const usersForDropdown = rows.map((user) => ({
      id: user.id,
      name: user.name,
      loginStatus: user.loginStatus,
      status: user.status,
    }));

    res.status(200).json({
      message: "Users fetched successfully",
      users: usersForDropdown,
    });
  } catch (error) {
    console.error("Get Users Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const addEmpll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employee_id, employeeName, email, contact, position, date } =
      req.body as EmployeeLifeLine;

    if (
      !employee_id ||
      !employeeName ||
      !email ||
      !contact ||
      !position ||
      !date
    ) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    const [userRows]: any = await pool.query(
      `SELECT date FROM tbl_users WHERE id = ?`,
      [employee_id],
    );

    if (!userRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(userRows[0].date);
    const lifelineDate = new Date(date);

    if (lifelineDate < joiningDate) {
      res.status(400).json({
        message: "Lifeline date cannot be before employee joining date",
      });
      return;
    }

    const [existingRows]: any = await pool.query(
      `SELECT id FROM employee_lifeline WHERE employee_id = ?`,
      [employee_id]
    );

    if (existingRows.length > 0) {
      res.status(400).json({ 
        message: "A lifeline record already exists for this employee." 
      });
      return;
    }

    const [result]: any = await pool.query(
      `INSERT INTO employee_lifeline 
        (employee_id, employee_name, email, contact, position, date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [employee_id, employeeName, email, contact, position, date],
    );

    const [rows]: any = await pool.query(
      `SELECT 
         id, 
         employee_name AS employeeName, 
         email,
         contact, 
         position, 
         date
       FROM employee_lifeline
       WHERE id = ?`,
      [result.insertId],
    );

    const newLifeLine = rows[0];

    res.status(201).json({
      message: "Employee LifeLine added successfully",
      newLifeLine,
    });
  } catch (error) {
    console.error("Add Employee LifeLine Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getEmpll = async (req: Request, res: Response): Promise<void> => {
  try {
    const [rows]: any = await pool.query(
      `SELECT 
         id, 
         employee_name AS employeeName,
         email, 
         contact, 
         position, 
         date
       FROM employee_lifeline 
       ORDER BY id DESC`,
    );

    const formattedRows = rows.map((row: any) => ({
      ...row,
      date: row.date,
    }));

    res.status(200).json({
      success: true,
      message: "Employee lifelines fetched successfully",
      data: formattedRows,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const updateEmpll = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { employeeName, contact, position, date } =
      req.body as EmployeeLifeLine;

    const formattedDate = date
      ? new Date(date).toLocaleDateString("sv-SE")
      : null;

    if (!employeeName || !contact || !position || !date) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    const [empRows]: any = await pool.query(
      `SELECT employee_id FROM employee_lifeline WHERE id = ?`,
      [id],
    );

    if (!empRows.length) {
      res.status(404).json({ message: "Employee LifeLine not found" });
      return;
    }

    const employee_id = empRows[0].employee_id;

    const [userRows]: any = await pool.query(
      `SELECT date FROM tbl_users WHERE id = ?`,
      [employee_id],
    );

    const joiningDate = new Date(userRows[0].date);
    const lifelineDate = new Date(date);

    if (lifelineDate < joiningDate) {
      res.status(400).json({
        message: "Lifeline date cannot be before employee joining date",
      });
      return;
    }

    const [result]: any = await pool.query(
      `UPDATE employee_lifeline
       SET employee_name = ?, contact = ?, position = ?, date = ?
       WHERE id = ?`,
      [employeeName, contact, position, formattedDate, id],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Employee LifeLine not found" });
      return;
    }

    const [rows]: any = await pool.query(
      `SELECT id, employee_name AS employeeName, contact, position, date
       FROM employee_lifeline
       WHERE id = ?`,
      [id],
    );

    const updatedLifeLine = rows[0];
    updatedLifeLine.date = updatedLifeLine.date
      ? new Date(updatedLifeLine.date).toLocaleDateString("sv-SE")
      : null;

    res.status(200).json({
      message: "Employee LifeLine updated successfully",
      updatedLifeLine,
    });
  } catch (error) {
    console.error("Update Employee LifeLine Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const deleteEmpll = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const [result]: any = await pool.query(
      `DELETE FROM employee_lifeline WHERE id = ?`,
      [id],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Employee LifeLine not found" });
      return;
    }

    res.status(200).json({ message: "Employee LifeLine deleted successfully" });
  } catch (error) {
    console.error("Delete Employee LifeLine Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
