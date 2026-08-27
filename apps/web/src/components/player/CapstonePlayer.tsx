"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { playerFetch } from "@/lib/player/client";
import { usePlayerThread } from "./usePlayerThread";
import "./player.css";

type Capstone = {
  project: { title: string; description?: string; deliverables: Array<{ name: string; description?: string }> };
  milestones: Array<{ key: string; name: string; available: boolean; reached: boolean; status: "reached" | "current" | "locked" }>;
  nextMilestone: { key: string; name: string } | null;
  completedMilestones: number; graduated: boolean;
  /** First course lesson that isn't fully complete (last lesson if the whole course is). */
  currentLessonKey: string | null;
};

export function CapstonePlayer({ course }: { course: string }) {
  const [data, setData] = useState<Capstone | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState(false);
  const { messages, reload: loadThread } = usePlayerThread(course, "capstone");
  useEffect(() => { playerFetch<Capstone>(`/api/learn/${course}/capstone`).then(setData).catch((reason: Error) => setError(reason.message)); }, [course]);
  async function send() {
    if (!message.trim()) return;
    const content = message.trim(); setBusy(true); setError("");
    try {
      const result = await playerFetch<{ response: string; isError?: boolean }>("/api/chat", { method: "POST", body: JSON.stringify({ message: content, context: { surface: "player", courseCode: course, lessonKey: "capstone", intent: "capstone" } }) });
      setHandoffNotice(!result.response.trim());
      await loadThread();
      setMessage("");
      setData(await playerFetch<Capstone>(`/api/learn/${course}/capstone`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to reach AI Mentor"); }
    finally { setBusy(false); }
  }
  async function explainMore() {
    setBusy(true); setError("");
    try {
      await playerFetch<{ response: string }>("/api/chat", { method: "POST", body: JSON.stringify({ context: { surface: "player", courseCode: course, lessonKey: "capstone", intent: "expand", parentIntent: "capstone" } }) });
      await loadThread();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to expand the reply"); }
    finally { setBusy(false); }
  }
  if (!data) return <main className="player-shell"><p>{error || "Loading capstone…"}</p></main>;
  return <main className="player-shell"><header className="player-header"><div>{data.currentLessonKey && <div className="player-nav"><Link className="player-home-link" href={`/learn/${course}/${data.currentLessonKey}`}>← Back to lesson</Link></div>}<span className="player-eyebrow">AI Essentials capstone</span><h1>{data.project.title}</h1><p>{data.project.description}</p>{data.nextMilestone && <p><strong>Next:</strong> {data.nextMilestone.name}</p>}</div><div className="player-progress"><span style={{ width: `${data.completedMilestones * 20}%` }} /></div></header><div className="capstone-grid"><section className="player-card"><h2>Deliverables</h2><ol>{data.project.deliverables.map((item) => <li key={item.name}><strong>{item.name}</strong>{item.description && <p>{item.description}</p>}</li>)}</ol><h2>Milestones</h2><ol>{data.milestones.map((item) => <li key={item.key} className={item.status === "locked" ? "capstone-locked" : ""}>{item.status === "reached" ? "✓" : item.status === "current" ? "○" : "🔒"} {item.name}</li>)}</ol>{data.graduated && <p className="capstone-graduated">Capstone complete — 100%</p>}</section><aside className="player-card"><h2>Work with AI Mentor</h2><div className="capstone-chat">{messages.map((item, index) => {
    const isHumanMentor = item.role === "assistant" && item.senderType === "mentor";
    const canExpand = item.role === "assistant" && !isHumanMentor && item.metadata?.intent === "capstone" && index === messages.length - 1;
    return <div key={item.id} className={`player-message ${item.role === "user" ? "learner" : "mentor"}${isHumanMentor ? " human-mentor" : ""}`}><strong>{item.role === "user" ? "You" : isHumanMentor ? "Your Mentor" : "AI Mentor"}</strong>{isHumanMentor ? <p>{item.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>}{canExpand && <button type="button" className="player-chip" disabled={busy} aria-label="Ask AI Mentor to explain the previous reply in more detail" onClick={explainMore}>Explain more</button>}</div>;
  })}</div>{handoffNotice && <p className="player-teachback-hint">Your mentor has this and will follow up.</p>}<textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe your evidence or ask for coaching…" /><button disabled={busy || !message.trim()} onClick={send}>Send</button>{error && <p className="player-error">{error}</p>}</aside></div></main>;
}
