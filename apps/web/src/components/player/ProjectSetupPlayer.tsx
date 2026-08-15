"use client";

import { useEffect, useMemo, useState } from "react";
import { playerFetch } from "@/lib/player/client";
import "./player.css";

type InterestTopic = { key: string; label: string };
type Project = {
  id: string;
  presetKey: string | null;
  title: string | null;
  oneLiner: string | null;
  context: string | null;
  automationLevel: string | null;
  interests: string[];
  status: "DRAFT" | "ACTIVE" | "CHANGED" | "ABANDONED";
  lifeContext: string | null;
  reframedAt: string | null;
  automationValidatedAt: string | null;
  confirmedAt: string | null;
};
type Proposal = { presetKey: string; idea: string; tieBack: string };
type SetupSnapshot = {
  phase: "life" | "proposals" | "scope" | "name";
  proposals?: Proposal[];
  selectedPresetKey?: string;
  assistantMessage?: string;
  scopeResponse?: string;
};

function projectCard(project: Project) {
  return <section className="player-card project-confirm-card">
    <span className="player-step">{project.status === "ACTIVE" ? "Project confirmed" : "Ready to confirm"}</span>
    <h2>{project.title || "Name your project"}</h2>
    <p>{project.oneLiner}</p>
    {project.context && <p><strong>Where it lives:</strong> {project.context}</p>}
    {project.automationLevel && <p><strong>Automation level:</strong> {project.automationLevel}</p>}
    {project.reframedAt && <p className="project-reframe-note">This idea was reframed so it can run again without being rebuilt.</p>}
  </section>;
}

