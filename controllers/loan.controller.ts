import { Request, Response } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "../middleware/middleware";
import { nonCriticalNotification } from "../services/notificationEvents";
import { loanCreatedEvent } from "../services/loanNotificationEvents";

export const getAllLoans = async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        l.id,
        l.employee_id,
        u.name AS employee_name,
        u.contact,
        l.applyDate,
        l.refNo,
        l.loanAmount,
        l.deduction,
        l.remainingAmount,
        l.return_amount

      FROM loan l
      LEFT JOIN tbl_users u ON u.id = l.employee_id
      ORDER BY l.id ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch loans" });
  }
};

export const getMyLoans = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const employeeId = req.user?.id;
    if (!employeeId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const [rows] = await pool.query(
      `SELECT 
        l.id,
        l.employee_id,
        u.name AS employee_name,
        u.contact,
        l.applyDate,
        l.refNo,
        l.loanAmount,
        l.deduction,
        l.remainingAmount,
        l.return_amount
      FROM loan l
      LEFT JOIN tbl_users u ON u.id = l.employee_id
      WHERE l.employee_id = ?
      ORDER BY l.id DESC`,
      [employeeId],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch loans" });
  }
};

export const addLoan = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const { loanAmount, deduction, applyDate, employee_id } = req.body;

    const finalEmployeeId = employee_id;

    if (!finalEmployeeId || !loanAmount || !applyDate) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    if (!Number.isFinite(Number(loanAmount)) || Number(loanAmount) <= 0 ||
        !Number.isFinite(Number(deduction)) || Number(deduction) <= 0) {
      res.status(400).json({
        message: "Loan amount and installment must be positive numbers",
      });
      return;
    }

    const loanAmt = Number(loanAmount);
    const deductionAmt = Number(deduction || 0);

    if (deductionAmt > loanAmt) {
      res.status(400).json({
        message: "Deduction amount cannot be greater than loan amount",
      });
      return;
    }

    const refNo = Date.now();

    const [employeeRows]: any = await pool.query(
      `SELECT date FROM employee_lifeline WHERE employee_id = ?`,
      [finalEmployeeId],
    );

    if (!employeeRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(employeeRows[0].date);
    const loanApplyDate = new Date(applyDate);
    if (Number.isNaN(loanApplyDate.getTime())) {
      res.status(400).json({ message: "Valid loan date is required" }); return;
    }

    if (loanApplyDate < joiningDate) {
      res.status(400).json({
        message: "Loan apply date cannot be before employee joining date",
      });
      return;
    }

    const remainingAmount = loanAmount;
    const return_amount = 0;

    const [created]: any = await pool.query(
      `INSERT INTO loan
      (employee_id, applyDate, refNo, loanAmount, deduction, remainingAmount)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        finalEmployeeId,
        applyDate,
        refNo,
        loanAmount,
        deduction,
        remainingAmount,
      ],
    );

    await nonCriticalNotification(() => loanCreatedEvent(Number(created.insertId), Number(finalEmployeeId), loanAmt, deductionAmt));
    res.status(201).json({ message: "Loan added successfully" });
  } catch (error) {
    console.error("Add loan error:", error);
    res.status(500).json({ message: "Server error" });
  }
};



export const updateLoan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id=Number(req.params.id), amount=Number(req.body.loanAmount), installment=Number(req.body.deduction);
  const applyDate=String(req.body.applyDate || "");
  if(!Number.isSafeInteger(id)||id<1||!Number.isFinite(amount)||amount<=0||!Number.isFinite(installment)||installment<=0||installment>amount||!/^\d{4}-\d{2}-\d{2}$/.test(applyDate)){
    res.status(400).json({message:"Enter a valid date, loan amount, and installment"});return;
  }
  try{
    const [rows]:any=await pool.query("SELECT employee_id,loanAmount,remainingAmount,return_amount FROM loan WHERE id=?",[id]);
    if(!rows.length){res.status(404).json({message:"Loan not found"});return;}
    const loan=rows[0];
    if(Number(loan.return_amount)>0||Number(loan.remainingAmount)<Number(loan.loanAmount)){
      res.status(409).json({message:"A loan with repayments cannot be edited"});return;
    }
    const [joined]:any=await pool.query("SELECT MIN(date) AS joined FROM employee_lifeline WHERE employee_id=?",[loan.employee_id]);
    if(joined[0]?.joined && new Date(applyDate)<new Date(joined[0].joined)){
      res.status(400).json({message:"Loan date cannot precede employee joining date"});return;
    }
    const [result]:any=await pool.query("UPDATE loan SET applyDate=?,loanAmount=?,deduction=?,remainingAmount=? WHERE id=? AND return_amount=0 AND remainingAmount=loanAmount",[applyDate,amount,installment,amount,id]);
    if(!result.affectedRows){res.status(409).json({message:"Loan changed while editing; refresh and try again"});return;}
    res.json({message:"Loan updated"});
  }catch(error){console.error("Update loan error:",error);res.status(500).json({message:"Could not update loan"});}
};
export const deleteLoan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1){res.status(400).json({message:"Invalid loan"});return;}
  try{
    const [result]:any=await pool.query("DELETE FROM loan WHERE id=? AND return_amount=0 AND remainingAmount=loanAmount",[id]);
    if(!result.affectedRows){res.status(409).json({message:"Loan was not found or already has repayments"});return;}
    res.json({message:"Loan deleted"});
  }catch(error){console.error("Delete loan error:",error);res.status(500).json({message:"Could not delete loan"});}
};
