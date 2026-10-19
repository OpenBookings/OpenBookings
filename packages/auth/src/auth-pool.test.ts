import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import type { Pool } from "pg";
import { createAuthPool } from "./shared";

// Just enough of the Postgres wire protocol for pg to finish connecting and
// run one simple query: AuthenticationOk, ReadyForQuery(idle), and
// CommandComplete for any Query message.
const AUTH_OK = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
const READY = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
const COMMAND_COMPLETE = Buffer.concat([
  Buffer.from([0x43, 0, 0, 0, 13]),
  Buffer.from("SELECT 0\0"),
]);
const AUTH_FAILED_FIELDS = Buffer.from(
  "SFATAL\0C28P01\0Mpassword authentication failed\0\0",
);
const AUTH_FAILED = Buffer.concat([
  Buffer.from([0x45, 0, 0, 0, 4 + AUTH_FAILED_FIELDS.length]),
  AUTH_FAILED_FIELDS,
]);

/**
 * A fake Postgres that closes the first `drops` connections as soon as the
 * client sends its startup message, the way a connection through Neon's
 * pooler is cut while the compute is still waking up. Later connections
 * behave like a healthy server.
 */
async function fakePostgres(drops: number, { rejectAuth = false } = {}) {
  let connections = 0;
  const server: Server = createServer((socket: Socket) => {
    const index = connections++;
    let started = false;
    socket.on("data", (chunk) => {
      if (index < drops) {
        socket.end();
        return;
      }
      if (rejectAuth) {
        socket.end(AUTH_FAILED);
        return;
      }
      if (!started) {
        started = true;
        socket.write(Buffer.concat([AUTH_OK, READY]));
      } else if (chunk[0] === 0x51) {
        socket.write(Buffer.concat([COMMAND_COMPLETE, READY]));
      } else if (chunk[0] === 0x58) {
        socket.end();
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `postgres://user:pass@127.0.0.1:${port}/db`,
    connections: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("createAuthPool connect retry", () => {
  let server: Awaited<ReturnType<typeof fakePostgres>> | undefined;
  let pool: Pool | undefined;
  let warn: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await pool?.end();
    await server?.close();
    pool = undefined;
    server = undefined;
    warn.mockRestore();
  });

  test("retries a connection terminated during connect (promise form)", async () => {
    server = await fakePostgres(1);
    pool = createAuthPool(server.url);

    const client = await pool.connect();
    client.release();

    expect(server.connections()).toBe(2);
  });

  test("retries a connection terminated during connect (pool.query)", async () => {
    server = await fakePostgres(1);
    pool = createAuthPool(server.url);

    await pool.query("SELECT 1");

    expect(server.connections()).toBe(2);
  });

  test("retries only once", async () => {
    server = await fakePostgres(2);
    pool = createAuthPool(server.url);

    await expect(pool.connect()).rejects.toThrow("Connection terminated unexpectedly");
    expect(server.connections()).toBe(2);
  });

  test("does not retry other connect errors", async () => {
    server = await fakePostgres(0, { rejectAuth: true });
    pool = createAuthPool(server.url);

    await expect(pool.connect()).rejects.toThrow("password authentication failed");
    expect(server.connections()).toBe(1);
  });
});