export function ProjectSetupPlayer({ course }: { course: string }) {
  const [topics, setTopics] = useState<InterestTopic[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [lifeContext, setLifeContext] = useState("");
  const [scopeResponse, setScopeResponse] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    playerFetch<{ interestTopics: InterestTopic[]; project: Project | null }>(`/api/learn/${course}/project-setup`)
      .then((data) => {
        if (!active) return;
        setTopics(data.interestTopics);
        setProject(data.project);
        setSelected(data.project?.interests ?? []);
        setLifeContext(data.project?.lifeContext ?? "");
        if (data.project?.status === "DRAFT" && data.project.automationValidatedAt) {
          setSnapshot({ phase: "name" });
          return;
        }
        if (data.project?.id) {
          const stored = window.sessionStorage.getItem(`oci_project_setup:${data.project.id}`);
          if (stored) {
            try { setSnapshot(JSON.parse(stored) as SetupSnapshot); return; } catch { /* restart below */ }
          }
        }
        if (data.project?.status === "DRAFT" && data.project.interests.length === 5) setSnapshot({ phase: "life" });
      })
      .catch((reason: Error & { status?: number }) => {
        if (!active) return;
        if (reason.status === 404) setMissing(true);
        else setError(reason.message);
      });
    return () => { active = false; };
  }, [course]);

  useEffect(() => {
    if (!project?.id || !snapshot || project.status !== "DRAFT") return;
    window.sessionStorage.setItem(`oci_project_setup:${project.id}`, JSON.stringify(snapshot));
  }, [project?.id, project?.status, snapshot]);

  const progress = useMemo(() => {
    if (!snapshot) return 20;
    return { life: 40, proposals: 60, scope: 80, name: 100 }[snapshot.phase];
  }, [snapshot]);

  function toggleInterest(key: string) {
    setSelected((value) => value.includes(key)
      ? value.filter((item) => item !== key)
      : value.length < 5 ? [...value, key] : value);
  }

  async function saveInterests() {
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ project: Project }>(`/api/learn/${course}/project-setup`, {
        method: "POST", body: JSON.stringify({ action: "select_interests", interests: selected }),
      });
      setProject(result.project); setSnapshot({ phase: "life" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save interests"); }
    finally { setBusy(false); }
  }

  async function requestProposals() {
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ message: string; proposals: Proposal[] }>(`/api/learn/${course}/project-setup`, {
        method: "POST", body: JSON.stringify({ action: "proposals", lifeContext }),
      });
      setProject((value) => value ? { ...value, lifeContext } : value);
      setSnapshot({ phase: "proposals", proposals: result.proposals, assistantMessage: result.message });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to suggest projects"); }
    finally { setBusy(false); }
  }

  async function chooseProposal(presetKey: string) {
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ message: string }>(`/api/learn/${course}/project-setup`, {
        method: "POST", body: JSON.stringify({ action: "scope", presetKey }),
      });
      setSnapshot((value) => ({ ...value, phase: "scope", selectedPresetKey: presetKey, assistantMessage: result.message }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to scope this project"); }
    finally { setBusy(false); }
  }

  async function finalizeScope() {
    if (!snapshot?.selectedPresetKey) return;
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ message: string; project: Project }>(`/api/learn/${course}/project-setup`, {
        method: "POST",
        body: JSON.stringify({ action: "finalize", presetKey: snapshot.selectedPresetKey, scopeResponse }),
      });
      setProject(result.project);
      setSnapshot({ phase: "name", selectedPresetKey: result.project.presetKey ?? snapshot.selectedPresetKey, assistantMessage: result.message, scopeResponse });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This project needs a smaller repeatable shape"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ project: Project }>(`/api/learn/${course}/project-setup`, {
        method: "PUT", body: JSON.stringify({ title }),
      });
      setProject(result.project);
      if (project?.id) window.sessionStorage.removeItem(`oci_project_setup:${project.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to confirm project"); }
    finally { setBusy(false); }
  }

  if (missing) return null;
  if (error && topics.length === 0) return <main className="player-shell"><p className="player-error">{error}</p></main>;
  if (topics.length === 0) return <main className="player-shell"><p>Loading project setup…</p></main>;
  if (project?.status === "ACTIVE") return <main className="player-shell"><header className="player-header"><div><span className="player-eyebrow">AI Essentials project</span><h1>Your project is ready</h1></div></header>{projectCard(project)}</main>;

  return <main className="player-shell project-setup-shell">
    <header className="player-header"><div><span className="player-eyebrow">AI Essentials project setup</span><h1>Choose something worth building</h1><p>Start with real life, then make one small thing repeat.</p></div><div className="player-progress"><span style={{ width: `${progress}%` }} /></div></header>

    {!snapshot && <section className="player-card"><span className="player-step">Interests · pick exactly five</span><h2>What do you want AI to help you do?</h2><div className="project-interest-grid">{topics.map((topic) => {
      const checked = selected.includes(topic.key);
      return <button type="button" className="project-choice-card" aria-pressed={checked} disabled={!checked && selected.length === 5} onClick={() => toggleInterest(topic.key)} key={topic.key}><span>{checked ? "✓" : "+"}</span>{topic.label}</button>;
    })}</div><p className="project-choice-count">{selected.length} of 5 selected</p><button disabled={busy || selected.length !== 5} onClick={saveInterests}>Continue</button>{error && <p className="player-error">{error}</p>}</section>}

    {snapshot?.phase === "life" && <section className="player-card"><span className="player-step">Turn 1 · your life</span><h2>What is already in your week?</h2><p>Think about a class, job, club, team, family business, or task that keeps coming back.</p><textarea rows={6} value={lifeContext} onChange={(event) => setLifeContext(event.target.value)} placeholder="For example: I take notes for our club meetings, then spend an hour turning them into an update…" /><button disabled={busy || !lifeContext.trim()} onClick={requestProposals}>Find three possibilities</button>{error && <p className="player-error">{error}</p>}</section>}

    {snapshot?.phase === "proposals" && <section className="player-card"><span className="player-step">Turn 2 · three possibilities</span><p className="project-assistant-message">{snapshot.assistantMessage}</p><div className="project-proposal-grid">{snapshot.proposals?.map((proposal) => <button type="button" className="project-proposal-card" disabled={busy} onClick={() => chooseProposal(proposal.presetKey)} key={proposal.presetKey}><strong>{proposal.idea}</strong><span>{proposal.tieBack}</span></button>)}</div>{error && <p className="player-error">{error}</p>}</section>}

    {snapshot?.phase === "scope" && <section className="player-card"><span className="player-step">Turn 3 · make it small</span><p className="project-assistant-message">{snapshot.assistantMessage}</p><textarea rows={5} value={scopeResponse} onChange={(event) => setScopeResponse(event.target.value)} placeholder="Describe what should happen each time, and what can stay the same…" /><button disabled={busy || !scopeResponse.trim()} onClick={finalizeScope}>Check the automation</button>{error && <p className="player-error">{error}</p>}</section>}

    {snapshot?.phase === "name" && project && <div className="project-name-grid"><section className="player-card"><span className="player-step">Turn 4 · name it</span><p className="project-assistant-message">{snapshot.assistantMessage || "This passes the automation test. Give it a name you will recognize."}</p><label className="project-name-label">Project name<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="My weekly club recap" /></label><button disabled={busy || !title.trim()} onClick={confirm}>Confirm this project</button>{error && <p className="player-error">{error}</p>}</section>{projectCard({ ...project, title: title || project.title })}</div>}
  </main>;
}
