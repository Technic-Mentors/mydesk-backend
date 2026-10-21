import assert from "node:assert/strict";
import net from "node:net";
import pool from "../database/db";
import { deliverEmail, queueEmail } from "../services/emailService";

async function main() {
  const key = `smtp-test:${Date.now()}:${Math.random()}`;
  const prior = { host:process.env.SMTP_HOST,port:process.env.SMTP_PORT,from:process.env.SMTP_FROM_EMAIL,tls:process.env.SMTP_USE_TLS,user:process.env.SMTP_USERNAME };
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    socket.write("220 localhost ESMTP test\r\n");
    let buffer = "";
    let dataMode = false;
    let mail = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0,index); buffer = buffer.slice(index+2);
        if (dataMode) {
          if (line === ".") { messages.push(mail); mail=""; dataMode=false; socket.write("250 Queued\r\n"); }
          else mail += `${line}\n`;
        } else if (/^EHLO /i.test(line) || /^HELO /i.test(line)) socket.write("250-localhost\r\n250 OK\r\n");
        else if (/^DATA$/i.test(line)) { dataMode=true; socket.write("354 End data with .\r\n"); }
        else if (/^QUIT$/i.test(line)) { socket.write("221 Bye\r\n"); socket.end(); }
        else socket.write("250 OK\r\n");
      }
    });
  });
  try {
    delete process.env.SMTP_HOST;
    process.env.SMTP_FROM_EMAIL = "MyDesk <mydesk@example.invalid>";
    await queueEmail("employee@example.invalid","Attendance Clock In","Hello Employee, clock in at 09:05.","/users/attendance",key);
    let rows: any[] = [];
    for (let attempt=0; attempt<50; attempt++) {
      [rows] = await pool.query<any[]>("SELECT id,status,attempts FROM notification_email_outbox WHERE dedupeKey=?",[key]);
      if (rows[0]?.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve,20));
    }
    assert.equal(rows[0]?.status,"failed","missing SMTP should leave a retryable failed email");
    await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
    const address=server.address(); assert(address && typeof address !== "string");
    process.env.SMTP_HOST="127.0.0.1";
    process.env.SMTP_PORT=String(address.port);
    process.env.SMTP_USE_TLS="false";
    delete process.env.SMTP_USERNAME;
    await deliverEmail(rows[0].id);
    const [sent]: any = await pool.query("SELECT status,attempts,bodyHtml FROM notification_email_outbox WHERE id=?",[rows[0].id]);
    assert.equal(sent[0].status,"sent");
    assert.equal(messages.length,1);
    assert(messages[0].includes("MyDesk"));
    assert(sent[0].bodyHtml.includes("clock in at 09:05"));
    await queueEmail("employee@example.invalid","Attendance Clock In","Again","/users/attendance",key);
    await new Promise((resolve) => setTimeout(resolve,50));
    assert.equal(messages.length,1,"duplicate event must not send again");
    console.log("Local SMTP failure, retry, branded delivery, and email deduplication passed");
  } finally {
    await pool.query("DELETE FROM notification_email_outbox WHERE dedupeKey=?",[key]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [name,value] of Object.entries({ SMTP_HOST:prior.host,SMTP_PORT:prior.port,SMTP_FROM_EMAIL:prior.from,SMTP_USE_TLS:prior.tls,SMTP_USERNAME:prior.user })) {
      if (value === undefined) delete process.env[name]; else process.env[name]=value;
    }
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode=1; });
