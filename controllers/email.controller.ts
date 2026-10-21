import { Request, Response } from "express";
import { existsSync } from "fs";
import path from "path";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

type ReportColumn = { label: string; key: string };
type ReportRow = Record<string, unknown>;

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);

function buildTableRows(data: ReportRow[], columns: ReportColumn[]): string {
  return data.map((row, index) => {
    const cells = columns.map((column) => {
      const value = column.key === "__index" ? index + 1 : row[column.key];
      return "<td style=\"border:1px solid #ddd;padding:8px;\">" +
        escapeHtml(value) + "</td>";
    }).join("");
    return "<tr>" + cells + "</tr>";
  }).join("");
}

async function reportBrowserPath(): Promise<string> {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) {
    if (!existsSync(configured)) throw new Error("Configured report browser does not exist");
    return configured;
  }

  if (process.platform === "win32") {
    const paths = [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
    const installed = paths.find(existsSync);
    if (!installed) throw new Error("Chrome or Edge is required to create report PDFs on Windows");
    return installed;
  }

  return chromium.executablePath();
}

export const sendReportEmail = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email, reportData, business, columns } = req.body as {
      email?: string;
      reportData?: ReportRow[];
      business?: { name?: string };
      columns?: ReportColumn[];
    };

    if (!email || !Array.isArray(columns) || columns.length === 0 ||
        !columns.every((column) => typeof column.label === "string" && typeof column.key === "string") ||
        !Array.isArray(reportData)) {
      res.status(400).json({ message: "A recipient, report rows, and columns are required" });
      return;
    }

    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) {
      res.status(503).json({ message: "SMTP is not configured for report email" });
      return;
    }

    const rowsHtml = buildTableRows(reportData, columns);
    const title = escapeHtml(business?.name || "Report");
    const headers = columns.map((column) => "<th>" + escapeHtml(column.label) + "</th>").join("");
    const fullHtml = "<!doctype html><html><head><style>" +
      "body{font-family:Arial,sans-serif;padding:40px}table{width:100%;border-collapse:collapse}" +
      "th,td{border:1px solid #ddd;padding:8px}th{background:#f4f4f4}" +
      "</style></head><body><h2>" + title + "</h2><table><thead><tr>" +
      headers + "</tr></thead><tbody>" + rowsHtml + "</tbody></table></body></html>";

    const executablePath = await reportBrowserPath();
    const browser = await puppeteer.launch({
      args: process.platform === "win32" ? ["--no-sandbox"] : chromium.args,
      executablePath,
      headless: true,
    });

    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: "load" });
      pdfBuffer = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
    } finally {
      await browser.close();
    }

    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      requireTLS: process.env.SMTP_USE_TLS === "true" || process.env.SMTP_USE_TLS === "1",
      auth: process.env.SMTP_USERNAME
        ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });

    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM_EMAIL,
        to: email,
        subject: "Report - " + new Date().toLocaleDateString(),
        html: "<p>Please find the requested report attached as a PDF.</p>",
        attachments: [{
          filename: "report.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        }],
      });
    } finally {
      transport.close();
    }

    res.status(200).json({ message: "Email with PDF sent successfully" });
  } catch (error) {
    console.error("PDF Email Error:", error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "Failed to generate or send PDF",
    });
  }
};
