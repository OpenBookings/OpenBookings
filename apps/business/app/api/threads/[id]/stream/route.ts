import { auth } from "@/lib/auth";
import { getThreadForParticipant } from "@openbookings/authz";
import { Client } from "pg";

export const dynamic = "force-dynamic";
// pg's Client needs a real TCP connection, so this can't run on the edge runtime.
export const runtime = "nodejs";

/**
 * LONG-LIVED CONNECTION: unlike every other route here, this one holds a
 * dedicated Postgres connection and an open HTTP response for as long as the
 * client stays subscribed — it occupies one Cloud Run concurrency slot for
 * that whole time, not just for a request/response round trip.
 *
 * apps/business's Cloud Run service (cloudbuild.business.yaml) sets no
 * --concurrency or --timeout, so it runs on Cloud Run defaults: concurrency
 * 80, request timeout 300s. The 300s timeout means Cloud Run force-closes
 * this connection every 5 minutes regardless of activity; EventSource
 * reconnects automatically client-side, but every open thread-view tab
 * still ties up a concurrency slot the whole time it's open, competing with
 * normal request traffic on the same instance. If host inboxes end up with
 * many tabs open concurrently, split this route onto its own Cloud Run
 * service with a much higher --concurrency (idle SSE holds cost ~nothing)
 * and --timeout 3600 (the max), leaving the main service's defaults alone —
 * deferred for this pass pending real concurrent-viewer numbers.
 *
 * Connections are deduped per thread per instance (see listenerRegistry
 * below): if two participants both land on the same container instance for
 * the same thread, they share one Postgres LISTEN connection instead of
 * two. This does NOT dedupe across instances (no cross-instance pubsub) —
 * with concurrency 80 and Cloud Run routing requests to any instance, two
 * viewers of the same thread will often still get separate connections.
 * That's an accepted tradeoff for this pass: it's a free reduction in the
 * common single-instance case, not a guarantee.
 */

type ThreadListener = {
  client: Client;
  subscribers: Set<(payload: string) => void>;
};

const listenerRegistry = new Map<string, Promise<ThreadListener>>();

async function createListener(threadId: string, connectionString: string): Promise<ThreadListener> {
  const channel = `thread_${threadId}`;
  const client = new Client({ connectionString });
  await client.connect();
  await client.query(`LISTEN "${channel}"`);

  const entry: ThreadListener = { client, subscribers: new Set() };
  client.on("notification", (msg) => {
    if (msg.channel !== channel) return;
    for (const send of entry.subscribers) send(msg.payload ?? "");
  });
  client.on("error", () => {
    // Connection died; drop the registry entry so the next subscriber
    // creates a fresh one instead of reusing a dead client.
    listenerRegistry.delete(threadId);
  });

  return entry;
}

function acquireListener(threadId: string, connectionString: string): Promise<ThreadListener> {
  let promise = listenerRegistry.get(threadId);
  if (!promise) {
    promise = createListener(threadId, connectionString);
    listenerRegistry.set(threadId, promise);
    promise.catch(() => listenerRegistry.delete(threadId));
  }
  return promise;
}

async function releaseListener(threadId: string, send: (payload: string) => void) {
  const promise = listenerRegistry.get(threadId);
  if (!promise) return;
  const entry = await promise.catch(() => null);
  if (!entry) return;

  entry.subscribers.delete(send);
  if (entry.subscribers.size > 0) return;

  listenerRegistry.delete(threadId);
  try {
    await entry.client.query(`UNLISTEN "thread_${threadId}"`);
  } catch {
    // connection may already be gone; nothing to clean up
  }
  await entry.client.end().catch(() => {});
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id: threadId } = await params;
  const participant = await getThreadForParticipant(session, threadId);
  if (!participant) return new Response("Not found", { status: 404 });

  // Deliberately NOT the pooled DATABASE_URL used everywhere else: Neon's
  // pgbouncer pooler (transaction mode) doesn't reliably deliver LISTEN
  // notifications, confirmed by hand against this project's DB — the
  // NOTIFY side (message send route) is fine on the pooled connection,
  // it's specifically LISTEN that needs a direct, non-pooled connection.
  const connectionString =
    process.env.ENV_TYPE === "dev" ? process.env.DEV_DATABASE_URL_DIRECT : process.env.DATABASE_URL_DIRECT;
  if (!connectionString) return new Response("Postgres not configured", { status: 500 });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const send = (controller: ReadableStreamDefaultController) => (payload: string) => {
    const id = (() => {
      try {
        return JSON.parse(payload)?.message?.id;
      } catch {
        return undefined;
      }
    })();
    const lines = id ? [`id: ${id}`, `data: ${payload}`] : [`data: ${payload}`];
    controller.enqueue(encoder.encode(lines.join("\n") + "\n\n"));
  };

  let boundSend: (payload: string) => void;

  const stream = new ReadableStream({
    async start(controller) {
      boundSend = send(controller);

      try {
        const listener = await acquireListener(threadId, connectionString);
        listener.subscribers.add(boundSend);
      } catch (err) {
        controller.error(err);
        return;
      }

      // Keeps intermediate proxies from treating the connection as idle.
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15000);

      req.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
        void releaseListener(threadId, boundSend);
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      void releaseListener(threadId, boundSend);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
