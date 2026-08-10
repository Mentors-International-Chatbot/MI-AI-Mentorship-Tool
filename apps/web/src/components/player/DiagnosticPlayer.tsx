"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { playerFetch } from "@/lib/player/client";
import "./player.css";

type Diagnostic = { id: string; title: string; description?: string; questions: Array<{ id: string; prompt: string; options?: string[] }> };

export function DiagnosticPlayer({ course }: { course: string }) {
  const router = useRouter();
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { playerFetch<Diagnostic>(`/api/learn/${course}/diagnostic`).then(setDiagnostic).catch((reason: Error) => setError(reason.message)); }, [course]);
  async function submit() {
    setBusy(true); setError("");
    try {
      await playerFetch(`/api/learn/${course}/diagnostic`, { method: "POST", body: JSON.stringify({ answers }) });
      const progress = await playerFetch<{ lessons: Array<{ lessonKey: string }> }>(`/api/learn/${course}/progress`);
      router.push(`/learn/${course}/${progress.lessons[0]?.lessonKey ?? "ai-day-in-the-life"}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to score diagnostic"); }
    finally { setBusy(false); }
  }
  if (!diagnostic) return <main className="player-shell"><p>{error || "Loading diagnostic…"}</p></main>;
  return <main className="player-shell"><header className="player-header"><div><span className="player-eyebrow">AI Essentials</span><h1>{diagnostic.title}</h1><p>{diagnostic.description}</p></div></header><section className="player-card diagnostic-card">{diagnostic.questions.map((question, index) => <fieldset key={question.id}><legend><span>{index + 1}</span>{question.prompt}</legend>{question.options?.map((option) => <label className="player-option" key={option}><input type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => setAnswers((value) => ({ ...value, [question.id]: option }))} />{option}</label>)}</fieldset>)}<button disabled={busy || diagnostic.questions.some((q) => !answers[q.id])} onClick={submit}>Finish diagnostic</button>{error && <p className="player-error">{error}</p>}</section></main>;
}
