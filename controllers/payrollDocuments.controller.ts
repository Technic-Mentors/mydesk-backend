import { Response } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "../middleware/middleware";
import { hasPermission, MODULE } from "../permissionModel";
import { processPayrollDocuments, resendEmployeePayslip, resendAdminPayrollSummary } from "../services/payrollDocuments";
const allowed = (req: AuthenticatedRequest) => hasPermission(req.user, MODULE.Payroll);
const idValue = (v: unknown) => { const n=Number(v); return Number.isSafeInteger(n)&&n>0?n:0; };

export async function listPayrollDocuments(req: AuthenticatedRequest,res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({message:"Sign in required"}); return; }
  try {
    const admin=allowed(req);
    const cycle=idValue(req.query.cycleId);
    const where=admin?"1=1":"pd.employee_id=?";
    const params:any[]=admin?[]:[req.user.id];
    if (cycle) params.push(cycle);
    const [rows]:any=await pool.query(`SELECT pd.id,pd.salary_cycle_id,pd.employee_id,pd.document_key,pd.generated_at,pd.email_status,pd.email_sent_at,pd.email_error,
      sc.year,sc.month,u.name AS employee_name,
      0 AS available
      FROM payroll_documents pd JOIN salarycycle sc ON sc.id=pd.salary_cycle_id
      LEFT JOIN tbl_users u ON u.id=pd.employee_id WHERE ${where} ${cycle?"AND pd.salary_cycle_id=?":""}
      ORDER BY sc.year DESC,sc.id DESC,pd.employee_id`,params);
    let adminDeliveries:any[]=[];
    if(admin){const [delivery]:any=await pool.query(`SELECT ad.salary_cycle_id,ad.recipient_id,ad.status,ad.sent_at,ad.error,u.name AS recipient_name
      FROM payroll_admin_deliveries ad JOIN tbl_users u ON u.id=ad.recipient_id ${cycle?"WHERE ad.salary_cycle_id=?":""} ORDER BY ad.salary_cycle_id DESC`,cycle?[cycle]:[]);adminDeliveries=delivery;}
    res.json({documents:rows,adminDeliveries});
  } catch(e){ console.error("Payroll document list failed:",(e as Error).message);res.status(500).json({message:"Could not load payroll documents"}); }
}
export async function retryPayrollDelivery(req: AuthenticatedRequest,res: Response): Promise<void> {
  if(!allowed(req)){res.status(403).json({message:"Forbidden"});return;}
  const id=idValue(req.params.id);if(!id){res.status(400).json({message:"Invalid salary cycle"});return;}
  try{
    const [rows]:any=await pool.query("SELECT id FROM salarycycle WHERE id=? AND status='Completed'",[id]);
    if(!rows.length){res.status(404).json({message:"Completed salary cycle not found"});return;}
    res.status(202).json({message:"Payroll document and failed delivery retry started"});
    void processPayrollDocuments(id,req.user?.id,true).catch(e=>console.error("Payroll delivery retry failed:",(e as Error).message));
  }catch(e){console.error("Payroll retry failed:",(e as Error).message);res.status(500).json({message:"Could not start retry"});}
}


export async function resendPayslip(req: AuthenticatedRequest,res: Response): Promise<void> {
  if(!allowed(req)){res.status(403).json({message:"Forbidden"});return;}
  const id=idValue(req.params.id);if(!id){res.status(400).json({message:"Invalid payslip"});return;}
  try{
    const [docs]:any=await pool.query("SELECT email_status,employee_id FROM payroll_documents WHERE id=?",[id]);
    if(!docs.length||!docs[0].employee_id){res.status(404).json({message:"Payslip not ready"});return;}
    if(docs[0].email_status==='Sending'){res.status(409).json({message:"Email is already being sent"});return;}
    res.status(202).json({message:"Payslip resend started"});
    void resendEmployeePayslip(id).catch(e=>console.error("Manual payslip resend failed:",(e as Error).message));
  }catch(e){console.error("Payslip resend failed:",(e as Error).message);res.status(500).json({message:"Could not start resend"});}
}
export async function resendSummary(req: AuthenticatedRequest,res: Response): Promise<void> {
  if(!allowed(req)){res.status(403).json({message:"Forbidden"});return;}
  const id=idValue(req.params.id);if(!id){res.status(400).json({message:"Invalid salary cycle"});return;}
  try{
    const [docs]:any=await pool.query("SELECT id FROM payroll_documents WHERE salary_cycle_id=? AND document_key='summary'",[id]);
    if(!docs.length){res.status(404).json({message:"Summary PDF not ready"});return;}
    res.status(202).json({message:"Summary resend to your registered email started"});
    void resendAdminPayrollSummary(id,req.user!.id).catch(e=>console.error("Manual summary resend failed:",(e as Error).message));
  }catch(e){console.error("Summary resend failed:",(e as Error).message);res.status(500).json({message:"Could not start resend"});}
}
