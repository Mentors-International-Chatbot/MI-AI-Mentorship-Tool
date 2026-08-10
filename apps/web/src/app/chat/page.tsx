'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
    type SupportedLanguage,
    isSupportedLanguage,
    DEFAULT_LANGUAGE,
    UI_STRINGS,
    CHAT_SUBTITLE,
    CHAT_EMPTY_STATE_SOCIO,
} from '@/lib/i18n/languages';
import { AssessmentGateCard } from '@/components/AssessmentGateCard';
import { ProgressSidebar, ProgressStrip } from './ProgressPanel';
import type { ChatProgress } from '@/lib/chat/progress';

interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt?: string;
    isError?: boolean;
    senderType?: string | null;
    metadata?: Record<string, unknown> | null;
}

type PollMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    senderType: string | null;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
};

type ClientSession = {
    userId: string;
    name: string;
    role: 'socio' | 'mentor' | 'admin';
    language: string;
    curriculumCollectionKey: string | null;
    courseName: string | null;
    mentorName: string | null;
    displayName: string | null;
};

const LANGUAGES: { code: SupportedLanguage; flag: string; nativeName: string }[] = [
    { code: 'es', flag: '🇪🇸', nativeName: 'Español' },
    { code: 'en', flag: '🇺🇸', nativeName: 'English' },
    { code: 'pt', flag: '🇧🇷', nativeName: 'Português' },
];

function coerceUiLanguage(raw: string | undefined): SupportedLanguage {
    if (raw && isSupportedLanguage(raw)) return raw;
    return DEFAULT_LANGUAGE;
}

function isMathLine(line: string): boolean {
    const t = line.trim();
    if (!t.includes('=')) return false;
    if (
        /^\s*[\wÀ-ÿ\s,.+\-×÷*/]+\s*=\s*[\d,.\s+\-×÷*/\wÀ-ÿ]+$/.test(line) &&
        /\d/.test(t)
    ) {
        return true;
    }
    return /^\s*\d[\d,.]*\s*[+\-×÷*/]\s*\d[\d,.]*\s*=\s*\d[\d,.]*/.test(line);
}

function isStepLine(line: string): boolean {
    return /^\s*(\d+[.):]|Paso\s+\d+)/i.test(line);
}

/** Line-level math / step styling for web chat (plain text on WhatsApp). */
function formatLinesWithMathAndSteps(content: string) {
    const lines = content.split('\n');

    return lines.map((line, i) => {
        if (isMathLine(line)) {
            return (
                <div
                    key={i}
                    className="my-1 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 rounded font-mono text-sm border-l-2 border-emerald-400"
                >
                    {line}
                </div>
            );
        }
        if (isStepLine(line)) {
            return (
                <div
                    key={i}
                    className="my-0.5 pl-2 border-l-2 border-emerald-200 dark:border-emerald-800"
                >
                    {line}
                </div>
            );
        }
        return (
            <span key={i}>
                {line}
                {i < lines.length - 1 ? '\n' : ''}
            </span>
        );
    });
}

function renderAssistantMessageContent(content: string) {
    const parts = content.split(/\n\n---\n/);

    if (parts.length === 1) {
        return <>{formatLinesWithMathAndSteps(content)}</>;
    }

    return (
        <>
            {formatLinesWithMathAndSteps(parts[0])}
            {parts.slice(1).map((part, i) => (
                <div
                    key={i}
                    className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800"
                >
                    <div className="font-medium">{formatLinesWithMathAndSteps(part)}</div>
                </div>
            ))}
        </>
    );
}

