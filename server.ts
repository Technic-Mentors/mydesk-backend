import express, { Application, Request, Response } from "express";

import path from "path";
import cloudinary from "./utils/cloudinary";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import pool from "./database/db";
import { retryFailedEmails } from "./services/emailService";
import { recoverPayrollDocuments } from "./services/payrollDocuments";
import { processOverdueTodos } from "./services/projectTodoEvents";

import cors from "cors";
import loginRoutes from "./routes/login.routes";
import userRoutes from "./routes/user.routes";
import employeelifelineRoutes from "./routes/employeelifeline.routes";
import customerRoutes from "./routes/customer.routes";
import supplierRoutes from "./routes/supplier.routes";
import attendanceRuleRoutes from "./routes/attendanceRule.routes";
import markAttendanceRoutes from "./routes/markAttendance.routes";
import userAttendanceRoutes from "./routes/userAttendance.routes";
import leaveRoutes from "./routes/leave.routes";
import holidaysRoutes from "./routes/holidays.routes";
import employeewithdrawRoutes from "./routes/employeewithdraw.routes";
import projectcategoryRoutes from "./routes/projectcategory.routes";
import projectsRoutes from "./routes/projects.routes";
import assignprojectRoutes from "./routes/assignproject.routes";
import todoRoutes from "./routes/todo.routes";
import progressRoutes from "./routes/progress.routes";
import expensecategoriesRoutes from "./routes/expensecategories.routes";
import expensesRoutes from "./routes/expenses.routes";
import assetcategoryRoutes from "./routes/assetcategory.routes";
import assetRoutes from "./routes/asset.routes";
import jobRoutes from "./routes/job.routes";
import applicantRoutes from "./routes/applicant.routes";
import saleRoutes from "./routes/sale.routes";
import paymentRoutes from "./routes/payment.routes";
import quotationRoutes from "./routes/quotation.routes";
import calendarRoutes from "./routes/calendar.routes";
import configuresalaryRoutes from "./routes/configuresalary.routes";
import employeeaccountRoutes from "./routes/employeeaccount.routes";
import overtimeRoutes from "./routes/overtime.routes";
import advancesalaryRoutes from "./routes/advancesalary.routes";
import loanRoutes from "./routes/loan.routes";
import customeraccountRoutes from "./routes/customeraccount.routes";
import supplieraccountRoutes from "./routes/supplieraccount.routes";
import promotionRoutes from "./routes/promotion.routes";
import resignationRoutes from "./routes/resignation.routes";
import rejoinRoutes from "./routes/rejoin.routes";
import userDashboardRoutes from "./routes/userDashboard.routes";
import salaryCycleRoutes from "./routes/salaryCycle.routes";
import rolesRoutes from "./routes/roles.routes";
import { getRoles } from "./controllers/role.controller";
import systemUsersRoutes from "./routes/systemuser.routes";
import accesscontrolRoutes from "./routes/accesscontrol.routes";
import accountReportRoutes from "./routes/accountreport.routes";
import businessVariableRoutes from "./routes/businessvariable.routes";
import configOvertimeRoutes from "./routes/configOvertime.routes";
import emailRoutes from "./routes/email.routes";
import notificationRoutes from "./routes/notificationRoutes";
import chatRoutes from "./routes/chat.routes";
import globalSearchRoutes from "./routes/globalSearch.routes";
import leadRRoutes from "./routes/crm/lead.routes"
import pipelineRoutes from "./routes/crm/pipeline.routes";
import session from "express-session";
import leadRoutes from "./routes/crm/lead.routes";
import followUpRoutes from "./routes/crm/followUp.routes";
import wfhRoutes from "./routes/wfhRoutes";
import activityRoutes from "./routes/crm/activity.routes";
import ptofileRoutes from "./routes/profile.routes";
import profileRoutes from "./routes/profile.routes";
import { securedMount } from "./middleware/securedMount";
import { authenticateToken, requirePermission } from "./middleware/middleware";
import { MODULE } from "./permissionModel";
const app: Application = express();

const PORT: number = parseInt(process.env.PORT || "3002");
dotenv.config();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(bodyParser.json());

app.use("/uploads/chat", (_req, res) => { res.sendStatus(404); });
app.use("/uploads/projects", (_req, res) => { res.sendStatus(404); });
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use(
  session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }),
);

