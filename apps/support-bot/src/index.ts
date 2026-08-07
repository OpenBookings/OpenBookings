import { Hono } from 'hono'
import { recordProcessedEvent } from '@openbookings/db'
import { verifyChatwootSignature } from './chatwoot/signature'
import { assertRequiredEnv, env } from './env'
import { processConversation } from './process'
import { enqueueProcessConversation, verifyCloudTasksRequest, type ProcessConversationPayload } from './tasks'
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
    conversation?: { id?: number }
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

  const eventId = `message_created:${payload.id}`
  trace('webhook', 'received', { eventId, conversationId })
  const firstDelivery = await recordProcessedEvent(eventId)
  if (!firstDelivery) {
    trace('webhook', 'duplicate delivery, dropping', { eventId })
    return c.json({ ok: true, duplicate: true })
  }

  await enqueueProcessConversation({
    eventId,
    conversationId,
    messageId: payload.id,
    content: payload.content,
  })
  trace('webhook', 'enqueued', { eventId })
  return c.json({ ok: true })
})

/**
 * Cloud Tasks callback — the slow path (Mistral loop, Chatwoot posts). Only
 * callable by our queue's service account (OIDC). Non-2xx makes Cloud Tasks
 * retry; the replied_at guard inside processConversation keeps retries from
 * double-posting.
 */
app.post('/tasks/process-conversation', async (c) => {
  const authorized = await verifyCloudTasksRequest({
    authorization: c.req.header('Authorization'),
    queueName: c.req.header('X-CloudTasks-QueueName'),
  })
  if (!authorized) {
    trace('task', 'unauthorized request rejected')
    return c.json({ error: 'unauthorized' }, 403)
  }

  const payload = (await c.req.json()) as ProcessConversationPayload
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

export default app
