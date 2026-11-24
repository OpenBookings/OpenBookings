import { Hono } from "hono";
import { assertRequiredEnv } from "./env";

// Only when this file is the entrypoint — importing it (tests) must not
// require the production env set.
if (import.meta.main) assertRequiredEnv();

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

export default app;
