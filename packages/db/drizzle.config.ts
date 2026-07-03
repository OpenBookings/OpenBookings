import { defineConfig } from "drizzle-kit";

const connectionString =
  process.env.ENV_TYPE === "dev" ? process.env.DEV_DATABASE_URL : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DATABASE_URL (or DEV_DATABASE_URL with ENV_TYPE=dev) before running drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: connectionString,
  },
});
