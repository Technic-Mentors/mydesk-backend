import "dotenv/config";
import assert from "node:assert/strict";
import net from "node:net";
import { Request, Response } from "express";
import { sendReportEmail } from "../controllers/email.controller";

async function main() {
  let deliveredMail = "";
  const smtp = net.createServer((socket) => {
    socket.write("220 localhost ESMTP test\r\n");
    let buffer = "";
    let mail = "";
    let receivingData = false;

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (receivingData) {
          if (line === ".") {
            deliveredMail = mail;
            mail = "";
            receivingData = false;
            socket.write("250 Queued\r\n");
          } else {
            mail += line + "\n";
          }
        } else if (/^EHLO |^HELO /i.test(line)) {
          socket.write("250-localhost\r\n250 OK\r\n");
        } else if (line === "DATA") {
          receivingData = true;
          socket.write("354 End data\r\n");
        } else if (line === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });

  const previous = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    from: process.env.SMTP_FROM_EMAIL,
    tls: process.env.SMTP_USE_TLS,
    username: process.env.SMTP_USERNAME,
  };

  try {
    await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
    const address = smtp.address();
    assert(address && typeof address !== "string");
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(address.port);
    process.env.SMTP_FROM_EMAIL = "MyDesk <reports@example.invalid>";
    process.env.SMTP_USE_TLS = "false";
    delete process.env.SMTP_USERNAME;

    const response: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    };
    const request = {
      body: {
        email: "recipient@example.invalid",
        reportData: [{ name: "Alex & Sam", status: "Active" }],
        columns: [{ label: "Name", key: "name" }, { label: "Status", key: "status" }],
        business: { name: "Employee Report" },
      },
    };

    await sendReportEmail(request as Request, response as Response);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.match(deliveredMail, /report\.pdf/i);
    assert.match(deliveredMail, /Content-Type: application\/pdf/i);
    assert.match(deliveredMail, /JVBERi0/);
    console.log("Report PDF delivered through SMTP");
  } finally {
    for (const [name, value] of Object.entries({
      SMTP_HOST: previous.host,
      SMTP_PORT: previous.port,
      SMTP_FROM_EMAIL: previous.from,
      SMTP_USE_TLS: previous.tls,
      SMTP_USERNAME: previous.username,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
