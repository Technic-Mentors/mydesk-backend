import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import pool from "../database/db";
import { MODULE } from "../permissionModel";
import { adminRecipients, notifyUser } from "./notificationService";
import { sendAttachmentEmail } from "./emailService";
import { nonCriticalNotification } from "./notificationEvents";
import { loanDeductedEvent } from "./loanNotificationEvents";

type Cycle = { id: number; calendar_session_id: number; year: number; month: string; session_name: string; run_date: Date };
type PayrollRow = { employee_id: number; name: string; email: string; department: string | null; designation: string | null; joined: Date | null; employment_status: string; paid_days: number; working_days: number | null; scheduled_basic: number | null; scheduled_allowances: number | null; absence_deduction: number | null; gross_salary: number; loan_deduction: number; loan_balance_after: number | null; overtime_amount: number; overtime_hours: number | null; net_salary: number; payment_date: Date | null; payment_method: string | null; configured_basic: number | null; configured_allowances: number | null };
type Brand = { name: string; address: string; email: string; contact: string; logo: string | null };
const active = new Set<number>();
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const money = (v: unknown) => "Rs " + Number(v || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (v: number) => Math.round(v * 100) / 100;
const date = (v: unknown) => v ? new Date(v as any).toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Karachi"}) : "-";
const period = (c: Cycle) => `${c.month} ${c.year}`;
const employeeUrl = (c: Cycle) => `/user/salarydetail?cycleId=${c.id}`;
const adminUrl = (c: Cycle) => `/payroll?tab=SALARY_CYCLE&documents=${c.id}`;
const logoPath = path.resolve(__dirname, "../../../FrontEnd/oms-frontend/src/assets/mydesk_logo.png");
const mydeskLogo = fs.existsSync(logoPath) ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}` : "";
const numberWords = (amount: number) => {
  const ones = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  const small = (n: number): string => n < 20 ? ones[n] : n < 100 ? `${tens[Math.floor(n/10)]} ${ones[n%10]}`.trim() : `${ones[Math.floor(n/100)]} hundred ${small(n%100)}`.trim();
  const whole = Math.floor(Math.abs(amount));
  if (whole > 999999999) return money(amount);
  const parts: string[] = [];
  for (const [unit,label] of [[10000000,"crore"],[100000,"lakh"],[1000,"thousand"]] as const) {
    const n = Math.floor((whole % (unit * 100)) / unit);
    if (n) parts.push(small(n) + " " + label);
  }
  const rest = whole % 1000; if (rest) parts.push(small(rest));
  const paisa = Math.round((Math.abs(amount) - whole) * 100);
  return `${parts.join(" ") || "zero"} rupees${paisa ? ` and ${small(paisa)} paisa` : ""} only`.replace(/^./, c => c.toUpperCase());
};

async function browserPath(): Promise<string> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform !== "win32") return chromium.executablePath();
  const paths = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  ];
  const found = paths.find(fs.existsSync); if (!found) throw new Error("Chrome or Edge is required for payroll PDFs"); return found;
}
function frame(title: string, brand: Brand, inner: string): string {
  const safeLogo = brand.logo && /^https:\/\/res\.cloudinary\.com\//i.test(brand.logo) ? `<img class="company-logo" src="${esc(brand.logo)}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:9mm 11mm}*{box-sizing:border-box}body{margin:0;color:#20304c;font-family:Arial,sans-serif;font-size:10px;line-height:1.25}
    .watermark{position:fixed;top:47%;left:10%;transform:rotate(-25deg);font-size:52px;color:rgba(37,88,213,.055);font-weight:800;white-space:nowrap;z-index:-1}
    header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #2467d4;padding-bottom:6px;margin-bottom:8px}.brand{display:flex;align-items:center;gap:12px}.brand img{max-width:100px;max-height:48px;object-fit:contain}.brand strong{font-size:20px;color:#1748a5}.contact{text-align:right;font-size:9px;color:#65738b;max-width:250px}
    h1{font-size:18px;color:#153f8c;margin:0 0 5px}h2{font-size:13px;color:#1f55b5;margin:8px 0 4px;border-bottom:1px solid #dbe4f4;padding-bottom:5px}.sub{color:#66748d;margin-bottom:7px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px}.kv{padding:3px 0;border-bottom:1px solid #e8edf5}.kv span{color:#6b7890}.kv b{float:right;font-weight:600}.card{background:#f4f7fc;border:1px solid #e0e8f6;border-radius:8px;padding:6px 9px;margin:5px 0}
    table{width:100%;border-collapse:collapse;margin:3px 0 6px}th{background:#2158bd;color:white;text-align:left}th,td{padding:4px 7px;border-bottom:1px solid #e1e8f2}td.num,th.num{text-align:right;white-space:nowrap}tr{break-inside:avoid}thead{display:table-header-group}.net{background:#e8f2ff;border-left:5px solid #2467d4;padding:8px 11px;display:flex;justify-content:space-between;font-size:17px;font-weight:bold;color:#143c82}.words{font-size:10px;color:#5b6b82;margin:5px 0}.foot{margin-top:10px;border-top:1px solid #d9e2ef;padding-top:9px;font-size:9px;color:#74839a;text-align:center}
    .summary-table{font-size:8.5px}.summary-table th,.summary-table td{padding:6px 5px}.summary-table th{background:#2158bd}.summary-table td{overflow-wrap:anywhere}.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric{background:#f1f6ff;border-radius:7px;padding:10px}.metric strong{display:block;color:#1748a5;font-size:14px}
  </style></head><body><div class="watermark">${esc(brand.name || "MyDesk")}</div><header><div class="brand">${safeLogo + (mydeskLogo ? `<img src="${mydeskLogo}">` : "")}<strong>${esc(brand.name || "MyDesk")}</strong></div><div class="contact">${esc(brand.address)}<br>${esc(brand.email)} ${esc(brand.contact)}</div></header>${inner}<div class="foot">${esc(title)} - Generated by MyDesk - Technic Mentors - Confidential</div></body></html>`;
}
export function payslipHtml(c: Cycle, r: PayrollRow, brand: Brand): string {
  const breakdown = r.scheduled_basic != null && r.scheduled_allowances != null && r.absence_deduction != null;
  const configuredTotal = Number(r.configured_basic || 0) + Number(r.configured_allowances || 0);
  const basicEarned = breakdown ? round(Number(r.scheduled_basic) - Number(r.absence_deduction) * Number(r.scheduled_basic) / Math.max(1, Number(r.scheduled_basic) + Number(r.scheduled_allowances))) : configuredTotal > 0 ? round(Number(r.gross_salary) * Number(r.configured_basic) / configuredTotal) : null;
  const allowancesEarned = basicEarned == null ? null : round(Number(r.gross_salary) - basicEarned);
  const absence = Number(r.absence_deduction || 0);
  const net = Number(r.net_salary);
  const slip = `PAY-${c.year}-${String(["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(c.month)+1).padStart(2,"0")}-${String(r.employee_id).padStart(4,"0")}`;
  return frame("Salary Payslip", brand, `<h1>Salary Payslip</h1><div class="sub">Payroll Period: ${esc(period(c))} &nbsp;-&nbsp; Payslip No: ${slip} &nbsp;-&nbsp; Generated: ${date(new Date())}</div>
    <div class="grid"><div class="kv"><span>Employee</span><b>${esc(r.name)}</b></div><div class="kv"><span>Employee ID</span><b>${r.employee_id}</b></div><div class="kv"><span>Department</span><b>${esc(r.department || "-")}</b></div><div class="kv"><span>Designation</span><b>${esc(r.designation || "-")}</b></div><div class="kv"><span>Joined</span><b>${date(r.joined)}</b></div><div class="kv"><span>Employment status</span><b>${esc(r.employment_status)}</b></div></div>
    <h2>Attendance summary</h2><div class="card">Paid days: ${esc(r.paid_days)}${r.working_days != null ? ` | Eligible calendar days: ${esc(r.working_days)}` : ""}${r.overtime_hours != null ? ` | Overtime hours: ${esc(r.overtime_hours)}` : ""}</div>
    <h2>Earnings</h2><table><tbody>${basicEarned != null ? `<tr><td>Basic salary earned</td><td class="num">${money(basicEarned)}</td></tr><tr><td>Allowances earned</td><td class="num">${money(allowancesEarned)}</td></tr>` : ""}<tr><td><b>Gross salary after attendance</b></td><td class="num"><b>${money(r.gross_salary)}</b></td></tr><tr><td>Overtime credited</td><td class="num">${money(r.overtime_amount)}</td></tr></tbody></table>
    <h2>Deductions</h2><table><tbody>${breakdown ? `<tr><td>Absence adjustment (included above)</td><td class="num">${money(absence)}</td></tr>` : ""}<tr><td>Loan installment</td><td class="num">${money(r.loan_deduction)}</td></tr></tbody></table>
    <div class="net"><span>Net Salary Payable</span><span>${money(net)}</span></div><div class="words">Amount in words: ${esc(numberWords(net))}</div>
    ${Number(r.loan_deduction) > 0 ? `<h2>Loan</h2><div class="card">Deducted: ${money(r.loan_deduction)} &nbsp; - &nbsp; Remaining balance: ${money(r.loan_balance_after)}</div>` : ""}
    <h2>Payment record</h2><div class="card">Salary recorded: ${date(r.payment_date)} &nbsp; - &nbsp; Method: ${esc(r.payment_method || "-")}</div>`);
}
const earnedParts = (r: PayrollRow): [number | null, number | null] => {
  const configuredTotal=Number(r.configured_basic || 0)+Number(r.configured_allowances || 0);
  if(r.scheduled_basic != null && r.scheduled_allowances != null && r.absence_deduction != null){
    const basic=round(Number(r.scheduled_basic)-Number(r.absence_deduction)*Number(r.scheduled_basic)/Math.max(1,Number(r.scheduled_basic)+Number(r.scheduled_allowances)));
    return [basic,round(Number(r.gross_salary)-basic)];
  }
  if(configuredTotal<=0)return [null,null];
  const basic=round(Number(r.gross_salary)*Number(r.configured_basic)/configuredTotal);
  return [basic,round(Number(r.gross_salary)-basic)];
};
export function summaryHtml(c: Cycle, rows: PayrollRow[], brand: Brand, generatedBy?: string): string {
  const sum = (key: keyof PayrollRow) => round(rows.reduce((a,r) => a + Number(r[key] || 0), 0));
  const fullBreakdown = rows.every(r => earnedParts(r)[0] != null);
  const scheduled = sum("scheduled_basic") + sum("scheduled_allowances");
  const deductions = sum("absence_deduction") + sum("loan_deduction");
  const total = sum("net_salary") + sum("overtime_amount");
  const metrics = [["Employees",String(rows.length)],["Basic earned",fullBreakdown ? money(round(rows.reduce((a,r)=>a+Number(earnedParts(r)[0]),0))) : "See rows"],["Allowances earned",fullBreakdown ? money(round(rows.reduce((a,r)=>a+Number(earnedParts(r)[1]),0))) : "See rows"],["Overtime",money(sum("overtime_amount"))],["Gross after attendance",money(sum("gross_salary"))],["Absence adjustments",fullBreakdown ? money(sum("absence_deduction")) : "Not recorded"],["Loan deductions",money(sum("loan_deduction"))],[fullBreakdown ? "Total deductions" : "Recorded loan deductions",money(fullBreakdown ? deductions : sum("loan_deduction"))],["Net payroll incl. overtime",money(total)]];
  const header = ["ID","Employee","Department","Designation","Basic","Allow.","Overtime","Absence","Loan","Net"].map(h=>`<th>${h}</th>`).join("");
  const body = rows.map(r=>`<tr><td>${r.employee_id}</td><td>${esc(r.name)}</td><td>${esc(r.department||"-")}</td><td>${esc(r.designation||"-")}</td><td>${earnedParts(r)[0] == null ? "Not recorded" : money(earnedParts(r)[0])}</td><td>${earnedParts(r)[1] == null ? "Not recorded" : money(earnedParts(r)[1])}</td><td>${money(r.overtime_amount)}</td><td>${r.absence_deduction == null ? "Not recorded" : money(r.absence_deduction)}</td><td>${money(r.loan_deduction)}</td><td>${money(r.net_salary)}</td></tr>`).join("");
  return frame("Payroll Summary",brand,`<h1>Payroll Summary</h1><div class="sub">${esc(period(c))} - Financial Year ${esc(c.session_name)} - Generated ${date(new Date())} - By ${esc(generatedBy||"MyDesk")}</div><div class="totals">${metrics.map(([k,v])=>`<div class="metric">${esc(k)}<strong>${esc(v)}</strong></div>`).join("")}</div><h2>Employee payroll</h2><table class="summary-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table><div class="card">Total salary payable: ${money(sum("net_salary"))} &nbsp; - &nbsp; Overtime credited separately: ${money(sum("overtime_amount"))}<br><b>Total compensation: ${money(total)}</b></div>`);
}
async function load(cycleId: number): Promise<{ cycle: Cycle; rows: PayrollRow[]; brand: Brand }> {
  const [cycles]: any = await pool.query("SELECT * FROM salarycycle WHERE id=? AND status='Completed'",[cycleId]);
  if (!cycles.length) throw new Error("Completed salary cycle not found");
  const cycle = cycles[0] as Cycle;
  const [rows]: any = await pool.query(`SELECT pri.*,u.name,u.email,u.department,u.status AS employment_status,
    (SELECT e.position FROM employee_lifeline e WHERE e.employee_id=pri.employee_id ORDER BY e.date DESC,e.id DESC LIMIT 1) AS designation,
    (SELECT MIN(e.date) FROM employee_lifeline e WHERE e.employee_id=pri.employee_id) AS joined,
    ea.payment_date,ea.payment_method,
    (SELECT cs.salary_amount FROM configempsalaries cs WHERE cs.id=pri.salary_config_id LIMIT 1) AS configured_basic,
    (SELECT cs.emp_of_mon_allowance+cs.transport_allowance+cs.medical_allowance FROM configempsalaries cs WHERE cs.id=pri.salary_config_id LIMIT 1) AS configured_allowances
    FROM payroll_run_items pri JOIN tbl_users u ON u.id=pri.employee_id
    LEFT JOIN employee_accounts ea ON ea.employee_id=pri.employee_id AND ea.refNo=CONCAT('SALARY-', ?, '-', ?, '-', pri.employee_id)
    WHERE pri.calendar_session_id=? ORDER BY u.name,pri.employee_id`,[cycle.month,cycle.year,cycle.calendar_session_id]);
  if (!rows.length) throw new Error("Payroll snapshot is empty");
  const [brands]: any = await pool.query("SELECT name,address,email,contact,logo FROM business_variables WHERE is_deleted=0 ORDER BY id DESC LIMIT 1");
  return { cycle, rows, brand: brands[0] || {name:"MyDesk",address:"",email:"",contact:"",logo:null} };
}
async function notifySafely(userId: number, title: string, message: string, type: string, cycle: Cycle, targetUrl: string, suffix: string) {
  try { await notifyUser(userId,{title,message,type,module:MODULE.Payroll,referenceId:cycle.id,targetUrl,dedupeKey:`payroll:${cycle.id}:${suffix}:u${userId}`}); }
  catch(e){ console.error("Payroll notification failed:",(e as Error).message); }
}
async function renderPdf(html: string, landscape=false): Promise<Buffer> {
  const browser = await puppeteer.launch({executablePath:await browserPath(),headless:true,args:process.platform==="win32"?["--no-sandbox"]:chromium.args});
  try {
    const page=await browser.newPage();
    try {
      await page.setContent(html,{waitUntil:"networkidle0",timeout:15000});
      return Buffer.from(await page.pdf({format:"A4",printBackground:true,landscape,preferCSSPageSize:!landscape}));
    } finally { await page.close(); }
  } finally { await browser.close(); }
}
async function ensureDeliveryRows(c: Cycle,rows: PayrollRow[]): Promise<void> {
  await pool.query("INSERT IGNORE INTO payroll_documents (salary_cycle_id,employee_id,document_key) VALUES (?,?,?)",[c.id,null,"summary"]);
  for(const r of rows) await pool.query("INSERT IGNORE INTO payroll_documents (salary_cycle_id,employee_id,document_key) VALUES (?,?,?)",[c.id,r.employee_id,`employee:${r.employee_id}`]);
}
export async function regeneratePayrollPdfs(cycleId: number): Promise<void> {
  const {cycle,rows}=await load(cycleId);
  await ensureDeliveryRows(cycle,rows);
}
async function claimDocument(id: number, retryFailed: boolean): Promise<boolean> {
  const [r]: any = await pool.query("UPDATE payroll_documents SET email_status='Sending',email_attempts=email_attempts+1,email_claimed_at=NOW(),email_error=NULL WHERE id=? AND email_status IN ('Pending','Failed')",[id]);
  return r.affectedRows===1;
}
async function sendEmployee(c: Cycle,r: PayrollRow, brand: Brand, retryFailed: boolean): Promise<boolean> {
  const [docs]: any = await pool.query("SELECT id,email_status FROM payroll_documents WHERE salary_cycle_id=? AND document_key=?",[c.id,`employee:${r.employee_id}`]);
  if (!docs.length || docs[0].email_status==="Sent") return docs[0]?.email_status==="Sent";
  if (docs[0].email_status==="Failed" && !retryFailed) return false;
  if (!await claimDocument(docs[0].id, retryFailed)) return false;
  if (!r.email) {
    await pool.query("UPDATE payroll_documents SET email_status='Failed',email_error='Employee has no registered email' WHERE id=?",[docs[0].id]);
    await notifySafely(r.employee_id,"Payslip available",`Your ${period(c)} payslip is available in MyDesk, but email delivery could not be completed.`,"PAYSLIP_EMAIL_FAILED",c,employeeUrl(c),"employee-failed");
    return false;
  }
  try {
    const pdf=await renderPdf(payslipHtml(c,r,brand));
    await sendAttachmentEmail(r.email,`Your MyDesk Payslip - ${period(c)}`,`Hello ${r.name},

Your salary for ${period(c)} has been processed. Your payslip is attached.
Net Salary: ${money(r.net_salary)}.
Please retain this email for your records.`,employeeUrl(c),[{filename:`Payslip-${c.month}-${c.year}-${r.employee_id}.pdf`,content:pdf,contentType:"application/pdf"}]);
    await pool.query("UPDATE payroll_documents SET email_status='Sent',email_sent_at=NOW(),generated_at=NOW(),email_error=NULL WHERE id=?",[docs[0].id]);
    await notifySafely(r.employee_id,"Payslip emailed",`Your ${period(c)} payslip has been sent to your registered email address.`,"PAYSLIP_SENT",c,employeeUrl(c),"employee-sent");
    return true;
  } catch(e) {
    console.error("Employee payslip email failed:",(e as Error).message);
    await pool.query("UPDATE payroll_documents SET email_status='Failed',email_error=? WHERE id=?",[String((e as Error).message).slice(0,500),docs[0].id]);
    await notifySafely(r.employee_id,"Payslip available",`Your ${period(c)} payslip is available in MyDesk, but email delivery could not be completed.`,"PAYSLIP_EMAIL_FAILED",c,employeeUrl(c),"employee-failed");
    return false;
  }
}
async function sendAdmin(c: Cycle, rows: PayrollRow[], recipient: {id:number;email:string;name:string}, summary: Buffer, payslips: {filename:string;content:Buffer;contentType:string}[], sent: number, retryFailed: boolean): Promise<void> {
  await pool.query("INSERT IGNORE INTO payroll_admin_deliveries (salary_cycle_id,recipient_id) VALUES (?,?)",[c.id,recipient.id]);
  if (!retryFailed) { const [existing]: any = await pool.query("SELECT status FROM payroll_admin_deliveries WHERE salary_cycle_id=? AND recipient_id=?",[c.id,recipient.id]); if (existing[0]?.status==="Failed") return; }
  const [claim]: any = await pool.query("UPDATE payroll_admin_deliveries SET status='Sending',attempts=attempts+1,claimed_at=NOW(),error=NULL WHERE salary_cycle_id=? AND recipient_id=? AND status IN ('Pending','Failed')",[c.id,recipient.id]);
  if (!claim.affectedRows) return;
  try {
    if (!recipient.email) throw new Error("Admin has no registered email");
    const breakdown = rows.every(r => r.scheduled_basic != null && r.scheduled_allowances != null && r.absence_deduction != null);
    const gross=round(rows.reduce((n,r)=>n+(breakdown ? Number(r.scheduled_basic)+Number(r.scheduled_allowances) : Number(r.gross_salary)),0));
    const net=round(rows.reduce((n,r)=>n+Number(r.net_salary)+Number(r.overtime_amount),0));
    const deductions=round(rows.reduce((n,r)=>n+(breakdown ? Number(r.absence_deduction) : 0)+Number(r.loan_deduction),0));
    await sendAttachmentEmail(recipient.email,`MyDesk Payroll Summary - ${period(c)}`,`Hello ${recipient.name},

The ${period(c)} salary cycle is complete.
Employees processed: ${rows.length}.
${breakdown ? "Gross payroll before absence" : "Gross payroll after attendance"}: ${money(gross)}.
${breakdown ? "Total deductions" : "Recorded loan deductions"}: ${money(deductions)}.
Net compensation including separately credited overtime: ${money(net)}.
Employee payslip emails sent: ${sent} of ${rows.length}.

The summary and individual payslips are attached.`,adminUrl(c),[{filename:`Payroll-Summary-${c.month}-${c.year}.pdf`,content:summary,contentType:"application/pdf"},...payslips]);
    await pool.query("UPDATE payroll_admin_deliveries SET status='Sent',sent_at=NOW(),error=NULL WHERE salary_cycle_id=? AND recipient_id=?",[c.id,recipient.id]);
    await notifySafely(recipient.id,"Payroll summary emailed",`${period(c)} payroll summary and employee payslips have been sent to your registered email.`,"PAYROLL_SUMMARY_SENT",c,adminUrl(c),"admin-sent");
  } catch(e) {
    console.error("Admin payroll email failed:",(e as Error).message);
    await pool.query("UPDATE payroll_admin_deliveries SET status='Failed',error=? WHERE salary_cycle_id=? AND recipient_id=?",[String((e as Error).message).slice(0,500),c.id,recipient.id]);
    await notifySafely(recipient.id,"Payroll summary email failed",`${period(c)} payroll was completed, but the summary email could not be delivered. Retry the email from MyDesk.`,"PAYROLL_SUMMARY_FAILED",c,adminUrl(c),"admin-failed");
  }
}
export async function processPayrollDocuments(cycleId: number, generatedById?: number, retryFailed=false): Promise<void> {
  if (!Number.isInteger(cycleId) || active.has(cycleId)) return;
  active.add(cycleId);
  try {
    const {cycle,rows,brand}=await load(cycleId);
    const recipients=await adminRecipients(MODULE.Payroll);
    for (const r of rows) await notifySafely(r.employee_id,"Salary processed",`Your ${period(cycle)} salary cycle has been processed successfully.`,"PAYROLL_PROCESSED",cycle,employeeUrl(cycle),"employee-processed");
    for (const r of rows) if (Number(r.loan_deduction) > 0)
      await nonCriticalNotification(() => loanDeductedEvent(cycle.id,cycle.year,cycle.month,r.employee_id,Number(r.loan_deduction)));
    for (const a of recipients) await notifySafely(a.id,"Salary cycle completed",`${period(cycle)} salary cycle completed successfully for ${rows.length} employees.`,"PAYROLL_COMPLETED",cycle,adminUrl(cycle),"admin-completed");
    const by=recipients.find(a=>a.id===generatedById)?.name;
    await ensureDeliveryRows(cycle,rows);
    let sent=0; for (const r of rows) if(await sendEmployee(cycle,r,brand,retryFailed)) sent++;
    for (const a of recipients) await notifySafely(a.id,"Payslip delivery",sent===rows.length?`All ${rows.length} employee payslips were emailed successfully.`:`${sent} of ${rows.length} employee payslips were emailed successfully for ${period(cycle)}.`,"PAYROLL_DELIVERY",cycle,adminUrl(cycle),"admin-delivery-"+sent);
    const [adminStates]: any = await pool.query("SELECT status FROM payroll_admin_deliveries WHERE salary_cycle_id=?",[cycle.id]);
    if (recipients.length && (retryFailed || adminStates.length<recipients.length || adminStates.some((d:any)=>d.status==="Pending"))) {
      const summary=await renderPdf(summaryHtml(cycle,rows,brand,by),true);
      const payslips=[] as {filename:string;content:Buffer;contentType:string}[];
      for(const r of rows) payslips.push({filename:`Payslip-${cycle.month}-${cycle.year}-${r.employee_id}.pdf`,content:await renderPdf(payslipHtml(cycle,r,brand)),contentType:"application/pdf"});
      for(const a of recipients) await sendAdmin(cycle,rows,a,summary,payslips,sent,retryFailed);
      await pool.query("UPDATE payroll_documents SET generated_at=NOW() WHERE salary_cycle_id=? AND document_key='summary'",[cycle.id]);
    }
    const [deliveryRows]: any = await pool.query("SELECT status FROM payroll_admin_deliveries WHERE salary_cycle_id=?",[cycle.id]);
    const summaryStatus = !recipients.length ? "Skipped" : deliveryRows.length===recipients.length && deliveryRows.every((d:any)=>d.status==="Sent") ? "Sent" : "Failed";
    await pool.query("UPDATE payroll_documents SET email_status=? WHERE salary_cycle_id=? AND document_key='summary'",[summaryStatus,cycle.id]);
  } finally { active.delete(cycleId); }
}
export async function resendEmployeePayslip(documentId: number): Promise<void> {
  const [docs]: any = await pool.query("SELECT salary_cycle_id,employee_id,email_status FROM payroll_documents WHERE id=?",[documentId]);
  if (!docs.length || !docs[0].employee_id) throw new Error("Employee payslip not ready");
  const doc=docs[0];
  if (doc.email_status==='Sending') throw new Error("Delivery is already in progress");
  const {cycle,rows,brand}=await load(doc.salary_cycle_id);
  const employee=rows.find(r=>r.employee_id===doc.employee_id);
  if (!employee) throw new Error("Employee payroll record missing");
  await pool.query("UPDATE payroll_documents SET email_status='Pending',email_error=NULL WHERE id=? AND email_status IN ('Sent','Failed')",[documentId]);
  const delivered=await sendEmployee(cycle,employee,brand,true);
  if (delivered) {
    const [counts]: any=await pool.query("SELECT COUNT(*) AS n FROM payroll_documents WHERE salary_cycle_id=? AND employee_id IS NOT NULL AND email_status='Sent'",[cycle.id]);
    const count=Number(counts[0].n);
    for (const admin of await adminRecipients(MODULE.Payroll))
      await notifySafely(admin.id,"Payslip delivery",count===rows.length?`All ${rows.length} employee payslips were emailed successfully.`:`${count} of ${rows.length} employee payslips were emailed successfully for ${period(cycle)}.`,"PAYROLL_DELIVERY",cycle,adminUrl(cycle),"admin-delivery-"+count);
  }
}
export async function resendAdminPayrollSummary(cycleId: number,recipientId: number): Promise<void> {
  const recipients=await adminRecipients(MODULE.Payroll);
  const recipient=recipients.find(r=>r.id===recipientId);
  if (!recipient) throw new Error("Not an authorized payroll recipient");
  const {cycle,rows,brand}=await load(cycleId);

  const [count]: any=await pool.query("SELECT COUNT(*) AS n FROM payroll_documents WHERE salary_cycle_id=? AND employee_id IS NOT NULL AND email_status='Sent'",[cycleId]);
  await pool.query("INSERT IGNORE INTO payroll_admin_deliveries (salary_cycle_id,recipient_id) VALUES (?,?)",[cycleId,recipientId]);
  await pool.query("UPDATE payroll_admin_deliveries SET status='Pending',error=NULL WHERE salary_cycle_id=? AND recipient_id=? AND status IN ('Sent','Failed')",[cycleId,recipientId]);
  const summary=await renderPdf(summaryHtml(cycle,rows,brand),true);
  const payslips=[] as {filename:string;content:Buffer;contentType:string}[];
  for(const r of rows) payslips.push({filename:`Payslip-${cycle.month}-${cycle.year}-${r.employee_id}.pdf`,content:await renderPdf(payslipHtml(cycle,r,brand)),contentType:"application/pdf"});
  await sendAdmin(cycle,rows,recipient,summary,payslips,Number(count[0].n),true);
  const [deliveryRows]: any=await pool.query("SELECT status FROM payroll_admin_deliveries WHERE salary_cycle_id=?",[cycleId]);
  await pool.query("UPDATE payroll_documents SET email_status=? WHERE salary_cycle_id=? AND document_key='summary'",[deliveryRows.every((d:any)=>d.status==='Sent')?'Sent':'Failed',cycleId]);
}
export async function recoverPayrollDocuments(): Promise<void> {
  const [staleEmployees]: any = await pool.query(`SELECT pd.id,pd.employee_id,sc.id AS cycle_id,sc.month,sc.year
    FROM payroll_documents pd JOIN salarycycle sc ON sc.id=pd.salary_cycle_id
    WHERE pd.email_status='Sending' AND pd.employee_id IS NOT NULL
    AND pd.email_claimed_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE) LIMIT 50`);
  for (const item of staleEmployees) {
    const [changed]: any = await pool.query("UPDATE payroll_documents SET email_status='Failed',email_error='Delivery outcome unconfirmed after interruption. Check the inbox before retry.' WHERE id=? AND email_status='Sending'",[item.id]);
    if (changed.affectedRows) {
      const c = {id:item.cycle_id,month:item.month,year:item.year} as Cycle;
      await notifySafely(item.employee_id,"Payslip available",`Your ${period(c)} payslip is available in MyDesk, but email delivery could not be confirmed.`,"PAYSLIP_EMAIL_FAILED",c,employeeUrl(c),"employee-failed");
    }
  }
  const [staleAdmins]: any = await pool.query(`SELECT ad.salary_cycle_id,ad.recipient_id,sc.month,sc.year
    FROM payroll_admin_deliveries ad JOIN salarycycle sc ON sc.id=ad.salary_cycle_id
    WHERE ad.status='Sending' AND ad.claimed_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE) LIMIT 50`);
  for (const item of staleAdmins) {
    const [changed]: any = await pool.query("UPDATE payroll_admin_deliveries SET status='Failed',error='Delivery outcome unconfirmed after interruption. Check the inbox before retry.' WHERE salary_cycle_id=? AND recipient_id=? AND status='Sending'",[item.salary_cycle_id,item.recipient_id]);
    if (changed.affectedRows) {
      const c = {id:item.salary_cycle_id,month:item.month,year:item.year} as Cycle;
      await notifySafely(item.recipient_id,"Payroll summary email unconfirmed",`${period(c)} payroll was completed, but summary email delivery could not be confirmed.`,"PAYROLL_SUMMARY_FAILED",c,adminUrl(c),"admin-failed");
    }
  }
  const [cycles]: any = await pool.query(`SELECT sc.id FROM salarycycle sc LEFT JOIN payroll_documents pd ON pd.salary_cycle_id=sc.id AND pd.document_key='summary'
    WHERE sc.status='Completed' AND (pd.id IS NULL OR pd.email_status='Pending'
      OR EXISTS (SELECT 1 FROM payroll_documents p2 WHERE p2.salary_cycle_id=sc.id AND ((p2.document_key<>'summary' AND p2.email_status='Pending'))))
    ORDER BY sc.id DESC LIMIT 10`);
  for (const c of cycles) try { await processPayrollDocuments(c.id); } catch(e) { console.error("Payroll document recovery failed:",(e as Error).message); }
}



