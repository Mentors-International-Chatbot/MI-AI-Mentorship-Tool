"use client";

import Link from "next/link";
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
  hasCapstone,
}: {
  dashboard: LessonDashboard;
  course: string;
  lessonKey: string;
  blockId?: string;
  helpRequestEnabled: boolean;
  /** Whether this course has a capstone page to link the progress card to. Not every projectSelection course declares an outcome. */
  hasCapstone: boolean;
}) {
  const { project, nextMilestone } = dashboard;
  const pct = dashboard.lessonsTotal > 0
    ? Math.round((100 * dashboard.lessonsComplete) / dashboard.lessonsTotal)
    : 0;

  return (
    <aside className="player-dash" aria-label={project ? "Your project" : "Your progress"}>
      {/*
        `project` is nullable: a course can have the progress panel on
        without `projectSelection` configured, or a learner may not have
        confirmed a project yet even on a course that has it. The whole card
        is what "Your project" names, so absent a project it doesn't render
        at all — a defensive guard, not a new empty-state design. The
        aside's own label follows the same branch so it never claims a
        project section that isn't there.
      */}
      {project && (
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
      )}

      <section className="player-dash-card">
        {/*
          Clickable whenever this course has a capstone to click through to —
          not every projectSelection course declares an outcome, so this
          can't just follow from `dashboard` existing.
        */}
        {hasCapstone ? (
          <Link className="player-dash-progress-link" href={`/learn/${course}/capstone`} aria-label="Open the capstone project">
            <span className="player-eyebrow">Progress</span>
          </Link>
        ) : (
          <span className="player-eyebrow">Progress</span>
        )}
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

        {/*
          The whole course journey, not just the current lesson's slice of
          it — every lesson this course declares, in course order. The
          bar above already summarizes this; this is the same data,
          per-lesson, so a learner can see where they actually are in the
          five (or six, or ten) lesson arc rather than only a fraction.
        */}
        {dashboard.lessons.length > 0 && (
          <ol className="player-dash-lessons">
            {dashboard.lessons.map((lesson) => (
              <li
                key={lesson.lessonKey}
                className={`player-dash-ls${lesson.complete ? " is-complete" : ""}${lesson.lessonKey === lessonKey ? " is-current" : ""}`}
              >
                <span aria-hidden="true" className="player-dash-ls-mark">
                  {lesson.complete ? "✓" : lesson.lessonKey === lessonKey ? "○" : "·"}
                </span>
                <span>{lesson.title}</span>
              </li>
            ))}
          </ol>
        )}

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
