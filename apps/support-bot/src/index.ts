import { Hono } from 'hono'
import { recordProcessedEvent } from '@openbookings/db'
import { verifyChatwootSignature } from './chatwoot/signature'
import { assertRequiredEnv, env } from './env'
import { processConversation } from './process'
import { sendSupportReplyNotification } from './support/notify'
import { handleSupportEvent, type SupportWebhookPayload } from './support/webhook'
import {
  enqueueProcessConversation,
  verifyTaskRequest,
  type ProcessConversationPayload,
  type SupportReplyNotifyPayload,
} from './tasks'
import { trace } from './trace'

// Only when this file is the entrypoint — importing it (tests) must not
// require the production env set.
if (import.meta.main) assertRequiredEnv()

const app = new Hono()

app.get('/', (c) => {
  return c.text('OpenBookings support bot')
})

/**
 * Chatwoot webhook. Verifies the HMAC, dedupes by event id, enqueues a Cloud
 * Task, and acks immediately — no Mistral/DB work happens on this path.
 */
app.post('/webhooks/chatwoot', async (c) => {
  const rawBody = await c.req.text()
  const signatureOk = verifyChatwootSignature(
    rawBody,
    c.req.header('X-Chatwoot-Signature'),
    c.req.header('X-Chatwoot-Timestamp'),
    env.chatwootWebhookSecret,
  )
  if (!signatureOk) {
    trace('webhook', 'signature rejected')
    return c.json({ error: 'invalid signature' }, 401)
  }
  trace('webhook', 'signature ok')

  let payload: {
    event?: string
    id?: number
    content?: string | null
    message_type?: string | number
    private?: boolean
    // `sender` on an incoming message is the contact; `conversation.meta.sender`
    // is the same contact and is the field present on some Chatwoot versions.
    sender?: { email?: string | null; identifier?: string | null }
    inbox?: { id?: number }
    conversation?: {
      id?: number
      inbox_id?: number
      channel?: string
      custom_attributes?: Record<string, unknown> | null
      meta?: { sender?: { email?: string | null; identifier?: string | null } }
    }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    trace('webhook', 'invalid json body')
    return c.json({ error: 'invalid json' }, 400)
  }

  // Only public incoming guest messages start a bot turn. Outgoing/private/
  // activity messages (including our own replies) are acked and dropped —
  // processing them would loop the bot on itself.
  const isIncoming = payload.message_type === 'incoming' || payload.message_type === 0
  const conversationId = payload.conversation?.id
  if (
    payload.event !== 'message_created' ||
    !isIncoming ||
    payload.private === true ||
    typeof payload.id !== 'number' ||
    typeof conversationId !== 'number' ||
    !payload.content?.trim()
  ) {
    trace('webhook', 'ignored', {
      event: payload.event,
      messageType: payload.message_type,
      private: payload.private,
    })
    return c.json({ ok: true, ignored: true })
  }

  // Host tickets come from the Business support API inbox and get the host
  // agent; everything else is guest support. An API-channel conversation that
  // isn't the configured business inbox is dropped rather than guessed at: a
  // host's email must never reach the guest tools.
  const inboxId = payload.inbox?.id ?? payload.conversation?.inbox_id
  const businessInboxId = env.businessInboxId
  const isHostTicket = businessInboxId !== null && inboxId === businessInboxId
  if (!isHostTicket && payload.conversation?.channel === 'Channel::Api') {
    trace('webhook', 'ignored: API inbox is not the configured business inbox', { inboxId })
    return c.json({ ok: true, ignored: true })
  }
  if (isHostTicket && !(env.supportChatEnabled && env.supportAssistantEnabled)) {
    trace('webhook', 'ignored: host assistant is switched off')
    return c.json({ ok: true, ignored: true })
  }

  // Identity for the whole turn, fixed here from the signed webhook body. Every
  // booking lookup downstream is scoped to this address; an anonymous contact
  // (null) can reach no booking data at all.
  const guestEmail = isHostTicket
    ? null
    :
    payload.sender?.email?.trim().toLowerCase() ||
    payload.conversation?.meta?.sender?.email?.trim().toLowerCase() ||
    null

  const eventId = `message_created:${payload.id}`
  trace('webhook', 'received', { eventId, conversationId, identified: guestEmail !== null })
  const firstDelivery = await recordProcessedEvent(eventId)
  if (!firstDelivery) {
    trace('webhook', 'duplicate delivery, dropping', { eventId })
    return c.json({ ok: true, duplicate: true })
  }

  const attrs = payload.conversation?.custom_attributes ?? {}
  const attr = (key: string) => (typeof attrs[key] === 'string' ? (attrs[key] as string) : null)
  await enqueueProcessConversation({
    eventId,
    conversationId,
    messageId: payload.id,
    content: payload.content,
    guestEmail,
    ...(isHostTicket
      ? {
          audience: 'host' as const,
          // The contact identifier is the business user id; Chatwoot only
          // accepts it with our server's HMAC, so the chat can't forge it.
          hostUserId:
            payload.sender?.identifier?.trim() || payload.conversation?.meta?.sender?.identifier?.trim() || null,
          ticket: { category: attr('category'), linkedType: attr('linked_type'), linkedId: attr('linked_id') },
        }
      : {}),
  })
  trace('webhook', 'enqueued', { eventId })
  return c.json({ ok: true })
})

