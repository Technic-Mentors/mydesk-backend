import dotenv from "dotenv";

dotenv.config();

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret?.trim()) {
    throw new Error("JWT_SECRET is required in the backend environment");
  }
  return secret;
};

// Validate during module loading so the backend fails before it starts listening.
getJwtSecret();
