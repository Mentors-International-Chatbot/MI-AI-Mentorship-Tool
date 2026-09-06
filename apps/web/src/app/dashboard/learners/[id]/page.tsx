export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { repo } from '@/lib/repo';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { mentorCanReachSocio } from '@/lib/repo/mentorVisibility';
import { verifySession } from '@/lib/auth/session';
import { computeSocioHealth, formatHealthReason } from '@/lib/health';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { resolveDashboardLanguage } from '@/lib/i18n/resolveDashboardLanguage';
import { resolveDashboardPanels } from '@/lib/journey-package/dashboard-panels';
import { resolveLocalized } from '@/lib/courses/course-meta';
import { loadPanelData, loadActivityStrip, loadBlockAnswers } from './panelData';
import { ChatHistory } from './ChatHistory';
import { ActivityStrip } from './ActivityStrip';
import { BlockAnswersPanel } from './BlockAnswersPanel';
import { SendMessageForm } from './SendMessageForm';
import { FlagsPanel } from './FlagsPanel';
import { AssistantPanel } from './AssistantPanel';
import { LessonProgressPanel } from './LessonProgressPanel';
import { SummaryPanel } from './SummaryPanel';
import { RevenueChart } from './RevenueChart';
import { DimensionTrendPanel } from './DimensionTrendPanel';
import { AssessmentScoresPanel } from './AssessmentScoresPanel';

const STATUS_COLORS: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
  GREEN: 'bg-green-500',
};

