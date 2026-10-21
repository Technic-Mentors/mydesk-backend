import { Router } from "express";
import pool from "../database/db";
import { authenticateToken, AuthenticatedRequest } from "../middleware/middleware";
import { hasPermission, isEmployee, MODULE } from "../permissionModel";

type SearchSource = {
  type: string;
  module: string;
  permission?: string;
  table: string;
  id: string;
  title: string[];
  subtitle?: string[];
  fields: string[];
  active?: [string, string];
  owner?: string;
};

// Only these tables and columns can be searched. Column existence is checked
// against the current database schema before a query is built.
const sources: SearchSource[] = [
  { type: "employee", module: "Employees", permission: MODULE.People, table: "tbl_users", id: "id", title: ["name"], subtitle: ["email", "department"], fields: ["name", "email", "department", "contact"], active: ["role", "user"] },
  { type: "project", module: "Projects", permission: MODULE.Projects, table: "projects", id: "id", title: ["projectName"], subtitle: ["projectCategory"], fields: ["projectName", "projectCategory", "description"], active: ["projectStatus", "Y"] },
  { type: "todo", module: "Todos", permission: MODULE.Performance, table: "todo", id: "id", title: ["task"], subtitle: ["note"], fields: ["task", "note"], owner: "employee_id" },
  { type: "progress", module: "Progress", permission: MODULE.Performance, table: "progress", id: "id", title: ["note"], subtitle: ["email"], fields: ["note", "email"], owner: "employee_id" },
  { type: "lead", module: "Leads", permission: MODULE.LeadManagement, table: "leads", id: "id", title: ["company_name", "contact_person"], subtitle: ["contact_person", "email"], fields: ["company_name", "contact_person", "email", "mobile_number"], active: ["status", "Y"] },
  { type: "comment", module: "Comments", permission: MODULE.LeadManagement, table: "leads", id: "id", title: ["comments"], subtitle: ["company_name"], fields: ["comments"], active: ["status", "Y"] },
  { type: "customer", module: "Customers", permission: MODULE.People, table: "customers", id: "id", title: ["customerName"], subtitle: ["email", "companyName"], fields: ["customerName", "email", "companyName", "customerContact"], active: ["customerStatus", "Y"] },
  { type: "supplier", module: "Suppliers", permission: MODULE.People, table: "suppliers", id: "supplierId", title: ["supplierName"], subtitle: ["supplierEmail"], fields: ["supplierName", "supplierEmail", "supplierContact"], active: ["status", "Active"] },
  { type: "quotation", module: "Quotations", permission: MODULE.Sales, table: "quotations", id: "id", title: ["refNo", "invoiceNo"], subtitle: ["invoiceNo"], fields: ["refNo", "invoiceNo"] },
  { type: "sale", module: "Sales", permission: MODULE.Sales, table: "sales", id: "id", title: ["invoiceNo"], fields: ["invoiceNo"] },
  { type: "expense", module: "Expenses", permission: MODULE.Expenses, table: "expenses", id: "id", title: ["expenseName"], subtitle: ["addedBy"], fields: ["expenseName", "addedBy"], active: ["expenseStatus", "Y"] },
  { type: "asset", module: "Assets", permission: MODULE.Assets, table: "assets", id: "id", title: ["asset_name"], subtitle: ["description"], fields: ["asset_name", "description"], active: ["status", "Y"] },
  { type: "leave", module: "Leave Requests", permission: MODULE.Attendance, table: "leaves", id: "id", title: ["leaveSubject", "leaveReason"], subtitle: ["leaveStatus"], fields: ["leaveSubject", "leaveReason", "leaveStatus"], owner: "userId" },
  { type: "attendance", module: "Attendance", permission: MODULE.Attendance, table: "attendance", id: "id", title: ["date"], subtitle: ["attendanceStatus"], fields: ["date", "attendanceStatus", "type"], owner: "userId" },
  { type: "remote", module: "Remote Work Requests", permission: MODULE.Attendance, table: "attendance", id: "id", title: ["remoteReason", "date"], subtitle: ["remoteStatus"], fields: ["remoteReason", "date", "remoteStatus"], owner: "userId" },
  { type: "loan", module: "Loans", permission: MODULE.Payroll, table: "loan", id: "id", title: ["refNo"], subtitle: ["loanAmount"], fields: ["refNo", "loanAmount"], owner: "employee_id" },
  { type: "system_user", module: "System Users", permission: MODULE.UsersManagement, table: "tbl_users", id: "id", title: ["name"], subtitle: ["email"], fields: ["name", "email"] },
  { type: "role", module: "Roles & Access", permission: MODULE.UsersManagement, table: "roles", id: "id", title: ["roleName", "name"], fields: ["roleName", "name"] },
  { type: "calendar", module: "Calendar", permission: MODULE.Payroll, table: "calendarsession", id: "id", title: ["session_name"], subtitle: ["year"], fields: ["session_name", "year", "month"] },
  { type: "notification", module: "Notifications", table: "notifications", id: "id", title: ["title", "message"], subtitle: ["message"], fields: ["title", "message"], owner: "userId" },
  { type: "log", module: "Logs", permission: MODULE.Configuration, table: "activity_logs", id: "id", title: ["description"], subtitle: ["module"], fields: ["description", "module", "action"] },
];