export default function ChatPage() {
    const router = useRouter();
    const [session, setSession] = useState<ClientSession | null>(null);
    const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [lastMessageTime, setLastMessageTime] = useState<string | null>(null);
    const lastMessageTimeRef = useRef<string | null>(null);
    const [currentLesson, setCurrentLesson] = useState<number | null>(null);
    const [progress, setProgress] = useState<ChatProgress | null>(null);
    const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [historyReady, setHistoryReady] = useState(false);
    const [chatbotName, setChatbotName] = useState('Tutor');
    const [displayName, setDisplayName] = useState<string | null>(null);

    useEffect(() => {
        async function init() {
            try {
                const sessionRes = await fetch('/api/auth/me');
                if (!sessionRes.ok) {
                    window.location.href = '/login';
                    return;
                }
                const sessionData = (await sessionRes.json()) as ClientSession;

                // Gate: redirect socios without curriculum to /join
                if (sessionData.role === 'socio' && !sessionData.curriculumCollectionKey) {
                    router.replace('/join');
                    return;
                }

                setSession(sessionData);

                const lang = coerceUiLanguage(sessionData.language);
                setLanguage(lang);

                // Use course-specific metadata if available
                if (sessionData.mentorName) {
                    setChatbotName(sessionData.mentorName);
                }
                if (sessionData.displayName) {
                    setDisplayName(sessionData.displayName);
                }

                const historyRes = await fetch('/api/chat/history');
                if (historyRes.ok) {
                    const payload = (await historyRes.json()) as {
                        messages: {
                            id?: string;
                            role: 'user' | 'assistant';
                            content: string;
                            createdAt: string;
                            senderType?: string | null;
                            metadata?: Record<string, unknown> | null;
                        }[];
                        currentLesson?: number;
                        completedLessons?: number[];
                    };
                    const { messages: history } = payload;
                    setMessages(
                        history.map((m) => ({
                            id: m.id,
                            role: m.role,
                            content: m.content,
                            createdAt: m.createdAt,
                            senderType: m.senderType ?? null,
                            metadata: m.metadata ?? null,
                        })),
                    );
                    if (typeof payload.currentLesson === 'number') {
                        setCurrentLesson(payload.currentLesson);
                    }
                    if (history.length === 0) {
                        setLastMessageTime(new Date().toISOString());
                    }
                } else {
                    setLastMessageTime(new Date().toISOString());
                }
            } finally {
                setHistoryReady(true);
            }
        }
        void init();
    }, []);

    useEffect(() => {
        if (!historyReady || !session || session.role !== 'socio' || messages.length > 0) {
            return;
        }

        const storageKey = `mi_chat_welcome_${session.userId}`;
        if (typeof window !== 'undefined') {
            const st = sessionStorage.getItem(storageKey);
            if (st === 'done' || st === 'pending') return;
            sessionStorage.setItem(storageKey, 'pending');
        }

        async function triggerWelcome() {
            setIsLoading(true);
            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: '__welcome__', language }),
                });
                if (res.status === 401) {
                    window.location.href = '/login';
                    return;
                }
                const data = (await res.json()) as {
                    response?: string;
                    isNewSocio?: boolean;
                    currentLesson?: number;
                };

                if (data.response && data.isNewSocio && typeof window !== 'undefined' && res.ok) {
                    sessionStorage.setItem(storageKey, 'done');
                }

                if (data.response && data.isNewSocio) {
                    const stamp = new Date().toISOString();
                    // Only show the assistant greeting, no fake user message
                    setMessages([
                        {
                            role: 'assistant',
                            content: data.response,
                            createdAt: stamp,
                        },
                    ]);
                    setLastMessageTime(stamp);
                    if (typeof data.currentLesson === 'number') {
                        setCurrentLesson(data.currentLesson);
                    }
                } else if (data.isNewSocio === false) {
                    if (typeof window !== 'undefined' && res.ok) {
                        sessionStorage.setItem(storageKey, 'done');
                    }
                    const historyRes = await fetch('/api/chat/history');
                    if (historyRes.ok) {
                        const payload = (await historyRes.json()) as {
                            messages: {
                                id?: string;
                                role: 'user' | 'assistant';
                                content: string;
                                createdAt: string;
                                senderType?: string | null;
                            }[];
                            currentLesson?: number;
                        };
                        setMessages(
                            payload.messages.map((m) => ({
                                id: m.id,
                                role: m.role,
                                content: m.content,
                                createdAt: m.createdAt,
                                senderType: m.senderType ?? null,
                            })),
                        );
                        if (typeof payload.currentLesson === 'number') {
                            setCurrentLesson(payload.currentLesson);
                        }
                        const times = payload.messages
                            .map((m) => m.createdAt)
                            .filter(Boolean);
                        if (times.length > 0) {
                            setLastMessageTime(times.reduce((a, b) => (a > b ? a : b)));
                        }
                    }
                }
            } catch {
                if (typeof window !== 'undefined') {
                    sessionStorage.removeItem(storageKey);
                }
            } finally {
                setIsLoading(false);
            }
        }

        void triggerWelcome();
    }, [historyReady, session, messages.length, language]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        inputRef.current?.focus();
    }, [session]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, [input]);

    useEffect(() => {
        lastMessageTimeRef.current = lastMessageTime;
    }, [lastMessageTime]);

    useEffect(() => {
        if (messages.length === 0) return;
        const times = messages
            .map((m) => m.createdAt)
            .filter((t): t is string => Boolean(t));
        if (times.length === 0) return;
        const max = times.reduce((a, b) => (a > b ? a : b));
        setLastMessageTime(max);
    }, [messages]);

    // Progress is refreshed on load and whenever the conversation moves, rather
    // than on the five-second poll: these numbers change a handful of times per
    // lesson, and the reads behind them are not free.
    const refreshProgress = useCallback(async () => {
        try {
            const res = await fetch('/api/chat/progress');
            if (!res.ok) return;
            const data = (await res.json()) as { progress: ChatProgress | null };
            setProgress(data.progress);
        } catch {
            // A missing sidebar must never take the conversation down with it.
        }
    }, []);

    useEffect(() => {
        if (!session || session.role !== 'socio') return;
        void refreshProgress();
    }, [session, refreshProgress]);

    useEffect(() => {
        if (!session || !lastMessageTime) return;

        const poll = async () => {
            const since = lastMessageTimeRef.current;
            if (!since) return;
            try {
                const res = await fetch(
                    `/api/chat/poll?since=${encodeURIComponent(since)}`,
                );
                if (!res.ok) return;

                const data = (await res.json()) as {
                    messages: PollMessage[];
                    currentLesson?: number;
                };
                const { messages: newMsgs } = data;
                if (typeof data.currentLesson === 'number') {
                    setCurrentLesson(data.currentLesson);
                }
                if (newMsgs.length === 0) return;

                // Something arrived — a gate follow-up, a mentor DM, a lesson
                // advancing. Any of those can move the panel.
                void refreshProgress();

                setMessages((prev) => {
                    const existingIds = new Set(
                        prev.map((m) => m.id).filter(Boolean) as string[],
                    );
                    const recentContents = new Set(prev.slice(-15).map((m) => m.content));

                    const trulyNew = newMsgs.filter((m) => {
                        if (m.id && existingIds.has(m.id)) return false;
                        if (recentContents.has(m.content)) return false;
                        return true;
                    });

                    if (trulyNew.length === 0) return prev;

                    return [
                        ...prev,
                        ...trulyNew.map((m) => ({
                            id: m.id,
                            role: m.role,
                            content: m.content,
                            createdAt: m.createdAt,
                            senderType: m.senderType,
                            metadata: m.metadata,
                        })),
                    ];
                });
            } catch {
                // ignore poll errors
            }
        };

        const interval = setInterval(poll, 5000);
        return () => clearInterval(interval);
    }, [session, lastMessageTime, refreshProgress]);

    async function handleLanguageChange(newLang: SupportedLanguage) {
        setLanguage(newLang);

        if (isSocio) {
            void fetch('/api/auth/me', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language: newLang }),
            });
        }

        if (!session || isLoading) return;

        const triggers: Record<SupportedLanguage, string> = {
            es: 'Por favor repite tu último mensaje en español.',
            en: 'Please repeat your last message in English.',
            pt: 'Por favor repita sua última mensagem em português.',
        };

        setIsLoading(true);
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: triggers[newLang], language: newLang }),
            });
            if (res.status === 401) { window.location.href = '/login'; return; }
            const data = await res.json();
            if (res.ok && data.response) {
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: data.response,
                        createdAt: new Date().toISOString(),
                        isError: Boolean(data.isError),
                    },
                ]);
            }
        } catch {
            // silently ignore
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    }

    /**
     * Reload the conversation from the server and take its word for it.
     *
     * The recovery path when a streamed turn ends without a `done` frame. The
     * DB is authoritative and, by the guarantee at the generateAIResponse call
     * site in handler.ts, already holds the reply whether or not this browser
     * stayed to read it — so refetching is not a consolation prize, it is the
     * same text arriving by a slower route.
     */
    async function refetchHistory() {
        try {
            const res = await fetch('/api/chat/history');
            if (!res.ok) return;
            const payload = (await res.json()) as {
                messages: {
                    id?: string;
                    role: 'user' | 'assistant';
                    content: string;
                    createdAt: string;
                    senderType?: string | null;
                    metadata?: Record<string, unknown> | null;
                }[];
                currentLesson?: number;
            };
            setMessages(
                payload.messages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    createdAt: m.createdAt,
                    senderType: m.senderType ?? null,
                    metadata: m.metadata ?? null,
                })),
            );
            if (typeof payload.currentLesson === 'number') {
                setCurrentLesson(payload.currentLesson);
            }
            const times = payload.messages.map((m) => m.createdAt).filter(Boolean);
            if (times.length > 0) {
                setLastMessageTime(times.reduce((a, b) => (a > b ? a : b)));
            }
        } catch {
            // Leave what is on screen; the 5s poll is the next chance.
        }
    }

    /**
     * Consumes the NDJSON reply, growing a provisional bubble as it arrives.
     *
     * Two rules, both load-bearing:
     *
     *  - `done` REPLACES the bubble, it never appends to it. The streamed text
     *    is only a prefix of the final reply — the handler appends the
     *    escalation confirmation and the feedback prompt after generation ends
     *    — so appending would show the tail twice.
     *  - no `done` means something failed server-side after the headers went
     *    out, and there is no status code left to read. The provisional bubble
     *    is torn down and history refetched, rather than leaving half a reply
     *    on screen looking finished.
     */
    async function consumeChatStream(res: Response, provisionalId: string) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawDone = false;

        const appendDelta = (delta: string) => {
            setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === provisionalId);
                if (idx === -1) {
                    return [...prev, {
                        id: provisionalId,
                        role: 'assistant' as const,
                        content: delta,
                        createdAt: new Date().toISOString(),
                    }];
                }
                const next = [...prev];
                next[idx] = { ...next[idx], content: next[idx].content + delta };
                return next;
            });
        };

        const applyDone = (done: {
            response?: string;
            isError?: boolean;
            messages?: ChatMessage[];
        }) => {
            setMessages((prev) => {
                const settled = prev.filter((m) => m.id !== provisionalId);
                const provided = done.messages ?? [];

                if (provided.length > 0) {
                    // The 5s poll can win the race and have already inserted
                    // the same row. Its id is the one thing that says so.
                    const seen = new Set(settled.map((m) => m.id).filter(Boolean) as string[]);
                    const fresh = provided
                        .filter((m) => !m.id || !seen.has(m.id))
                        .map((m) => ({ ...m, isError: Boolean(done.isError) }));
                    return [...settled, ...fresh];
                }

                if (done.response) {
                    return [...settled, {
                        role: 'assistant' as const,
                        content: done.response,
                        createdAt: new Date().toISOString(),
                        isError: Boolean(done.isError),
                    }];
                }
                return settled;
            });

            // The reply may have advanced the lesson, cleared a gate, or
            // recorded a milestone. Refresh the panel rather than let it lag a
            // poll cycle behind the message that changed it.
            void refreshProgress();
        };

        const handleFrame = (line: string) => {
            let frame: { t?: unknown; done?: Parameters<typeof applyDone>[0] };
            try {
                frame = JSON.parse(line);
            } catch {
                return; // A frame we cannot read is one we cannot act on.
            }
            if (typeof frame.t === 'string') {
                appendDelta(frame.t);
            } else if (frame.done) {
                sawDone = true;
                applyDone(frame.done);
            }
        };

        for (;;) {
            const { done: exhausted, value } = await reader.read();
            if (exhausted) break;
            buffer += decoder.decode(value, { stream: true });

            // Frames are newline-delimited, and a chunk boundary lands wherever
            // it likes — mid-frame as often as not. Only whole lines are parsed.
            let nl = buffer.indexOf('\n');
            while (nl !== -1) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (line) handleFrame(line);
                nl = buffer.indexOf('\n');
            }
        }

        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail) handleFrame(tail);

        if (!sawDone) {
            setMessages((prev) => prev.filter((m) => m.id !== provisionalId));
            await refetchHistory();
        }
    }

    async function handleLogout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const text = input.trim();
        if (!text || isLoading || !session) return;

        setLastUserMessage(text);
        setInput('');
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
        const stamp = new Date().toISOString();
        setMessages((prev) => [...prev, { role: 'user', content: text, createdAt: stamp }]);
        setIsLoading(true);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, language, stream: true }),
            });

            if (res.status === 401) {
                window.location.href = '/login';
                return;
            }

            if (!res.ok) {
                // Every rejection is still ordinary JSON with a real status,
                // answered before the server could open a stream.
                const data = await res.json().catch(() => ({} as { error?: string }));
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: data.error ?? UI_STRINGS[language].error,
                        createdAt: new Date().toISOString(),
                        isError: true,
                    },
                ]);
                return;
            }

            // The server decides. Asking for a stream is not the same as being
            // given one, and the JSON path below stays the fallback rather than
            // becoming dead code.
            if (res.body && res.headers.get('Content-Type')?.includes('ndjson')) {
                await consumeChatStream(res, `streaming-${Date.now()}`);
                return;
            }

            const data = await res.json();

            // The reply may have advanced the lesson, cleared a gate, or
            // recorded a milestone. Refresh the panel rather than let it lag a
            // poll cycle behind the message that changed it.
            void refreshProgress();

            // Use returned messages with DB ids and metadata (enables gate card rendering + poll dedupe)
            if (data.messages && data.messages.length > 0) {
                setMessages((prev) => [
                    ...prev,
                    ...data.messages.map((m: ChatMessage) => ({
                        ...m,
                        isError: Boolean(data.isError),
                    })),
                ]);
            } else if (data.response) {
                // Fallback for backwards compatibility
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: data.response,
                        createdAt: new Date().toISOString(),
                        isError: Boolean(data.isError),
                    },
                ]);
            }
        } catch {
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: UI_STRINGS[language].error,
                    createdAt: new Date().toISOString(),
                    isError: true,
                },
            ]);
        } finally {
            setIsLoading(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }

    function handleRetry() {
        if (!lastUserMessage) return;

        setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role !== 'assistant' || !last.isError) return prev;
            const withoutAssistant = prev.slice(0, -1);
            const beforeLast = withoutAssistant[withoutAssistant.length - 1];
            if (beforeLast?.role === 'user') {
                return withoutAssistant.slice(0, -1);
            }
            return withoutAssistant;
        });

        setInput(lastUserMessage);
        setTimeout(() => {
            formRef.current?.requestSubmit();
        }, 50);
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center h-screen max-w-2xl mx-auto bg-white dark:bg-zinc-950 px-6">
                <p className="text-sm text-zinc-500">Cargando chat…</p>
            </div>
        );
    }

    const ui = UI_STRINGS[language];
    const isSocio = session.role === 'socio';

    return (
        // Outer row so the progress sidebar can sit beside the conversation on
        // wide viewports. The conversation keeps its own max width, so nothing
        // about its line length changes when the panel is absent.
        <div className="flex h-screen w-full justify-center bg-white dark:bg-zinc-950">
        <div className="flex w-full max-w-5xl">
        <div className="flex flex-col flex-1 min-w-0 max-w-2xl mx-auto">
            <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">
                    {chatbotName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {chatbotName}
                    </h1>
                    <p className="text-xs text-zinc-500">
                        {isSocio && currentLesson !== null
                            ? `${CHAT_SUBTITLE[language].lesson(currentLesson)}${displayName ? ` · ${displayName}` : ''}`
                            : displayName || ''}
                    </p>
                </div>
                <label className="flex items-center gap-1 text-xs text-zinc-500">
                    <span className="sr-only">Language</span>
                    <select
                        value={language}
                        onChange={(e) => void handleLanguageChange(e.target.value as SupportedLanguage)}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
                    >
                        {LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code}>
                                {l.flag} {l.nativeName}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={handleLogout}
                    className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                    Log out
                </button>
            </header>

            {isSocio && <ProgressStrip progress={progress} language={language} />}

            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
                {messages.length === 0 && !isLoading && (
                    <div className="flex items-center justify-center h-full text-zinc-400 text-sm text-center px-8">
                        {isSocio ? (
                            CHAT_EMPTY_STATE_SOCIO[language](session.name || undefined)
                        ) : (
                            ui.placeholder
                        )}
                    </div>
                )}

                {messages.length === 0 && isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                            </div>
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => {
                    // Assessment gate card - special rendering for gated teach-back messages
                    if (msg.metadata?.kind === 'assessment_gate' && typeof msg.metadata.sessionId === 'string') {
                        return (
                            <div
                                key={msg.id ?? `${msg.createdAt ?? 'm'}-${i}-${msg.role}`}
                                className="flex justify-start"
                            >
                                <div className="max-w-[85%]">
                                    <AssessmentGateCard
                                        sessionId={msg.metadata.sessionId}
                                        content={msg.content}
                                        language={language}
                                    />
                                </div>
                            </div>
                        );
                    }

                    // Standard message bubble
                    return (
                        <div
                            key={msg.id ?? `${msg.createdAt ?? 'm'}-${i}-${msg.role}`}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`flex flex-col gap-1 max-w-[80%] ${
                                    msg.role === 'user' ? 'items-end' : 'items-start'
                                }`}
                            >
                                <div
                                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                        msg.role === 'user'
                                            ? 'bg-emerald-600 text-white rounded-br-md whitespace-pre-wrap'
                                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md'
                                    }`}
                                >
                                    {msg.role === 'assistant' ? (
                                        renderAssistantMessageContent(msg.content)
                                    ) : (
                                        msg.content
                                    )}
                                    {msg.role === 'assistant' && msg.senderType === 'mentor' && (
                                        <span className="text-xs text-blue-500 dark:text-blue-400 block mt-2 font-medium">
                                            — {CHAT_SUBTITLE[language].mentor}
                                        </span>
                                    )}
                                </div>
                                {msg.role === 'assistant' &&
                                    msg.isError &&
                                    i === messages.length - 1 &&
                                    !isLoading && (
                                        <button
                                            type="button"
                                            onClick={handleRetry}
                                            className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-500 dark:hover:text-emerald-400 underline"
                                        >
                                            Reintentar / Retry
                                        </button>
                                    )}
                            </div>
                        </div>
                    );
                })}

                {isLoading && messages.length > 0 && (
                    <div className="flex justify-start">
                        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <form
                ref={formRef}
                onSubmit={handleSubmit}
                className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 flex gap-2 items-end"
            >
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSubmit(e as unknown as FormEvent);
                        }
                    }}
                    placeholder={ui.placeholder}
                    disabled={isLoading}
                    rows={1}
                    className="flex-1 min-h-[2.5rem] max-h-[120px] rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 resize-none overflow-y-auto"
                />
                <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 shrink-0"
                >
                    {ui.send}
                </button>
            </form>
        </div>

        {isSocio && <ProgressSidebar progress={progress} language={language} />}
        </div>
        </div>
    );
}
