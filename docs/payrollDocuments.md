# Payroll documents and delivery

Run `npx ts-node --transpile-only scripts/applyPayrollSnapshots.ts`, then
`npx ts-node --transpile-only scripts/applyPayrollDocuments.ts` against each database
before starting this backend. The second migration is idempotent. It adds immutable
salary breakdown fields and keeps delivery status in the database. New PDFs are generated in memory and attached to email.
`payroll_admin_deliveries` tracks each authorized recipient separately.

A successful Salary Cycle transaction commits before the document job starts.
The job generates one PDF per employee and one consolidated summary, then sends
employee PDF attachments and an Admin summary with individual payslip attachments through the existing
SMTP service. The Admin email includes individual payslips and links to delivery status in Payroll. The app does not offer PDF downloads.
The existing notification service creates deduplicated, clickable employee and
Admin events. The existing bell handles sound and marking notices read.

`GET /api/payroll/documents` lists only the signed-in employee's documents,
except that users with Payroll permission can see all documents and Admin
recipient status. `?cycleId=<id>` filters to one cycle.
PDF downloads and previews are disabled. `POST /api/payroll/cycles/:id/retry-delivery` retries failed
mail for authorized Payroll users. `POST /api/payroll/documents/:id/resend` and
`POST /api/payroll/cycles/:id/resend-summary` are explicit Admin actions for a
single employee or the requesting authorized Admin, respectively. No request
accepts an arbitrary recipient address.

SMTP failure never rolls back a completed salary cycle. An interrupted `Sending`
state older than 15 minutes is marked `Failed` with an unconfirmed outcome;
recovery does not resend it automatically. An Admin should check the recipient
inbox before using Retry email. Pending email delivery resumes after restart.

For older cycles, earned basic pay and allowances are calculated from the saved gross amount and linked salary configuration. Fields without a reliable source are omitted. Previously emailed attachments cannot be changed; an authorized Admin can use
`Email summary to me` or `Resend email` when a corrected copy is needed.

Checks: `npx tsc --noEmit --pretty false`, `npx ts-node --transpile-only
tests/salaryCycle.test.ts`, `tests/payrollDocuments.test.ts`,
`tests/payrollDocuments.access.integration.ts`, and
`tests/payrollDocuments.flow.integration.ts`. The flow test creates a disposable
MySQL database, uses Chrome to generate actual PDFs, stubs SMTP, verifies mail
attachments and notifications, simulates SMTP failures, and drops the database.
`tests/payrollDocuments.browser.ts` checks both document panels at seven widths
against the local frontend and backend servers.