const moduleLinks = [
  { key: "employees", title: "Employees", permission: MODULE.People },
  { key: "customers", title: "Customers", permission: MODULE.People },
  { key: "suppliers", title: "Suppliers", permission: MODULE.People },
  { key: "leads", title: "Leads", permission: MODULE.LeadManagement },
  { key: "sales", title: "Sales", permission: MODULE.Sales },
  { key: "quotations", title: "Quotations", permission: MODULE.Sales },
  { key: "expenses", title: "Expenses", permission: MODULE.Expenses },
  { key: "assets", title: "Assets", permission: MODULE.Assets },
  { key: "loans", title: "Loans", permission: MODULE.Payroll },
  { key: "system_users", title: "System Users", permission: MODULE.UsersManagement },
  { key: "logs", title: "Logs", permission: MODULE.Configuration },
  { key: "progress", title: "Progress", permission: MODULE.Performance },
  { key: "performance", title: "Performance & Productivity", permission: MODULE.Performance },
  { key: "tasks", title: "Tasks and Todos", permission: MODULE.Performance },
  { key: "projects", title: "Projects", permission: MODULE.Projects },
  { key: "attendance", title: "Attendance", permission: MODULE.Attendance },
  { key: "leave", title: "Leave Requests", permission: MODULE.Attendance },
  { key: "remote", title: "Remote Work Requests", permission: MODULE.Attendance },
  { key: "payroll", title: "Payroll", permission: MODULE.Payroll },
  { key: "reports", title: "Reports", permission: MODULE.Reports },
  { key: "attendance_report", title: "Attendance Report", permission: MODULE.Reports },
  { key: "progress_report", title: "Progress Report", permission: MODULE.Reports },
  { key: "task_report", title: "Task Report", permission: MODULE.Reports },
  { key: "sales_report", title: "Sales Report", permission: MODULE.Reports },
  { key: "expense_report", title: "Expense Report", permission: MODULE.Reports },
  { key: "project_report", title: "Project Report", permission: MODULE.Reports },
  { key: "payroll_report", title: "Payroll Report", permission: MODULE.Reports },
  { key: "calendar", title: "Calendar", permission: MODULE.Payroll },
  { key: "notifications", title: "Notifications", permission: MODULE.Dashboard },
  { key: "roles", title: "Roles & Access", permission: MODULE.UsersManagement },
  { key: "chat", title: "Chat", permission: MODULE.Dashboard },
  { key: "files", title: "Files/Documents", permission: MODULE.Dashboard },
];

let schemaCache: { expires: number; columns: Map<string, Set<string>> } | null = null;
async function searchableSchema() {
  if (schemaCache && schemaCache.expires > Date.now()) return schemaCache.columns;
  const [rows]: any = await pool.query(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
  );
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!columns.has(row.TABLE_NAME)) columns.set(row.TABLE_NAME, new Set());
    columns.get(row.TABLE_NAME)!.add(row.COLUMN_NAME);
  }
  schemaCache = { expires: Date.now() + 60_000, columns };
  return columns;
}

