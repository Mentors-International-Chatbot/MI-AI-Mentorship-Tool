'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  type SupportedLanguage,
  isSupportedLanguage,
  DEFAULT_LANGUAGE,
  ASSESSMENT_STRINGS,
} from '@/lib/i18n/languages';

// ─── Types ───────────────────────────────────────────────────────────────

interface AssessmentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface SessionData {
  session: {
    id: string;
    lessonKey: string;
    blockId: string | null;
    status: 'pending' | 'in_progress' | 'completed';
    turnCount: number;
    attemptNumber: number;
    passedAt: string | null;
    completedAt: string | null;
    scores: Record<string, number> | null;
  };
  messages: AssessmentMessage[];
  config: {
    passing: {
      dimensionKey: string;
      threshold: number;
    };
    studentVisibleDimensionKeys: string[];
  };
}

interface StartResponse {
  sessionId: string;
  openingMessage: string;
  status: string;
}

interface MessageResponse {
  status: 'continue' | 'passed' | 'max_turns';
  response: string;
  scores?: Record<string, number>;
  requiresCompletion?: boolean;
}

interface CompleteResponse {
  status: string;
  message: string;
  passed?: boolean;
  scores?: Record<string, number>;
}

// ─── Component ───────────────────────────────────────────────────────────

export default function AssessmentPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
  const [messages, setMessages] = useState<AssessmentMessage[]>([]);
  const [status, setStatus] = useState<'pending' | 'in_progress' | 'completed' | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number> | null>(null);
  const [canComplete, setCanComplete] = useState(false);
  const [passed, setPassed] = useState(false);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const strings = ASSESSMENT_STRINGS[language];

  // ─── Scroll to bottom ──────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ─── Load session ──────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        // Get user language
        const meRes = await fetch('/api/auth/me');
        if (!meRes.ok) {
          router.replace('/login');
          return;
        }
        const meData = await meRes.json();
        if (meData.language && isSupportedLanguage(meData.language)) {
          setLanguage(meData.language);
        }

        // Load session
        const res = await fetch(`/api/assessment/${sessionId}`);
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (res.status === 404) {
          setError('Assessment not found');
          setIsLoading(false);
          return;
        }
        if (!res.ok) {
          throw new Error('Failed to load assessment');
        }

        const data = (await res.json()) as SessionData;
        setMessages(data.messages);
        setStatus(data.session.status);
        setVisibleKeys(data.config.studentVisibleDimensionKeys || []);
        setPassed(data.session.passedAt !== null);

        // If completed, show scores
        if (data.session.status === 'completed' && data.session.scores) {
          setScores(data.session.scores);
        }

        // If pending, start the session
        if (data.session.status === 'pending') {
          await startSession(data.session.lessonKey, data.session.blockId);
        }
      } catch (err) {
        console.error('Error loading assessment:', err);
        setError(strings.error);
      } finally {
        setIsLoading(false);
      }
    }

    init();
  }, [sessionId]);

  // ─── Start session ─────────────────────────────────────────────────────

  async function startSession(lessonKey: string, blockId: string | null) {
    if (!blockId) return;

    try {
      const res = await fetch('/api/assessment/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey, blockId }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to start');
      }

      const data = (await res.json()) as StartResponse;
      setStatus('in_progress');
      setMessages([{
        id: 'opening',
        role: 'assistant',
        content: data.openingMessage,
        createdAt: new Date().toISOString(),
      }]);
    } catch (err) {
      console.error('Error starting assessment:', err);
      setError(strings.error);
    }
  }

  // ─── Send message ──────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending || status !== 'in_progress') return;

    setIsSending(true);
    setInput('');

    // Optimistic update
    const userMsg: AssessmentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`/api/assessment/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to send');
      }

      const data = (await res.json()) as MessageResponse;

      // Add assistant response
      const assistantMsg: AssessmentMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Check if completion is required
      if (data.requiresCompletion) {
        setCanComplete(true);
        if (data.scores) {
          setScores(data.scores);
        }
        if (data.status === 'passed') {
          setPassed(true);
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput(text);
      setError(strings.error);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }

  // ─── Complete assessment ───────────────────────────────────────────────

  async function handleComplete() {
    if (isCompleting) return;
    setIsCompleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/assessment/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to complete');
      }

      // Success - navigate back to chat
      router.push('/chat');
    } catch (err) {
      console.error('Error completing assessment:', err);
      setError(strings.error);
      setIsCompleting(false);
    }
  }

  // ─── Render score display ──────────────────────────────────────────────

  function renderScores() {
    if (!scores || visibleKeys.length === 0) return null;

    return (
      <div className="my-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
        <div className="flex flex-wrap gap-3 justify-center">
          {visibleKeys.map((key) => {
            const score = scores[key];
            if (score === undefined) return null;
            return (
              <div
                key={key}
                className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl bg-white dark:bg-zinc-800"
              >
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{strings.scoreLabel}</span>
                <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {score.toFixed(1)}/10
                </span>
              </div>
            );
          })}
        </div>
        {passed && (
          <p className="text-center mt-3 text-emerald-700 dark:text-emerald-300 font-medium">
            {strings.completeButton}
          </p>
        )}
      </div>
    );
  }

  // ─── Typing indicator ──────────────────────────────────────────────────

  function TypingIndicator() {
    return (
      <div className="flex justify-start">
        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <p className="text-zinc-500 dark:text-zinc-400">{strings.loading}</p>
      </div>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────

  if (error && !status) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-900 p-4">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <Link
          href="/chat"
          className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-500 dark:hover:text-emerald-400 underline"
        >
          {strings.backToChat}
        </Link>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────────

  const isReadOnly = status === 'completed';

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-900">
      {/* Header */}
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <Link
            href="/chat"
            className="text-sm text-emerald-600 hover:text-emerald-700 dark:text-emerald-500 dark:hover:text-emerald-400"
          >
            ← {strings.backToChat}
          </Link>
          <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
            {isReadOnly ? strings.viewButton : strings.resumeButton}
          </h1>
          <div className="w-20" /> {/* Spacer for centering */}
        </div>
      </header>

      {/* Read-only notice */}
      {isReadOnly && (
        <div className="shrink-0 bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {strings.readOnlyNotice}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-emerald-600 text-white rounded-br-md'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {isSending && <TypingIndicator />}

          {/* Score display when completion is available */}
          {canComplete && scores && renderScores()}

          {/* Complete button */}
          {canComplete && !isReadOnly && (
            <div className="flex justify-center mt-4">
              <button
                onClick={handleComplete}
                disabled={isCompleting}
                className="px-6 py-3 rounded-xl font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
              >
                {isCompleting ? strings.loading : strings.completeButton}
              </button>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="text-center py-2">
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Read-only score display */}
          {isReadOnly && scores && renderScores()}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer (only for in_progress, not when canComplete) */}
      {status === 'in_progress' && !canComplete && !isReadOnly && (
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="max-w-2xl mx-auto flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={strings.placeholder}
              disabled={isSending}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={isSending || !input.trim()}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending ? '...' : '→'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
