import { mock } from "bun:test";

// "server-only" throws on import outside a Server Component; tests run outside Next.
mock.module("server-only", () => ({}));
