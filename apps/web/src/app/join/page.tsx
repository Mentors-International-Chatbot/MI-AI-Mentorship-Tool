'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type ClientSession = {
    userId: string;
    name: string;
    role: 'socio' | 'mentor' | 'admin';
    language: string;
    curriculumCollectionKey: string | null;
};

const UI_TEXT = {
    es: {
        title: 'Unirse a un Curso',
        subtitle: 'Ingresa tu codigo de curso para comenzar',
        placeholder: 'Codigo de curso (ej: MI2024)',
        submit: 'Unirse',
        error: 'Codigo invalido. Por favor verifica e intenta de nuevo.',
        loading: 'Cargando...',
        alreadyEnrolled: 'Ya estas inscrito en un curso.',
        goToChat: 'Ir al chat',
    },
    en: {
        title: 'Join a Course',
        subtitle: 'Enter your course code to get started',
        placeholder: 'Course code (e.g., MI2024)',
        submit: 'Join',
        error: 'Invalid code. Please check and try again.',
        loading: 'Loading...',
        alreadyEnrolled: 'You are already enrolled in a course.',
        goToChat: 'Go to chat',
    },
    pt: {
        title: 'Entrar em um Curso',
        subtitle: 'Digite seu codigo de curso para comecar',
        placeholder: 'Codigo do curso (ex: MI2024)',
        submit: 'Entrar',
        error: 'Codigo invalido. Por favor verifique e tente novamente.',
        loading: 'Carregando...',
        alreadyEnrolled: 'Voce ja esta inscrito em um curso.',
        goToChat: 'Ir para o chat',
    },
};

export default function JoinPage() {
    const router = useRouter();
    const [session, setSession] = useState<ClientSession | null>(null);
    const [courseCode, setCourseCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [initializing, setInitializing] = useState(true);

    const lang = (session?.language || 'es') as keyof typeof UI_TEXT;
    const ui = UI_TEXT[lang] || UI_TEXT.es;

    useEffect(() => {
        async function init() {
            try {
                const res = await fetch('/api/auth/me');
                if (!res.ok) {
                    window.location.href = '/login';
                    return;
                }
                const data = (await res.json()) as ClientSession;
                setSession(data);

                // If already has curriculum, redirect to chat
                if (data.curriculumCollectionKey) {
                    router.replace('/chat');
                    return;
                }

                // If not a socio, redirect to appropriate page
                if (data.role !== 'socio') {
                    router.replace('/dashboard');
                    return;
                }
            } finally {
                setInitializing(false);
            }
        }
        void init();
    }, [router]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const code = courseCode.trim();
        if (!code || isLoading) return;

        setIsLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/curriculum', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseCode: code }),
            });

            if (res.status === 401) {
                window.location.href = '/login';
                return;
            }

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || ui.error);
                return;
            }

            // Success - redirect to chat
            router.push('/chat');
        } catch {
            setError(ui.error);
        } finally {
            setIsLoading(false);
        }
    }

    if (initializing) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950">
                <p className="text-sm text-zinc-500">{ui.loading}</p>
            </div>
        );
    }

    // If already enrolled (shouldn't happen but just in case)
    if (session?.curriculumCollectionKey) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4">
                <div className="w-full max-w-md text-center">
                    <p className="text-zinc-600 dark:text-zinc-400 mb-4">{ui.alreadyEnrolled}</p>
                    <button
                        onClick={() => router.push('/chat')}
                        className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                    >
                        {ui.goToChat}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl">
                        MI
                    </div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        {ui.title}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-2">{ui.subtitle}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <input
                            type="text"
                            value={courseCode}
                            onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                            placeholder={ui.placeholder}
                            disabled={isLoading}
                            className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-center text-lg font-mono tracking-wider placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-500 text-center">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading || !courseCode.trim()}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                        {isLoading ? ui.loading : ui.submit}
                    </button>
                </form>

                <p className="text-xs text-zinc-400 text-center mt-8">
                    Mentors International
                </p>
            </div>
        </div>
    );
}
