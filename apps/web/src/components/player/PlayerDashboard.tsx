"use client";

import type { LessonDashboard } from "@/lib/player/dashboard";
import { HelpRequestPanel } from "./HelpRequestPanel";

/**
 * The right rail: what the learner is building, and how this lesson sits in it.
 *
 * Reads a server-built payload and renders it. No fetching, no derivation — if
 * something here needs computing, it belongs in `lib/player/dashboard.ts` where
 * it can be tested without a browser.
 *
 * Lesson progress is the headline and milestones are the structure beneath it.
 * That ordering is a property of the published milestone set, not a style
 * choice; see the docblock in `lib/player/dashboard.ts`.
 */
export function PlayerDashboard({
  dashboard,
  course,
  lessonKey,
  blockId,
  helpRequestEnabled,
}: {
  dashboard: LessonDashboard;
  course: string;
  lessonKey: string;
  blockId?: string;
  helpRequestEnabled: boolean;
}) {
  const { project, nextMilestone } = dashboard;
  const pct = dashboard.lessonsTotal > 0
    ? Math.round((100 * dashboard.lessonsComplete) / dashboard.lessonsTotal)
    : 0;

  return (
    <aside className="player-dash" aria-label="Your project">
      <section className="player-dash-card player-dash-project">
        <span className="player-eyebrow">Your project</span>
        <h2>{project.title}</h2>
        {project.oneLiner && <p className="player-dash-oneliner">{project.oneLiner}</p>}

        {dashboard.graduated ? (
          <p className="player-dash-next player-dash-graduated">All milestones complete</p>
        ) : nextMilestone ? (
          <p className="player-dash-next">
            <span className="player-dash-label">Next</span>
            {nextMilestone.name}
            {/*
              A locked "next" is still worth naming — it tells the learner where
              they are heading — but it must say what unblocks it, or it reads as
              something they failed to do.
            */}
            {nextMilestone.locked && nextMilestone.unlocksAfterLessonTitle && (
              <span className="player-dash-unlock">
                Unlocks after {nextMilestone.unlocksAfterLessonTitle}
              </span>
            )}
          </p>
        ) : null}
      </section>

      <section className="player-dash-card">
        <span className="player-eyebrow">Progress</span>
        <p className="player-dash-count">
          <strong>{dashboard.lessonsComplete}</strong> of {dashboard.lessonsTotal} lessons
        </p>
        <div
          className="player-dash-bar"
          role="progressbar"
          aria-valuenow={dashboard.lessonsComplete}
          aria-valuemin={0}
          aria-valuemax={dashboard.lessonsTotal}
          aria-label={`${dashboard.lessonsComplete} of ${dashboard.lessonsTotal} lessons complete`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>

        {dashboard.milestones.length > 0 && (
          <>
            <p className="player-dash-sub">
              {dashboard.milestonesReached} of {dashboard.milestones.length} milestones
            </p>
            <ol className="player-dash-milestones">
              {dashboard.milestones.map((milestone) => (
                <li key={milestone.key} className={`player-dash-ms is-${milestone.status}`}>
                  <span aria-hidden="true" className="player-dash-ms-mark">
                    {milestone.status === "reached" ? "✓" : milestone.status === "current" ? "○" : "·"}
                  </span>
                  <span>{milestone.name}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {helpRequestEnabled && (
        <section className="player-dash-card">
          <HelpRequestPanel course={course} lessonKey={lessonKey} blockId={blockId} />
        </section>
      )}
    </aside>
  );
}
