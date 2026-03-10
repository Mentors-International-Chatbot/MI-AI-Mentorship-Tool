'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';

type SupportedLanguage = 'es' | 'en' | 'pt';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const LANGUAGES: { code: SupportedLanguage; flag: string; nativeName: string }[] = [
    { code: 'es', flag: '🇪🇸', nativeName: 'Español' },
    { code: 'en', flag: '🇺🇸', nativeName: 'English' },
    { code: 'pt', flag: '🇧🇷', nativeName: 'Português' },
];

const UI: Record<SupportedLanguage, { placeholder: string; send: string; error: string }> = {
    es: { placeholder: 'Escribe tu mensaje...', send: 'Enviar', error: 'Error al conectar con el servidor. Intenta de nuevo.' },
    en: { placeholder: 'Type your message...', send: 'Send', error: 'Error connecting to the server. Please try again.' },
    pt: { placeholder: 'Digite sua mensagem...', send: 'Enviar', error: 'Erro ao conectar com o servidor. Tente novamente.' },
};

function generateSessionId() {
    return crypto.randomUUID();
}

export default function ChatPage() {
    const [sessionId] = useState(generateSessionId);
    const [language, setLanguage] = useState<SupportedLanguage | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (language) inputRef.current?.focus();
    }, [language]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const text = input.trim();
        if (!text || isLoading || !language) return;

        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setIsLoading(true);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId, language }),
            });

            const data = await res.json();

            if (data.response) {
                setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: data.response },
                ]);
            }
        } catch {
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: UI[language].error },
            ]);
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    }

    if (!language) {
        return (
            <div className="flex flex-col items-center justify-center h-screen max-w-2xl mx-auto bg-white dark:bg-zinc-950 px-6">
                <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl mb-6">
                    MI
                </div>
                <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                    Mentor Virtual
                </h1>
                <p className="text-sm text-zinc-500 mb-8">
                    Mentors International
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6 text-center">
                    Choose your language / Elige tu idioma / Escolha seu idioma
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                    {LANGUAGES.map((l) => (
                        <button
                            key={l.code}
                            onClick={() => setLanguage(l.code)}
                            className="flex items-center gap-3 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-3.5 text-left hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            <span className="text-2xl">{l.flag}</span>
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {l.nativeName}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    const ui = UI[language];

    return (
        <div className="flex flex-col h-screen max-w-2xl mx-auto bg-white dark:bg-zinc-950">
            <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">
                    MI
                </div>
                <div className="flex-1">
                    <h1 className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Mentor Virtual
                    </h1>
                    <p className="text-xs text-zinc-500">
                        Mentors International
                    </p>
                </div>
                <span className="text-lg" title={LANGUAGES.find(l => l.code === language)?.nativeName}>
                    {LANGUAGES.find(l => l.code === language)?.flag}
                </span>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
                {messages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-zinc-400 text-sm text-center px-8">
                        {ui.placeholder}
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                                msg.role === 'user'
                                    ? 'bg-emerald-600 text-white rounded-br-md'
                                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md'
                            }`}
                        >
                            {msg.content}
                        </div>
                    </div>
                ))}

                {isLoading && (
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
                onSubmit={handleSubmit}
                className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 flex gap-2"
            >
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={ui.placeholder}
                    disabled={isLoading}
                    className="flex-1 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                    {ui.send}
                </button>
            </form>
        </div>
    );
}