export default async function SocioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await verifySession();
  if (!session || session.role === 'socio') {
    redirect('/login');
  }

  const lang = await resolveDashboardLanguage();
  const t = getDashboardStrings(lang);

  const socio = await repo.getSocioById(id);
  if (!socio) notFound();

  // L5 stage 2: shared predicate — see lib/repo/mentorVisibility.ts. This was
  // a second, independent copy of verifyMentorOwnership's exact two-part
  // check (own it outright, or reach it org-wide if unassigned) before the
  // collapse — same posture as the alerts-page zone 0 org-wide fallback.
  if (session.role === 'mentor' && !(await mentorCanReachSocio(socio, session.userId))) {
    notFound();
  }

  // Collection slugs are only unique within an organization, so the course
  // lookup must be org-scoped. Resolved once here and shared with the panel
  // data loader rather than resolved twice per render. The resolution *source*
  // matters too: a default-org fallback is not a tenant identification, and
  // resolveDashboardPanels refuses to read a collection on that basis.
  const org = await tenantPrismaRepo.resolveOrganizationForSocio(id);

  // Panels are declared by the socio's course, so resolve them before loading
  // any panel data — an undeclared panel is never queried.
  const { panels: panelConfig, lessonCount } = await resolveDashboardPanels(
    { ...org, socioId: id },
    socio.curriculumCollectionKey,
  );

  const [health, progress, flags, messages, feedback, panels, activity, blockAnswers] = await Promise.all([
    computeSocioHealth(id),
    repo.getSocioProgress(id),
    repo.getFlags(id),
    // Unbounded and including reteach_gate/assessment turns: a mentor is
    // looking at the whole relationship, not reconstructing what the model
    // can see for its own next reply (that's the getMessages default).
    repo.getMessages(id, undefined, { includeAssessment: true }),
    repo.getFeedback(id),
    loadPanelData(id, org.organizationId, panelConfig),
    loadActivityStrip(id, org.organizationId),
    loadBlockAnswers(id, org.organizationId),
  ]);

  const latestFeedback = feedback[0] ?? null;

  const serializedMessages = messages.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    isAssessment: m.assessmentSessionId != null,
  }));

  // The resolution note lives on the FlagEvent, not the flag, so pull the
  // closing event for the ones actually showing a resolution.
  const resolutionNotes = new Map<string, string>();
  await Promise.all(
    flags
      .filter((f) => f.resolved)
      .map(async (f) => {
        const events = await repo.getFlagEvents(f.id);
        const closing = [...events].reverse().find((e) => e.eventType === 'resolved' && e.note);
        if (closing?.note) resolutionNotes.set(f.id, closing.note);
      }),
  );

  // "Resolved by <uuid>" is useless to a mentor; resolve the names once.
  const mentorNames = await repo.getMentorNames(
    [...new Set(flags.map((f) => f.resolvedBy).filter((v): v is string => !!v))],
  );

  const serializedFlags = flags.map((f) => ({
    ...f,
    source: f.source,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    snoozedUntil: f.snoozedUntil?.toISOString() ?? null,
    lastOccurredAt: f.lastOccurredAt?.toISOString() ?? null,
    resolutionNote: resolutionNotes.get(f.id) ?? null,
    resolvedByName: f.resolvedBy ? mentorNames[f.resolvedBy] ?? null : null,
  }));

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard/learners" className="text-sm text-[#1B2A4A] hover:underline">
          &larr; {t.backToSocios}
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className={`inline-block w-4 h-4 rounded-full ${STATUS_COLORS[health.status]}`} />
          <h2 className="text-2xl font-bold text-gray-900">{socio.name || t.noName}</h2>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
          <span>{t.channel}: {socio.channelType}</span>
          <span>{t.language}: {socio.language}</span>
          <span>{t.currentLesson}: {progress.currentLessonNumber}</span>
          {latestFeedback?.rating != null && (
            <span>
              {t.satisfactionLabel}:{' '}
              <span className="font-medium text-gray-900">{latestFeedback.rating}/10</span>
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {health.reasons.map((r, i) => (
            <span key={i} className="mr-3">{formatHealthReason(r, t)}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Chat + Send */}
        <div className="lg:col-span-2 space-y-4">
          {activity && <ActivityStrip lessons={activity.lessons} />}
          <ChatHistory socioId={id} messages={serializedMessages} />
          <BlockAnswersPanel blocks={blockAnswers} />
          <SendMessageForm socioId={id} initialAiPaused={socio.aiPaused} />
        </div>

        {/* Right column: mentor tooling, then the course's declared panels */}
        <div className="space-y-6">
          {/* D.3: direct slider UI removed — a mentor no longer hand-tunes
              complexity/warmth/positivity. The underlying mechanism (Socio.
              promptOverrides, written via PATCH /api/mentor/socios/[id]) is
              unchanged and is what the embedded assistant's
              adjust_learner_overrides tool will write to on the mentor's
              confirmed behalf. */}
          <FlagsPanel flags={serializedFlags} socioId={id} />

          {/* D.3: mentor-only — its API guard (verifyMentorOwnership) also
              authorizes admin, but not course_lead, so this must not render
              for a role the backend would 403. */}
          {(session.role === 'mentor' || session.role === 'admin') && (
            <AssistantPanel socioId={id} />
          )}

          {panels.map((panel, i) => {
            switch (panel.type) {
              case 'lesson_progress':
                return (
                  <LessonProgressPanel
                    key={`${panel.type}-${i}`}
                    lessonProgress={panel.lessonProgress}
                    lessonCount={lessonCount}
                  />
                );
              case 'assessment_scores':
                return (
                  <AssessmentScoresPanel
                    key={`${panel.type}-${i}`}
                    title={
                      panel.title
                        ? resolveLocalized(panel.title, lang)
                        : t.assessmentScoresTitle
                    }
                    rows={panel.rows}
                  />
                );
              case 'weekly_summary':
                return (
                  <SummaryPanel
                    key={`${panel.type}-${i}`}
                    socioId={id}
                    summaries={panel.summaries}
                  />
                );
              case 'financial_snapshots':
                return <RevenueChart key={`${panel.type}-${i}`} data={panel.points} />;
              case 'dimension_trend':
                return (
                  <DimensionTrendPanel
                    key={`${panel.type}-${panel.dimensionKey}-${i}`}
                    title={
                      panel.title
                        ? resolveLocalized(panel.title, lang)
                        : t.dimensionTrendTitle(panel.label)
                    }
                    points={panel.points}
                    scale={panel.scale}
                  />
                );
            }
          })}
        </div>
      </div>
    </div>
  );
}