const router = Router();
router.get("/global-search", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (q.length < 2) { res.json({ groups: [] }); return; }
  const page = Math.min(20, Math.max(1, Number(req.query.page) || 1));
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const user = req.user!;
  const employee = isEmployee(user);
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

  try {
    const schema = await searchableSchema();

    const allowed = sources.filter((source) => {
      if (category && category !== source.type) return false;
      if (!schema.has(source.table)) return false;
      if (employee) return Boolean(source.owner) && ["todo", "progress", "leave", "attendance", "remote", "loan", "notification"].includes(source.type);
      return !source.permission || hasPermission(user, source.permission);
    });

    const groups = await Promise.all(allowed.map(async (source) => {
      const columns = schema.get(source.table)!;
      if (!columns.has(source.id)) return null;
      if (employee && (!source.owner || !columns.has(source.owner))) return null;
      if (source.type === "notification" && !columns.has("userId")) return null;
      const fields = source.fields.filter((field) => columns.has(field));
      if (!fields.length) return null;
      const pick = (options: string[]) => options.find((field) => columns.has(field));
      const titleField = pick(source.title) || fields[0];
      const subtitleField = pick(source.subtitle || []);
      const quoted = (field: string) => `\`${field}\``;
      const conditions = [`(${fields.map((field) => `CAST(${quoted(field)} AS CHAR) LIKE ? ESCAPE '\\\\'`).join(" OR ")} OR CAST(${quoted(source.id)} AS CHAR) LIKE ? ESCAPE '\\\\')`];
      const params: unknown[] = [...fields.map(() => like), like];
      if (source.active && columns.has(source.active[0])) { conditions.push(`${quoted(source.active[0])} = ?`); params.push(source.active[1]); }
      if (employee && source.owner && columns.has(source.owner)) { conditions.push(`${quoted(source.owner)} = ?`); params.push(user.id); }
      if (source.type === "notification" && !employee) { conditions.push("`userId` = ?"); params.push(user.id); }
      if (source.type === "todo" && columns.has("todoStatus")) conditions.push("`todoStatus` != 'N'");
      if (source.type === "progress" && columns.has("progressStatus")) conditions.push("`progressStatus` = 'Y'");
      if (source.type === "system_user" && columns.has("role")) conditions.push("LOWER(`role`) != 'user'");
      if (source.type === "system_user" && columns.has("roleId")) conditions.push("`roleId` IS NOT NULL");
      if (source.type === "remote") {
        if (!columns.has("remoteStatus")) return null;
        conditions.push("`remoteStatus` IS NOT NULL");
      }
      const offset = category ? (page - 1) * 5 : 0;
      const extraFields = source.type === "notification" && columns.has("targetUrl") && columns.has("referenceId")
        ? ", `targetUrl` AS route, `referenceId` AS relatedId"
        : source.type === "log" && columns.has("reference_id") ? ", `reference_id` AS relatedId" : "";
      const [rows]: any = await pool.query(
        `SELECT ${quoted(source.id)} AS id, LEFT(CAST(${quoted(titleField)} AS CHAR), 180) AS title, ${subtitleField ? `LEFT(CAST(${quoted(subtitleField)} AS CHAR), 180)` : "NULL"} AS subtitle${extraFields} FROM \`${source.table}\` WHERE ${conditions.join(" AND ")} ORDER BY ${quoted(source.id)} DESC LIMIT 6 OFFSET ?`,
        [...params, offset],
      );
      return { type: source.type, module: source.module, hasMore: rows.length > 5, results: rows.slice(0, 5).map((row: any) => ({ id: row.id, referenceId: row.relatedId || row.id, type: source.type, module: source.module, title: row.title || `${source.module} #${row.id}`, subtitle: row.subtitle || "", ...(row.route ? { route: row.route } : {}) })) };
    }));

    if (employee && (!category || category === "project") && schema.has("assignedprojects") && schema.has("projects")) {
      const [projectRows]: any = await pool.query(
        `SELECT p.id, p.projectName AS title, p.projectCategory AS subtitle FROM projects p
         JOIN assignedprojects a ON a.projectId=p.id AND a.employee_id=? AND a.assignStatus='Y'
         WHERE p.projectStatus='Y' AND (p.projectName LIKE ? ESCAPE '\\\\' OR p.description LIKE ? ESCAPE '\\\\' OR CAST(p.id AS CHAR) LIKE ? ESCAPE '\\\\')
         ORDER BY p.id DESC LIMIT 6 OFFSET ?`, [user.id, like, like, like, category ? (page - 1) * 5 : 0],
      );
      if (projectRows.length) groups.push({ type: "project", module: "Projects", hasMore: projectRows.length > 5, results: projectRows.slice(0, 5).map((row: any) => ({ id: row.id, referenceId: row.id, type: "project", module: "Projects", title: row.title, subtitle: row.subtitle })) } as any);
    }

    // Chat content is always restricted to conversations in which this user participates.
    if ((!category || ["conversation", "message", "file"].includes(category)) && schema.has("chat_messages") && schema.has("chat_participants") && schema.has("chat_conversations")) {
      for (const [type, module, field] of [["message", "Messages", "content"], ["file", "Files/Documents", "file_name"]] as const) {
        if (category && category !== type) continue;
        const [rows]: any = await pool.query(
          `SELECT m.id, m.conversation_id AS conversationId, m.content, m.file_name AS fileName, c.name AS conversationName
           FROM chat_messages m JOIN chat_participants p ON p.conversation_id=m.conversation_id AND p.user_id=?
           JOIN chat_conversations c ON c.id=m.conversation_id
           WHERE m.deleted_at IS NULL AND m.id>p.cleared_id AND m.${field} LIKE ? ESCAPE '\\\\'
           ORDER BY m.id DESC LIMIT 6 OFFSET ?`, [user.id, like, category ? (page - 1) * 5 : 0],
        );
        if (rows.length) groups.push({ type, module, hasMore: rows.length > 5, results: rows.slice(0, 5).map((row: any) => ({ id: row.id, referenceId: row.id, type, module, title: type === "file" ? row.fileName : row.content.slice(0, 110), subtitle: row.conversationName || `Conversation #${row.conversationId}`, conversationId: row.conversationId })) } as any);
      }
      if (!category || category === "conversation") {
        const [conversations]: any = await pool.query(
        `SELECT c.id, COALESCE(CONVERT(c.name USING utf8mb4) COLLATE utf8mb4_unicode_ci,
          (SELECT CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci FROM chat_participants peer JOIN tbl_users u ON u.id=peer.user_id WHERE peer.conversation_id=c.id AND peer.user_id<>? LIMIT 1)) AS name
         FROM chat_conversations c JOIN chat_participants p ON p.conversation_id=c.id AND p.user_id=?
         WHERE c.archived_at IS NULL HAVING name LIKE ? ESCAPE '\\\\' ORDER BY c.id DESC LIMIT 6 OFFSET ?`,
        [user.id, user.id, like, category ? (page - 1) * 5 : 0],
        );
        if (conversations.length) groups.push({ type: "conversation", module: "Chat conversations", hasMore: conversations.length > 5, results: conversations.slice(0, 5).map((row: any) => ({ id: row.id, referenceId: row.id, type: "conversation", module: "Chat conversations", title: row.name, subtitle: "Chat", conversationId: row.id })) } as any);
      }
    }

    if ((!category || category === "file_lead") && !employee && hasPermission(user, MODULE.LeadManagement) && schema.has("uploads") && schema.has("leads")) {
      const [uploads]: any = await pool.query(
        `SELECT u.id, u.reference_id AS referenceId, u.original_name AS title, l.company_name AS subtitle
         FROM uploads u JOIN leads l ON l.id=u.reference_id AND l.status='Y'
         WHERE u.module='lead' AND (u.original_name LIKE ? ESCAPE '\\\\' OR u.file_name LIKE ? ESCAPE '\\\\')
         ORDER BY u.id DESC LIMIT 6 OFFSET ?`, [like, like, category ? (page - 1) * 5 : 0],
      );
      if (uploads.length) groups.push({ type: "file_lead", module: "Files/Documents", hasMore: uploads.length > 5, results: uploads.slice(0, 5).map((row: any) => ({ id: row.id, referenceId: row.referenceId, type: "file_lead", module: "Files/Documents", title: row.title, subtitle: row.subtitle })) } as any);
    }

    if (!category || category === "module") {
      const links = moduleLinks.filter((link) =>
        link.title.toLowerCase().includes(q.toLowerCase()) &&
        (employee ? ["performance", "tasks", "progress", "projects", "attendance", "leave", "remote", "payroll", "loans", "reports", "attendance_report", "progress_report", "task_report", "notifications", "chat", "files"].includes(link.key) : hasPermission(user, link.permission)),
      );
      if (links.length) groups.push({ type: "module", module: "Modules", hasMore: false, results: links.map((link) => ({ id: link.key, referenceId: link.key, type: "module", module: "Modules", title: link.title, subtitle: "Open module" })) } as any);
    }

    res.json({ groups: groups.filter((group) => group && group.results.length) });
  } catch (error) {
    console.error("Global search failed:", error);
    res.status(500).json({ message: "Search is temporarily unavailable" });
  }
});

export default router;
