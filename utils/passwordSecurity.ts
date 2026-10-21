import { createHash, randomBytes } from "crypto";

export const createResetToken = (): string => randomBytes(32).toString("hex");
export const hashResetToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const passwordValidationError = (password: unknown, confirmation: unknown): string | null => {
  if (typeof password !== "string" || typeof confirmation !== "string") {
    return "Password and confirmation are required";
  }
  if (password !== confirmation) return "Passwords do not match";
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be at least 8 characters and at most 72 bytes";
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return "Password must include uppercase, lowercase, number, and special character";
  }
  return null;
};
