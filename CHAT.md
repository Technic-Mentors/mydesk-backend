# Chat

Run `npx ts-node database/migrations/applyChatMigration.ts` against each database before deploying the chat routes. The migration is repeatable and creates conversations, participants, messages, reactions, and presence. It moves existing chat attachments from MySQL into `uploads/chat` and backfills chats for active projects.

Chat is available to authenticated active users at `/chat`. Direct and group messages refresh every three seconds. Typing status expires after four seconds. New attachments are saved in `uploads/chat` (8 MB maximum) and downloaded only through an authenticated conversation route. The `/uploads/chat` public URL is blocked. Set `CHAT_UPLOAD_DIR` if the upload directory must be on persistent storage elsewhere; include that directory in backups together with the database. Clearing history affects only the current user; deleting a message removes it for everyone.

Direct chats require an administrator participant. Administrators can start direct chats with active employees; employees can start direct chats only with administrators. Existing direct chats between employees are hidden and cannot be used. Group and project chat membership follows their existing rules.

This implementation uses polling because myDesk does not have a websocket server. New messages create entries in the existing notification bell. Project chats are created and synchronized with assigned members when projects or assignments change. Online status reflects app activity in the last 40 seconds.
