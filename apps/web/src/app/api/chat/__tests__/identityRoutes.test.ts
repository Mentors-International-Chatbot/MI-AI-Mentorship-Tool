import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolveRequestIdentity: vi.fn(),
  getSocio: vi.fn(),
  getSocioProgress: vi.fn(),
  getMessages: vi.fn(),
  getMessagesWithSentiment: vi.fn(),
}));

vi.mock('@/lib/auth/requestIdentity', () => ({
  resolveRequestIdentity: mocks.resolveRequestIdentity,
}));

vi.mock('@/lib/repo', () => ({
  repo: {
    getSocio: mocks.getSocio,
    getSocioProgress: mocks.getSocioProgress,
    getMessages: mocks.getMessages,
    getMessagesWithSentiment: mocks.getMessagesWithSentiment,
  },
}));

import { GET as getHistory } from '../history/route';
import { GET as getPoll } from '../poll/route';

const canvasIdentity = {
  userId: 'socio-1',
  externalId: 'platform-1:subject-1',
  role: 'socio' as const,
  name: 'Canvas Learner',
  socioId: 'socio-1',
  channel: 'canvas' as const,
};

describe('chat transcript identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRequestIdentity.mockResolvedValue(canvasIdentity);
    mocks.getSocio.mockResolvedValue({ id: 'socio-1' });
    mocks.getSocioProgress.mockResolvedValue({
      currentLessonNumber: 1,
      completedLessons: [],
    });
    mocks.getMessages.mockResolvedValue([]);
    mocks.getMessagesWithSentiment.mockResolvedValue([]);
  });

  it('loads history using the Canvas channel and external id', async () => {
    const response = await getHistory(new NextRequest('http://localhost/api/chat/history'));

    expect(response.status).toBe(200);
    expect(mocks.getSocio).toHaveBeenCalledWith('canvas', 'platform-1:subject-1');
  });

  it('polls using the Canvas channel and external id', async () => {
    const response = await getPoll(new NextRequest('http://localhost/api/chat/poll?since=2026-08-20T00:00:00.000Z'));

    expect(response.status).toBe(200);
    expect(mocks.getSocio).toHaveBeenCalledWith('canvas', 'platform-1:subject-1');
  });

  it('keeps MI web mentor messages in the generic poll response', async () => {
    mocks.resolveRequestIdentity.mockResolvedValue({
      ...canvasIdentity,
      externalId: 'socio-mi',
      channel: 'web',
    });
    mocks.getMessagesWithSentiment.mockResolvedValue([{
      id: 'mentor-mi-1',
      socioId: 'socio-1',
      role: 'mentor',
      content: 'Hola, como vas?',
      senderType: 'mentor',
      createdAt: new Date('2026-08-20T12:00:00.000Z'),
      metadata: null,
    }]);

    const response = await getPoll(new NextRequest('http://localhost/api/chat/poll?since=2026-08-20T11:59:00.000Z'));
    const body = await response.json();

    expect(mocks.getSocio).toHaveBeenCalledWith('web', 'socio-mi');
    expect(body.messages).toEqual([expect.objectContaining({
      id: 'mentor-mi-1',
      role: 'assistant',
      senderType: 'mentor',
      content: 'Hola, como vas?',
    })]);
  });
});
