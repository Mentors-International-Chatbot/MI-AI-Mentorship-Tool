'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
    type SupportedLanguage,
    isSupportedLanguage,
    DEFAULT_LANGUAGE,
} from '@/lib/i18n/languages';

interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt?: string;
    isError?: boolean;
    senderType?: string | null;
}

type PollMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    senderType: string | null;
    createdAt: string;
};

type ClientSession = {
    userId: string;
    name: string;
    role: 'socio' | 'mentor' | 'admin';
    language: string;
};

const LANGUAGES: { code: SupportedLanguage; flag: string; nativeName: string }[] = [
    { code: 'es', flag: '🇪🇸', nativeName: 'Español' },
    { code: 'en', flag: '🇺🇸', nativeName: 'English' },
    { code: 'pt', flag: '🇧🇷', nativeName: 'Português' },
];

const UI: Record<SupportedLanguage, { placeholder: string; send: string; error: string }> = {
    es: {
        placeholder: 'Escribe tu mensaje...',
        send: 'Enviar',
        error: 'Error al conectar con el servidor. Intenta de nuevo.',
    },
    en: {
        placeholder: 'Type your message...',
        send: 'Send',
        error: 'Error connecting to the server. Please try again.',
    },
    pt: {
        placeholder: 'Digite sua mensagem...',
        send: 'Enviar',
        error: 'Erro ao conectar com o servidor. Tente novamente.',
    },
};

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
    const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [historyReady, setHistoryReady] = useState(false);
    const [chatbotName, setChatbotName] = useState('Mentor Virtual');

    useEffect(() => {
        async function init() {
            try {
                const sessionRes = await fetch('/api/auth/me');
                if (!sessionRes.ok) {
                    window.location.href = '/login';
                    return;
                }
                const sessionData = (await sessionRes.json()) as ClientSession;
                setSession(sessionData);

                const lang = coerceUiLanguage(sessionData.language);
                setLanguage(lang);

                try {
                    const configRes = await fetch('/api/config/public');
                    if (configRes.ok) {
                        const cfg = (await configRes.json()) as { chatbotName?: string };
                        if (typeof cfg.chatbotName === 'string' && cfg.chatbotName.trim()) {
                            setChatbotName(cfg.chatbotName.trim());
                        }
                    }
                } catch {
                    // keep default
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
                    body: JSON.stringify({ message: 'hola', language }),
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
                    setMessages([
                        { role: 'user', content: 'hola', createdAt: stamp },
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
                        })),
                    ];
                });
            } catch {
                // ignore poll errors
            }
        };

        const interval = setInterval(poll, 5000);
        return () => clearInterval(interval);
    }, [session, lastMessageTime]);

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
                body: JSON.stringify({ message: text, language }),
            });

            if (res.status === 401) {
                window.location.href = '/login';
                return;
            }

            const data = await res.json();

            if (!res.ok) {
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: data.error ?? UI[language].error,
                        createdAt: new Date().toISOString(),
                        isError: true,
                    },
                ]);
                return;
            }

            if (data.response) {
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
                    content: UI[language].error,
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

    const ui = UI[language];
    const isSocio = session.role === 'socio';

    return (
        <div className="flex flex-col h-screen max-w-2xl mx-auto bg-white dark:bg-zinc-950">
            <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">
                    MI
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {chatbotName}
                    </h1>
                    <p className="text-xs text-zinc-500">
                        {isSocio && currentLesson !== null
                            ? `Tu mentor virtual · Lección ${currentLesson} · Mentors International`
                            : `Tu mentor virtual · Mentors International`}
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

            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
                {messages.length === 0 && !isLoading && (
                    <div className="flex items-center justify-center h-full text-zinc-400 text-sm text-center px-8">
                        {isSocio ? (
                            <>
                                ¡Hola{session.name ? `, ${session.name}` : ''}! Escribe un mensaje para comenzar.
                            </>
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

                {messages.map((msg, i) => (
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
                                        — Tu mentor
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
                ))}

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
    );
}
