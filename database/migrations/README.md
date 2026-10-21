# Database update for this MyDesk handoff

For an existing MyDesk database, import **one file**:

`20261019_mydesk_full_upgrade.sql`

Select the correct database and back it up first. The file covers the schema changes in this handoff and can be rerun. Do not also import the older individual SQL files.

Read `USB_HANDOFF_README.md` in the workspace root for the full order covering database, backend, frontend, checks, and rollback. Old chat attachments may need the separate one-time filesystem migration described there. The other files in this directory are historical migrations kept for reference.

## Payroll processing timing

The full upgrade includes `payroll_processing_settings`. For databases already upgraded before this feature, apply `20261019_payroll_processing_rule.sql` once before starting the updated backend. It is idempotent and defaults to **After Month End**. Admins with Payroll permission can then select **After Configured Cutoff Date** and save a cutoff day from 1 to 31 under Payroll ? Configure Salary. Day 31 means the last day of shorter months; payroll becomes available the following day. The backend evaluates the date in Asia/Karachi and always rejects future months.
