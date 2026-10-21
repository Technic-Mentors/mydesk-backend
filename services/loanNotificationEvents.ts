import { MODULE } from "../permissionModel";
import { notifyUser } from "./notificationService";

const money = (amount: number) => "Rs " + amount.toLocaleString("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export async function loanCreatedEvent(loanId: number, employeeId: number, amount: number, installment: number): Promise<void> {
  await notifyUser(employeeId, {
    title: "Loan added",
    message: `A loan of ${money(amount)} was added to your account. Planned installment: ${money(installment)}.`,
    type: "LOAN_CREATED",
    module: MODULE.Payroll,
    referenceId: loanId,
    targetUrl: `/user/payroll?viewId=${loanId}`,
    dedupeKey: `loan:${loanId}:created:u${employeeId}`,
  });
}

export async function loanDeductedEvent(cycleId: number, year: number, month: string, employeeId: number, amount: number): Promise<void> {
  await notifyUser(employeeId, {
    title: "Loan installment deducted",
    message: `${money(amount)} was deducted from your ${month} ${year} salary for your loan.`,
    type: "LOAN_DEDUCTED",
    module: MODULE.Payroll,
    referenceId: cycleId,
    targetUrl: "/user/payroll",
    dedupeKey: `loan:cycle:${cycleId}:deducted:u${employeeId}`,
  });
}
