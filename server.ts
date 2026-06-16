import express, { Application, Request, Response } from "express";

import path from "path";
import cloudinary from "./utils/cloudinary";
import bodyParser from "body-parser";
import dotenv from "dotenv";

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
import systemUsersRoutes from "./routes/systemuser.routes";
import accesscontrolRoutes from "./routes/accesscontrol.routes";
import accountReportRoutes from "./routes/accountreport.routes";
import businessVariableRoutes from "./routes/businessvariable.routes";
import configOvertimeRoutes from "./routes/configOvertime.routes";
import emailRoutes from "./routes/email.routes";

import session from "express-session";
const app: Application = express();
const PORT: number = 3001;

dotenv.config();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(bodyParser.json());

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
app.use("/api/admin", userRoutes);
app.use("/api/admin", employeelifelineRoutes);
app.use("/api/admin", customerRoutes);
app.use("/api/admin", supplierRoutes);
app.use("/api/admin", attendanceRuleRoutes);
app.use("/api/admin", markAttendanceRoutes);
app.use("/api", userAttendanceRoutes);
app.use("/api", leaveRoutes);
app.use("/api/admin", holidaysRoutes);
app.use("/api/admin", employeewithdrawRoutes);
app.use("/api/admin", projectcategoryRoutes);
app.use("/api/admin", projectsRoutes);
app.use("/api", assignprojectRoutes);
app.use("/api", todoRoutes);
app.use("/api", progressRoutes);
app.use("/api/admin", expensecategoriesRoutes);
app.use("/api/admin", expensesRoutes);
app.use("/api/admin", assetcategoryRoutes);
app.use("/api/admin", assetRoutes);
app.use("/api/admin", jobRoutes);
app.use("/api/admin", applicantRoutes);
app.use("/api/admin", saleRoutes);
app.use("/api/admin", paymentRoutes);
app.use("/api/admin", quotationRoutes);
app.use("/api/admin", calendarRoutes);
app.use("/api/admin", configuresalaryRoutes);
app.use("/api", employeeaccountRoutes);
app.use("/api", overtimeRoutes);
app.use("/api", advancesalaryRoutes);
app.use("/api", loanRoutes);
app.use("/api/admin", customeraccountRoutes);
app.use("/api/admin", supplieraccountRoutes);
app.use("/api", promotionRoutes);
app.use("/api", resignationRoutes);
app.use("/api", rejoinRoutes);
app.use("/api", userDashboardRoutes);
app.use("/api", salaryCycleRoutes);
app.use("/api/admin", rolesRoutes);
app.use("/api/admin", systemUsersRoutes);
app.use("/api/admin", accesscontrolRoutes);
app.use("/api/admin", accountReportRoutes);
app.use("/api/admin", businessVariableRoutes);
app.use("/api/admin", configOvertimeRoutes);
app.use("/api/admin", emailRoutes);

app.get("/", (req: Request, res: Response) => {
  res.send("Backend is up and running 🚀");
});

app.get("/cloudinary-test", async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Backend is running on ${PORT}`);
});
// app.listen(PORT, "0.0.0.0", () => {
//   console.log(`Backend running on http://0.0.0.0:${PORT}`);
// });


export default app;
