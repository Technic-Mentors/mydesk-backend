import nodemailer from "nodemailer";
import pool from "../database/db";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function emailTemplate(title: string, message: string, targetUrl?: string): string {
  const origin = process.env.FRONTEND_URL || "http://localhost:5173";
  const safePath = targetUrl?.startsWith("/") && !targetUrl.startsWith("//") ? targetUrl : "/";
  return `<div style="background:#f4f7fb;padding:32px;font-family:Arial,sans-serif;color:#243247"><div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden"><div style="background:#2158d5;color:white;padding:24px;font-size:24px;font-weight:bold">MyDesk</div><div style="padding:28px"><h2>${escapeHtml(title)}</h2><p style="line-height:1.6;white-space:pre-line">${escapeHtml(message)}</p><a href="${escapeHtml(origin + safePath)}" style="display:inline-block;background:#2158d5;color:white;padding:12px 18px;border-radius:6px;text-decoration:none">Open MyDesk</a><p style="margin-top:28px;color:#667085;font-size:13px">Regards,<br>MyDesk<br>Technic Mentors</p></div></div></div>`;
}

// Credentials and reset links must never be written to the persistent email outbox.
// Call this only after the account transaction commits, and do not log its message.
export async function sendSensitiveEmail(recipient: string, title: string, message: string, targetUrl: string): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) throw new Error("SMTP configuration missing");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    requireTLS: process.env.SMTP_USE_TLS === "true" || process.env.SMTP_USE_TLS === "1",
    auth: process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } : undefined });
  const safeUrl = new URL(targetUrl);
  if (safeUrl.protocol !== "https:" && !(safeUrl.hostname === "localhost" && safeUrl.protocol === "http:")) throw new Error("Unsafe email link");
  const html = emailTemplate(title,message).replace(/<a href="[^"]*"/, `<a href="${escapeHtml(safeUrl.toString())}"`);
  await transport.sendMail({from:process.env.SMTP_FROM_EMAIL,to:recipient,subject:title,html});
}

export async function queueEmail(recipient: string | null | undefined, title: string, message: string, targetUrl: string, dedupeKey: string): Promise<void> {
  if (!recipient) return;
  try {
    const [result]: any = await pool.query(
      `INSERT INTO notification_email_outbox (dedupeKey,recipient,subject,bodyHtml) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE id=id`,
      [dedupeKey,recipient,title,emailTemplate(title,message,targetUrl)],
    );
    // mysql2 can report affectedRows=1 for a no-op duplicate; insertId is 0 then.
    if (!result.insertId) return;
    void deliverEmail(result.insertId).catch((error) => console.error("Email delivery task failed:",(error as Error).message));
  } catch (error) { console.error("Email queue failed:",(error as Error).message); }
}

export async function deliverEmail(id: number): Promise<void> {
  const [rows]: any = await pool.query("SELECT * FROM notification_email_outbox WHERE id=? AND status<>'sent'", [id]);
  if (!rows.length) return;
  const mail = rows[0];
  try {
    const port = Number(process.env.SMTP_PORT || 587);
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) throw new Error("SMTP configuration missing");
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      requireTLS: process.env.SMTP_USE_TLS === "true" || process.env.SMTP_USE_TLS === "1",
      auth: process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } : undefined });
    await transport.sendMail({ from: process.env.SMTP_FROM_EMAIL, to: mail.recipient, subject: mail.subject, html: mail.bodyHtml });
    await pool.query("UPDATE notification_email_outbox SET status='sent',attempts=attempts+1,sentAt=NOW(),lastError=NULL WHERE id=?", [id]);
  } catch (error) {
    console.error("Email delivery failed:",(error as Error).message);
    await pool.query("UPDATE notification_email_outbox SET status='failed',attempts=attempts+1,lastError=? WHERE id=?", [String(error).slice(0,500),id]);
  }
}

export async function retryFailedEmails(): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) return;
  const [rows]: any = await pool.query(
    "SELECT id FROM notification_email_outbox WHERE status IN ('pending','failed') AND attempts<5 AND createdAt<DATE_SUB(NOW(), INTERVAL 30 SECOND) ORDER BY id LIMIT 20",
  );
  for (const row of rows) await deliverEmail(row.id);
}

export async function sendAttachmentEmail(recipient: string, subject: string, message: string, targetUrl: string, attachments: Array<{ filename: string; content: Buffer; contentType: string }>): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) throw new Error("SMTP configuration missing");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    requireTLS: process.env.SMTP_USE_TLS === "true" || process.env.SMTP_USE_TLS === "1",
    auth: process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } : undefined });
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM_EMAIL, to: recipient, subject,
      html: emailTemplate(subject, message, targetUrl), attachments });
  } finally { transport.close(); }
}
