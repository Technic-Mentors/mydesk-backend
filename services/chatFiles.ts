import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const chatUploadDir = path.resolve(process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "chat"));

const extension = (originalName: string) => {
  const suffix = path.extname(originalName).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(suffix) ? suffix : "";
};

export const legacyChatFileName = (messageId: number, originalName: string) =>
  `legacy-${messageId}${extension(originalName)}`;

export const chatFilePath = (storedName: string) => {
  if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|legacy-[1-9]\d*)(?:\.[a-z0-9]{1,12})?$/.test(storedName))
    throw new Error("Invalid chat file name");
  return path.join(chatUploadDir, storedName);
};

export async function writeChatFile(data: Buffer, originalName: string) {
  await fs.mkdir(chatUploadDir, { recursive: true });
  const storedName = `${randomUUID()}${extension(originalName)}`;
  await fs.writeFile(chatFilePath(storedName), data, { flag: "wx" });
  return storedName;
}

export async function readChatFile(storedName: string) {
  return fs.readFile(chatFilePath(storedName));
}

export async function removeChatFile(storedName: string) {
  try { await fs.unlink(chatFilePath(storedName)); }
  catch (error: any) { if (error?.code !== "ENOENT") throw error; }
}
