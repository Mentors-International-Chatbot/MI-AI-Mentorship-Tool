/**
 * Shared message serializer for chat API routes.
 * Both /api/chat/history and /api/chat/poll use this to ensure
 * all message fields (including metadata) are consistently passed through.
 */

export interface ClientMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  senderType: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface DbMessage {
  id: string;
  role: string;
  content: string;
  senderType?: string | null;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
}

/**
 * Convert a DB message to client format.
 * Returns null for messages that should not be displayed (system roles, welcome trigger).
 */
export function toClientMessage(m: DbMessage): ClientMessage | null {
  // Normalize mentor → assistant for display
  const displayRole = m.role === 'mentor' ? 'assistant' : m.role;

  // Only pass through user and assistant messages
  if (displayRole !== 'user' && displayRole !== 'assistant') {
    return null;
  }

  // Filter out the welcome trigger message (not meant to be displayed)
  if (m.role === 'user' && m.content === '__welcome__') {
    return null;
  }

  return {
    id: m.id,
    role: displayRole as 'user' | 'assistant',
    content: m.content,
    senderType: m.senderType ?? null,
    createdAt: m.createdAt.toISOString(),
    metadata: m.metadata ?? null,
  };
}
