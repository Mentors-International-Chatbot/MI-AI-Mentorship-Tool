'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type ClientSession = {
    userId: string;
    name: string;
    role: 'socio' | 'mentor' | 'admin';
    language: string;
    curriculumCollectionKey: string | null;
    homePath: string | null;
    enrollmentIssue: 'not-enrolled' | 'no-published-course' | 'channel-not-supported' | null;
};

type SupportedLanguage = 'es' | 'en' | 'pt';

const LANGUAGES: { code: SupportedLanguage; flag: string; nativeName: string; greeting: string }[] = [
    { code: 'es', flag: '🇪🇸', nativeName: 'Español', greeting: 'Hola' },
    { code: 'en', flag: '🇺🇸', nativeName: 'English', greeting: 'Hello' },
    { code: 'pt', flag: '🇧🇷', nativeName: 'Português', greeting: 'Olá' },
];

const UI_TEXT = {
    es: {
        languageTitle: 'Bienvenido',
        languageSubtitle: 'Selecciona tu idioma preferido',
        courseTitle: 'Unirse a un Curso',
        courseSubtitle: 'Ingresa tu codigo de curso para comenzar',
        placeholder: 'Codigo de curso (ej: MI2024)',
        submit: 'Unirse',
        back: 'Cambiar idioma',
        error: 'Codigo invalido. Por favor verifica e intenta de nuevo.',
        loading: 'Cargando...',
        alreadyEnrolled: 'Ya estas inscrito en un curso.',
        goToChat: 'Ir al chat',
        availableCourses: 'Cursos Disponibles',
        staleSession: 'Esta sesion pertenece a otra base de datos. Borra la sesion e inicia de nuevo.',
        clearSession: 'Borrar sesion',
        noPublishedCourse: 'Tu curso esta asignado, pero todavia no hay una version publicada disponible.',
        notEnrolled: 'Tu cuenta existe, pero no tiene una inscripcion activa en la version publicada.',
        channelUnsupported: 'Este curso no esta disponible en este canal.',
    },
    en: {
        languageTitle: 'Welcome',
        languageSubtitle: 'Select your preferred language',
        courseTitle: 'Join a Course',
        courseSubtitle: 'Enter your course code to get started',
        placeholder: 'Course code (e.g., MI2024)',
        submit: 'Join',
        back: 'Change language',
        error: 'Invalid code. Please check and try again.',
        loading: 'Loading...',
        alreadyEnrolled: 'You are already enrolled in a course.',
        goToChat: 'Go to chat',
        availableCourses: 'Available Courses',
        staleSession: 'This session belongs to a different database. Clear it and sign in again.',
        clearSession: 'Clear session',
        noPublishedCourse: 'Your course is assigned, but no published version is available yet.',
        notEnrolled: 'Your account exists, but it has no active enrollment in the published version.',
        channelUnsupported: 'This course is not available through this channel.',
    },
    pt: {
        languageTitle: 'Bem-vindo',
        languageSubtitle: 'Selecione seu idioma preferido',
        courseTitle: 'Entrar em um Curso',
        courseSubtitle: 'Digite seu codigo de curso para comecar',
        placeholder: 'Codigo do curso (ex: MI2024)',
        submit: 'Entrar',
        back: 'Mudar idioma',
        error: 'Codigo invalido. Por favor verifique e tente novamente.',
        loading: 'Carregando...',
        alreadyEnrolled: 'Voce ja esta inscrito em um curso.',
        goToChat: 'Ir para o chat',
        availableCourses: 'Cursos Disponiveis',
        staleSession: 'Esta sessao pertence a outro banco de dados. Limpe a sessao e entre novamente.',
        clearSession: 'Limpar sessao',
        noPublishedCourse: 'Seu curso esta atribuido, mas ainda nao ha uma versao publicada disponivel.',
        notEnrolled: 'Sua conta existe, mas nao tem uma inscricao ativa na versao publicada.',
        channelUnsupported: 'Este curso nao esta disponivel neste canal.',
    },
};

type CourseInfo = {
    code: string;
    collectionKey: string;
    name: string;
    description: string;
};

type Step = 'language' | 'course';

