import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clientApi, ClientApiError, handOffToHuman, identifierHash } from "./index";

type Call = { url: string; method: string; headers: Headers; body: BodyInit | null | undefined };
const calls: Call[] = [];
let responses: Array<{ status: number; body: unknown }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls.length = 0;
  responses = [];
  process.env.CHATWOOT_BASE_URL = "https://chat.example.test/";
  process.env.CHATWOOT_INBOX_ID = "inbox token/with space";
  process.env.CHATWOOT_HMAC_TOKEN = "test-hmac-token";
  process.env.CHATWOOT_API_TOKEN = "bot-token";
  process.env.CHATWOOT_ACCOUNT_ID = "7";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("identifierHash", () => {
  test("matches Chatwoot's hex HMAC-SHA256", () => {
    // `printf user_123 | openssl dgst -sha256 -hmac test-hmac-token`
    expect(identifierHash("user_123", "test-hmac-token")).toBe(
      "b1067e1a9611b2574a7250e440a6e2bf8e60245dd90661d85f2e82200fe99a13",
    );
  });
});

describe("Client API", () => {
  test("createContact signs the identifier and returns the credentials", async () => {
    responses.push({ status: 200, body: { id: 4, source_id: "src-1", pubsub_token: "pub-1" } });
    const contact = await clientApi.createContact({ identifier: "user_123", name: "Sam", email: "s@x.test" });

    expect(contact).toEqual({ contactId: 4, sourceId: "src-1", pubsubToken: "pub-1" });
    expect(calls[0]!.url).toBe(
      "https://chat.example.test/public/api/v1/inboxes/inbox%20token%2Fwith%20space/contacts",
    );
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      identifier: "user_123",
      identifier_hash: "b1067e1a9611b2574a7250e440a6e2bf8e60245dd90661d85f2e82200fe99a13",
      name: "Sam",
      email: "s@x.test",
    });
  });

  test("a contact without credentials is an error, not a half-stored row", async () => {
    responses.push({ status: 200, body: { id: 4 } });
    await expect(
      clientApi.createContact({ identifier: "u", name: "n", email: "e@x.test" }),
    ).rejects.toBeInstanceOf(ClientApiError);
  });

  test("conversation paths escape the source id", async () => {
    responses.push({ status: 200, body: [] });
    await clientApi.listMessages("a/b", 12);
    expect(calls[0]!.url).toEndWith("/contacts/a%2Fb/conversations/12/messages");
  });

  test("messages with files go up as multipart attachments[]", async () => {
    responses.push({ status: 200, body: { id: 1, content: "hi", message_type: 0, created_at: 1 } });
    const file = new File([new Uint8Array([1, 2, 3])], "receipt.pdf", { type: "application/pdf" });
    await clientApi.createMessage("src", 3, { content: "hi", echoId: "e1", files: [file] });

    const body = calls[0]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("content")).toBe("hi");
    expect(body.get("echo_id")).toBe("e1");
    expect((body.get("attachments[]") as File).name).toBe("receipt.pdf");
  });

  test("non-2xx responses throw ClientApiError with the status", async () => {
    responses.push({ status: 404, body: { error: "not found" } });
    const error = await clientApi.getConversation("src", 9).catch((e) => e);
    expect(error).toBeInstanceOf(ClientApiError);
    expect(error.status).toBe(404);
  });

  test("getInboxInfo reads timezone and working hours", async () => {
    responses.push({
      status: 200,
      body: { name: "Business support", timezone: "Europe/Amsterdam", working_hours: [{ day_of_week: 1 }] },
    });
    const info = await clientApi.getInboxInfo();
    expect(info.timezone).toBe("Europe/Amsterdam");
    expect(info.workingHours).toHaveLength(1);
  });
});

describe("handOffToHuman", () => {
  test("leaves a private note, then opens the conversation", async () => {
    await handOffToHuman(55, "Host asked for a person");

    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "https://chat.example.test/api/v1/accounts/7/conversations/55/messages"],
      ["POST", "https://chat.example.test/api/v1/accounts/7/conversations/55/toggle_status"],
    ]);
    expect(JSON.parse(String(calls[0]!.body))).toMatchObject({ private: true });
    expect(JSON.parse(String(calls[1]!.body))).toEqual({ status: "open" });
    expect(calls[0]!.headers.get("api_access_token")).toBe("bot-token");
  });
});