app.use(express.static(path.join(__dirname, "dist")));
app.use("/api", loginRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api", globalSearchRoutes);
securedMount(app, "/api", profileRoutes, MODULE.People, [
  { path: /^\/user\/(getMyProfile|updateMyProfile|updateProfileImage)$/i },
]);
securedMount(app, "/api/admin", userRoutes, MODULE.People, [
  { path: /^\/updateProfileImage$/i },
], [
  { path: /^\/getUsers$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api", followUpRoutes, MODULE.FollowUps);
securedMount(app, "/api/wfh", wfhRoutes, MODULE.Attendance, [
  { path: /^\/(\d+)\/(?:request|my-requests|status|update\/\d+|cancel\/\d+)$/i, ownerParam: "id" },
]);
securedMount(app, "/api", leadRoutes, MODULE.LeadManagement);
securedMount(app, "/api/admin", employeelifelineRoutes, MODULE.HumanResources);
securedMount(app, "/api", customerRoutes, MODULE.People);
securedMount(app, "/api/admin", supplierRoutes, MODULE.People);
securedMount(app, "/api/admin", attendanceRuleRoutes, MODULE.Configuration, [
  { path: /^\/getTimeConfigured$/i },
], [
  { path: /^\/getTimeConfigured$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api/admin", markAttendanceRoutes, MODULE.Attendance, [
  { path: /^\/(?:getAttendance|markAttendance)\/(\d+)$/i, ownerParam: "id" },
  { path: /^\/geofence-status$/i },
  { path: /^\/mobile-clock-settings$/i, methods: ["GET"] },
], [
  { path: /^\/mobile-clock-settings$/i, module: MODULE.Configuration, methods: ["GET", "PUT"] },
]);
securedMount(app, "/api", userAttendanceRoutes, MODULE.Attendance, [
  { path: /^\/user\/getMyAttendances$/i },
], [
  { path: /^\/admin\/getAllAttendances$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api", leaveRoutes, MODULE.Attendance, [
  { path: /^\/user\//i },
  { path: /^\/(?:addLeave|updateMyLeave\/\d+)$/i },
], [
  { path: /^\/admin\/getUsersLeaves$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api", pipelineRoutes, MODULE.Pipeline);
securedMount(app, "/api/admin", holidaysRoutes, MODULE.Configuration, [
  { path: /^\/getHolidays$/i },
], [
  { path: /^\/getHolidays$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api/admin", employeewithdrawRoutes, MODULE.HumanResources);
securedMount(app, "/api/admin", projectcategoryRoutes, MODULE.Projects);
securedMount(app, "/api/admin", projectsRoutes, MODULE.Projects, [
  { path: /^\/projects\/\d+(?:\/files(?:\/\d+)?)?$/i, methods: ["GET"] },
]);
securedMount(app, "/api", assignprojectRoutes, MODULE.Projects, [
  { path: /^\/user\//i },
]);
securedMount(app, "/api", todoRoutes, MODULE.Performance, [
  { path: /^\/user\/getTodo\/(\d+)$/i, ownerParam: "id" },
  { path: /^\/admin\/(?:createTodo|updateTodo\/\d+(?:\/status)?|deleteTodo\/\d+)$/i },
], [
  { path: /^\/admin\/getTodos$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api", progressRoutes, MODULE.Performance, [
  { path: /^\/user\//i },
  { path: /^\/admin\/(?:addProgress|updateProgress\/\d+|deleteProgress\/\d+)$/i },
  { path: /^\/admin\/getAssignProjects\/(\d+)$/i, ownerParam: "employee_id" },
], [
  { path: /^\/admin\/getProgress$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/", activityRoutes, MODULE.LeadManagement);
securedMount(app, "/api/admin", expensecategoriesRoutes, MODULE.Expenses);
securedMount(app, "/api/admin", expensesRoutes, MODULE.Expenses);
securedMount(app, "/api/admin", assetcategoryRoutes, MODULE.Assets);
securedMount(app, "/api/admin", assetRoutes, MODULE.Assets);
securedMount(app, "/api/admin", jobRoutes, MODULE.TalentAcquisition);
securedMount(app, "/api/admin", applicantRoutes, MODULE.TalentAcquisition);
securedMount(app, "/api/admin", saleRoutes, MODULE.Sales);
securedMount(app, "/api/admin", paymentRoutes, MODULE.Sales);
securedMount(app, "/api/admin", quotationRoutes, MODULE.Sales);
securedMount(app, "/api/admin", calendarRoutes, MODULE.Payroll);
securedMount(app, "/api/admin", configuresalaryRoutes, MODULE.Payroll);
securedMount(app, "/api", employeeaccountRoutes, MODULE.Accounts, [
  { path: /^\/user\//i },
]);
securedMount(app, "/api", overtimeRoutes, MODULE.Payroll);
securedMount(app, "/api", advancesalaryRoutes, MODULE.Payroll, [
  { path: /^\/user\//i },
  { path: /^\/createAdvanceSalary$/i },
]);
securedMount(app, "/api", loanRoutes, MODULE.Payroll, [
  { path: /^\/user\//i },
]);
securedMount(app, "/api/admin", customeraccountRoutes, MODULE.Accounts);
securedMount(app, "/api/admin", supplieraccountRoutes, MODULE.Accounts);
securedMount(app, "/api", promotionRoutes, MODULE.Dynamics, [
  { path: /^\/getPromotionHistory\/(\d+)$/i, ownerParam: "employeeId" },
  { path: /^\/promotion-positions$/i },
  { path: /^\/user\/(?:updatePromotion|deletePromotion)\/(\d+)$/i,
    ownerRecord: { table: "promotion", column: "employee_id" }, pendingOnly: true },
  { path: /^\/user\//i },
]);
securedMount(app, "/api/notification", notificationRoutes, MODULE.Dashboard, [
  { path: /^\// },
]);
securedMount(app, "/api", notificationRoutes, MODULE.Dashboard, [
  { path: /^\// },
]);
securedMount(app, "/api", resignationRoutes, MODULE.Dynamics, [
  { path: /^\/user\/addResignation$/i, ownerBody: "id" },
  { path: /^\/updateResignation\/(\d+)$/i,
    ownerRecord: { table: "resignation", column: "employee_id" }, pendingOnly: true },
  { path: /^\/deleteResignation\/(\d+)$/i,
    ownerRecord: { table: "resignation", column: "employee_id" } },
  { path: /^\/user\//i },
]);
securedMount(app, "/api", rejoinRoutes, MODULE.Dynamics, [
  { path: /^\/user\/addRejoin$/i, ownerBody: "id" },
  { path: /^\/user\/updateMyRejoin\/(\d+)$/i,
    ownerRecord: { table: "rejoin", column: "employee_id" }, pendingOnly: true },
  { path: /^\/user\//i },
]);
securedMount(app, "/api", userDashboardRoutes, MODULE.Dashboard, [
  { path: /^\/user\//i },
]);
securedMount(app, "/api", salaryCycleRoutes, MODULE.Payroll, [
  { path: /^\/payroll\/documents(?:\/\d+\/download)?$/i, methods: ["GET"] },
], [
  { path: /^\/admin\/getPayrollReport$/i, module: MODULE.Reports, methods: ["GET"] },
]);
app.get("/api/position-roles", authenticateToken, getRoles);
securedMount(app, "/api/admin", rolesRoutes, MODULE.UsersManagement, [], [
  { path: /^\/getRoles$/i, module: MODULE.Configuration },
]);
securedMount(app, "/api/admin", systemUsersRoutes, MODULE.UsersManagement);
securedMount(app, "/api/admin", accesscontrolRoutes, MODULE.Configuration);
securedMount(app, "/api/admin", accountReportRoutes, MODULE.Reports);
securedMount(app, "/api/admin", businessVariableRoutes, MODULE.Configuration, [
  { path: /^\/business-variables$/i, methods: ["GET"] },
], [
  { path: /^\/business-variables$/i, module: MODULE.Reports, methods: ["GET"] },
]);
securedMount(app, "/api/admin", configOvertimeRoutes, MODULE.Configuration);
securedMount(app, "/api/admin", emailRoutes, MODULE.Reports);

app.get("/", (req: Request, res: Response) => {
  res.send("Backend is up and running 🚀");
});

app.get("/cloudinary-test", authenticateToken, requirePermission(MODULE.Configuration), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(
      "https://res.cloudinary.com/demo/image/upload/sample.jpg",
    );
    res.json(result);
  } catch (error) {
    console.error("Cloudinary test upload error:", error);
    res.status(500).json({ error });
  }
});

// app.listen(PORT, () => {
//   console.log(`Backend is running on ${PORT}`);
// });
if (require.main === module) Promise.all([
  pool.query("SELECT auth_version,must_change_password FROM tbl_users LIMIT 0"),
  pool.query("SELECT token_hash FROM password_reset_tokens LIMIT 0"),
  pool.query("SELECT scope_key FROM password_reset_rate_limits LIMIT 0"),
  pool.query("SELECT title, module, targetUrl, readAt, dedupeKey, recipientRole FROM notifications LIMIT 0"),
  pool.query("SELECT id FROM notification_email_outbox LIMIT 0"),
  pool.query("SELECT id FROM payroll_documents LIMIT 0"),
  pool.query("SELECT salary_cycle_id FROM payroll_admin_deliveries LIMIT 0"),
  pool.query("SELECT rule_mode,cutoff_day FROM payroll_processing_settings LIMIT 0"),
]).then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
    void retryFailedEmails().catch((error) => console.error("Email retry failed:", error));
    setInterval(() => void retryFailedEmails().catch((error) => console.error("Email retry failed:", error)), 5 * 60 * 1000);
    void recoverPayrollDocuments().catch(error => console.error("Payroll recovery failed:", error));
    setInterval(() => void recoverPayrollDocuments().catch(error => console.error("Payroll recovery failed:", error)), 5 * 60 * 1000);
    const scanOverdueTodos = () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Karachi", year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date());
      void processOverdueTodos(today).catch((error) => console.error("Overdue Todo scan failed:",error));
    };
    scanOverdueTodos();
    setInterval(scanOverdueTodos,60 * 60 * 1000);
  });
}).catch(async () => {
  console.error("Required database schema is missing. Apply the password reset, notification, payroll, and payroll processing rule migrations before starting the server.");
  await pool.end();
  process.exitCode = 1;
});


export default app;