export default function JoinPage() {
    const router = useRouter();
    const [session, setSession] = useState<ClientSession | null>(null);
    const [step, setStep] = useState<Step>('language');
    const [language, setLanguage] = useState<SupportedLanguage>('en');
    const [courseCode, setCourseCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [initializing, setInitializing] = useState(true);
    const [courses, setCourses] = useState<CourseInfo[]>([]);
    const [sessionMismatch, setSessionMismatch] = useState(false);

    const ui = UI_TEXT[language];

    useEffect(() => {
        async function init() {
            try {
                const res = await fetch('/api/auth/me');
                if (res.status === 409) {
                    const problem = await res.json() as { code?: string };
                    if (problem.code === 'session_database_mismatch') {
                        setSessionMismatch(true);
                        return;
                    }
                }
                if (!res.ok) {
                    window.location.href = '/login';
                    return;
                }
                const data = (await res.json()) as ClientSession;
                setSession(data);

                // A course key is not enough for player delivery: the current
                // branch must also contain a published version and enrollment.
                if (data.curriculumCollectionKey && !data.enrollmentIssue) {
                    router.replace(data.homePath || '/home');
                    return;
                }

                // If not a socio, redirect to appropriate page
                if (data.role !== 'socio') {
                    router.replace('/dashboard');
                    return;
                }

                // Use existing language preference if set
                if (data.language && ['es', 'en', 'pt'].includes(data.language)) {
                    setLanguage(data.language as SupportedLanguage);
                }
            } finally {
                setInitializing(false);
            }
        }
        void init();
    }, [router]);

    async function handleLanguageSelect(lang: SupportedLanguage) {
        setLanguage(lang);
        setIsLoading(true);

        try {
            // Save language preference and fetch available courses in parallel
            const [, coursesRes] = await Promise.all([
                fetch('/api/auth/me', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ language: lang }),
                }),
                fetch('/api/auth/curriculum'),
            ]);

            if (coursesRes.ok) {
                const data = await coursesRes.json();
                setCourses(data.courses || []);
            }
        } catch {
            // Continue anyway - language will be saved when they complete enrollment
        } finally {
            setIsLoading(false);
            setStep('course');
        }
    }

    async function clearStaleSession() {
        setIsLoading(true);
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
            window.location.href = '/login';
        }
    }

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

            router.push(data.homePath || '/home');
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

    if (sessionMismatch) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4">
                <div className="w-full max-w-md rounded-xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950">
                    <p className="text-sm text-amber-900 dark:text-amber-100">{ui.staleSession}</p>
                    <button onClick={clearStaleSession} disabled={isLoading} className="mt-4 px-6 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-medium disabled:opacity-50">
                        {ui.clearSession}
                    </button>
                </div>
            </div>
        );
    }

    // If already enrolled (shouldn't happen but just in case)
    if (session?.curriculumCollectionKey) {
        const enrollmentMessage = session.enrollmentIssue === 'no-published-course'
            ? ui.noPublishedCourse
            : session.enrollmentIssue === 'not-enrolled'
                ? ui.notEnrolled
                : session.enrollmentIssue === 'channel-not-supported'
                    ? ui.channelUnsupported
                    : null;
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4">
                <div className="w-full max-w-md text-center">
                    <p className="text-zinc-600 dark:text-zinc-400 mb-4">{enrollmentMessage ?? ui.alreadyEnrolled}</p>
                    {!enrollmentMessage && <button onClick={() => router.push(session.homePath || '/home')} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors">{ui.goToChat}</button>}
                </div>
            </div>
        );
    }

    // Step 1: Language Selection
    if (step === 'language') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl">
                            MI
                        </div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            {ui.languageTitle}
                        </h1>
                        <p className="text-sm text-zinc-500 mt-2">{ui.languageSubtitle}</p>
                    </div>

                    <div className="space-y-3">
                        {LANGUAGES.map((lang) => (
                            <button
                                key={lang.code}
                                onClick={() => handleLanguageSelect(lang.code)}
                                disabled={isLoading}
                                className="w-full flex items-center gap-4 px-6 py-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-all disabled:opacity-50"
                            >
                                <span className="text-3xl">{lang.flag}</span>
                                <div className="text-left">
                                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                                        {lang.nativeName}
                                    </p>
                                    <p className="text-sm text-zinc-500">{lang.greeting}!</p>
                                </div>
                            </button>
                        ))}
                    </div>

                    <p className="text-xs text-zinc-400 text-center mt-8">
                        Mentors International
                    </p>
                </div>
            </div>
        );
    }

    // Step 2: Course Code Input
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl">
                        MI
                    </div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        {ui.courseTitle}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-2">{ui.courseSubtitle}</p>
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

                {courses.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-700">
                        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
                            {ui.availableCourses}
                        </h2>
                        <div className="space-y-2">
                            {courses.map((course) => (
                                <button
                                    key={course.code}
                                    type="button"
                                    onClick={() => setCourseCode(course.code)}
                                    className="w-full text-left px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-all"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                            {course.name}
                                        </span>
                                        <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
                                            {course.code}
                                        </span>
                                    </div>
                                    <p className="text-sm text-zinc-500 mt-1">
                                        {course.description}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setStep('language')}
                    className="w-full mt-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                    ← {ui.back}
                </button>

                <p className="text-xs text-zinc-400 text-center mt-8">
                    Mentors International
                </p>
            </div>
        </div>
    );
}
