import dotenv from "dotenv";

dotenv.config();

const configuredUrl = process.env.PASSWORD_RESET_URL;
if (!configuredUrl || !process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
  throw new Error("PASSWORD_RESET_URL, RESEND_API_KEY, and FROM_EMAIL are required for password reset");
}

const parsedUrl = new URL(configuredUrl);
if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname))) {
  throw new Error("PASSWORD_RESET_URL must use HTTPS outside localhost");
}

export const passwordResetUrl = parsedUrl;