/**
 * Business support webhook: a separate Chatwoot account webhook with its own
 * secret. Keeps support_tickets in step and schedules reply emails; it never
 * replies to anyone. Off unless SUPPORT_CHAT_ENABLED.
 */
app.post('/webhooks/business-support', async (c) => {
  if (!env.supportChatEnabled) return c.json({ ok: true, ignored: true })
  const rawBody = await c.req.text()
  const signatureOk = verifyChatwootSignature(
    rawBody,
    c.req.header('X-Chatwoot-Signature'),
    c.req.header('X-Chatwoot-Timestamp'),
    env.supportWebhookSecret,
  )
  if (!signatureOk) {
    trace('support', 'signature rejected')
    return c.json({ error: 'invalid signature' }, 401)
  }
  let payload: SupportWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const result = await handleSupportEvent(payload)
  return c.json({ ok: true, ...result })
})

/**
 * Task callbacks — the slow paths. Only callable by our queue (Cloud Tasks
 * OIDC or a QStash signature). Non-2xx makes the queue retry; each handler is
 * idempotent, so retries never double-post or double-send.
 */
app.post('/tasks/process-conversation', async (c) => {
  const rawBody = await c.req.text()
  const authorized = await verifyTaskRequest({
    name: 'process-conversation',
    rawBody,
    headers: {
      authorization: c.req.header('Authorization'),
      queueName: c.req.header('X-CloudTasks-QueueName'),
      upstashSignature: c.req.header('Upstash-Signature'),
    },
  })
  if (!authorized) {
    trace('task', 'unauthorized request rejected')
    return c.json({ error: 'unauthorized' }, 403)
  }

  let payload: ProcessConversationPayload
  try {
    payload = JSON.parse(rawBody) as ProcessConversationPayload
  } catch {
    return c.json({ ok: false, error: 'malformed payload' })
  }
  if (
    typeof payload?.eventId !== 'string' ||
    typeof payload?.conversationId !== 'number' ||
    typeof payload?.content !== 'string'
  ) {
    trace('task', 'malformed payload, dropping')
    // Malformed task body will never become valid — 200 so the queue drops it.
    return c.json({ ok: false, error: 'malformed payload' })
  }

  trace('task', 'picked up', { eventId: payload.eventId, conversationId: payload.conversationId })
  await processConversation(payload)
  trace('task', 'done', { eventId: payload.eventId })
  return c.json({ ok: true })
})

app.post('/tasks/support-reply-notify', async (c) => {
  const rawBody = await c.req.text()
  const authorized = await verifyTaskRequest({
    name: 'support-reply-notify',
    rawBody,
    headers: {
      authorization: c.req.header('Authorization'),
      queueName: c.req.header('X-CloudTasks-QueueName'),
      upstashSignature: c.req.header('Upstash-Signature'),
    },
  })
  if (!authorized) return c.json({ error: 'unauthorized' }, 403)

  let payload: SupportReplyNotifyPayload
  try {
    payload = JSON.parse(rawBody) as SupportReplyNotifyPayload
  } catch {
    return c.json({ ok: false, error: 'malformed payload' })
  }
  if (typeof payload?.conversationId !== 'number' || typeof payload?.messageAt !== 'string') {
    return c.json({ ok: false, error: 'malformed payload' })
  }
  await sendSupportReplyNotification(payload)
  return c.json({ ok: true })
})

export default app
