import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

export const env = {
  port: Number(process.env.PORT) || 4000,
  saKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || "../sa.json",
} as const;
