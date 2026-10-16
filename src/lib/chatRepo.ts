/** 聊天数据仓库 */
import { db } from './db'
import type { AIConfig, ChatMessage, ChatRole, Conversation } from './types'
import { uid } from './utils'

export async function createConversation(cfg: AIConfig | null): Promise<Conversation> {
  const now = Date.now()
  const conv: Conversation = {
    id: uid('conv-'),
    title: '新对话',
    aiConfigId: cfg?.id ?? null,
    providerName: cfg?.providerName ?? '',
    model: cfg?.model ?? '',
    createdAt: now,
    updatedAt: now,
    kind: 'chat',
  }
  await db.conversations.put(conv)
  return conv
}

export async function addMessage(msg: {
  conversationId: string
  role: ChatRole
  content: string
  model?: string
  providerName?: string
  status?: ChatMessage['status']
}): Promise<ChatMessage> {
  const m: ChatMessage = {
    id: uid('m-'),
    createdAt: Date.now(),
    ...msg,
  }
  await db.messages.put(m)
  await touchConversation(msg.conversationId)
  return m
}

export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
  const cur = await db.messages.get(id)
  if (!cur) return
  await db.messages.put({ ...cur, ...patch })
}

export async function deleteMessage(id: string): Promise<void> {
  await db.messages.delete(id)
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const list = await db.messages.where('conversationId').equals(conversationId).toArray()
  return list.sort((a, b) => a.createdAt - b.createdAt)
}

export async function touchConversation(id: string): Promise<void> {
  const c = await db.conversations.get(id)
  if (c) await db.conversations.put({ ...c, updatedAt: Date.now() })
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const c = await db.conversations.get(id)
  if (c) await db.conversations.put({ ...c, title: title.slice(0, 60) || '新对话' })
}

/** 用首条用户消息自动命名 */
export async function autoTitle(id: string): Promise<void> {
  const c = await db.conversations.get(id)
  if (!c || c.title !== '新对话') return
  const msgs = await listMessages(id)
  const firstUser = msgs.find((m) => m.role === 'user')
  if (firstUser) {
    const title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 24)
    if (title) await renameConversation(id, title)
  }
}

export async function deleteConversation(id: string): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.messages.where('conversationId').equals(id).delete()
    await db.conversations.delete(id)
  })
}

export async function clearConversationMessages(id: string): Promise<void> {
  await db.messages.where('conversationId').equals(id).delete()
  await touchConversation(id)
}

export async function setConversationModel(
  id: string,
  cfg: AIConfig
): Promise<void> {
  const c = await db.conversations.get(id)
  if (!c) return
  await db.conversations.put({
    ...c,
    aiConfigId: cfg.id,
    providerName: cfg.providerName,
    model: cfg.model,
    updatedAt: Date.now(),
  })
}
