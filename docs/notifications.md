# MyDesk notifications

Apply the database extension once per environment before starting the backend:

```sh
npx ts-node scripts/applyNotificationMigration.ts
```

The script preserves existing `notifications` rows and can be run again. It adds notification metadata and a durable `notification_email_outbox`. The backend checks for these columns at startup.

Set `FRONTEND_URL` and the backend-only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `SMTP_USE_TLS` values. See `.env.example`. When SMTP is unavailable, email remains in the outbox with a failure reason. The backend retries pending and failed messages on startup and every five minutes, up to five attempts. Sending a mail never changes the result of the attendance, leave, or WFH action.

Notification recipients are active administrators and roles with the Attendance module grant from `access_control`. Each event stores a unique key so retries cannot insert or send the same event twice. Existing notification rows remain readable.

Projects and Todos use the same notification and email services. Project status recipients are current assignees and active users authorized for the Projects module, excluding the actor. Todo status recipients are the assignee and creator, excluding the actor; overdue Todos also notify the creator when that user has the Performance module grant. The backend scans overdue Todos at startup and hourly. A Todo/deadline pair gets one overdue notification per recipient.

The current database accepts Project statuses `New`, `Working`, and `Completed`; notification text displays `Working` as â€œIn Progress.â€ It accepts Todo statuses `Pending`, `Defer`, and `Completed`; a `Completed` to `Pending` change is described as reopened. The existing forms do not offer Project `On Hold`/`Cancelled` or Todo `In Progress`/`Reopened` values.

Employee creation, password reset, promotion approval, resignation, and employee information changes also use the existing notification table and email service. Apply `database/migrations/20261007_employee_credentials.sql` once before starting the backend, or run `npx ts-node scripts/applyEmployeeCredentials.ts` for an idempotent local migration. New employee and administrator-reset temporary passwords are generated on the backend, hashed in `tbl_users`, sent directly through SMTP after the account write succeeds, and never placed in `notification_email_outbox`. Password reset links are also sent directly so their raw tokens are never stored in the outbox; only token hashes are stored in `password_reset_tokens`. Ordinary employee event and password-change confirmation emails continue to use the retryable outbox. A failed welcome or reset email does not undo the account write; the administrator can send another reset or the employee can use Forgot password once SMTP is configured.

Checks without external email delivery:

```sh
npx ts-node tests/notificationFoundation.test.ts
npx ts-node tests/notificationEvents.test.ts
npx ts-node tests/notificationHttp.integration.ts
npx ts-node tests/notificationEmail.integration.ts
npx ts-node tests/employeeCredentials.integration.ts
npx ts-node tests/projectTodoEvents.test.ts
npx ts-node tests/projectTodoHttp.integration.ts
```

With the frontend on port 5173, backend on port 3002, and local Chrome installed, run `npx ts-node tests/notificationBell.browser.ts` to check the bell, sound, route navigation, read state, and mobile panel.
Run `npx ts-node tests/projectTodoBell.browser.ts` for Project and Todo detail links and Project sound behavior.
