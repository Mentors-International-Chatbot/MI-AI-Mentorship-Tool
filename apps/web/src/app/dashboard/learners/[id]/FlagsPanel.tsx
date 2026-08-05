'use client';

import { useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';
import type { DashboardStrings } from '@/lib/i18n/dashboard';
import { isFlagActive } from '@/lib/flags/active';
import {
  FLAG_DISPOSITIONS,
  SNOOZE_DAYS,
  type FlagDisposition,
  type FlagReasonCode,
  type FlagReasonParams,
  type SnoozeDays,
} from '@/lib/repo/types';

type SerializedFlag = {
  id: string;
  socioId: string;
  level: 'RED' | 'YELLOW';
  reason: string;
  source: string;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  messageId?: string | null;
  /** Null on rows written before the structured-reason migration. */
  reasonCode?: string | null;
  reasonParams?: Record<string, unknown> | null;
  status?: string | null;
  disposition?: string | null;
  snoozedUntil?: string | null;
  /** Pulled from the closing FlagEvent by the server component. */
  resolutionNote?: string | null;
  /** Display name for `resolvedBy`, which is otherwise just a uuid. */
  resolvedByName?: string | null;
};

const FLAG_DOT: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
};

const BADGE_STYLE: Record<string, string> = {
  OPEN: 'bg-gray-100 text-gray-600',
  ACKNOWLEDGED: 'bg-blue-100 text-blue-700',
  SNOOZED: 'bg-purple-100 text-purple-700',
  RESOLVED: 'bg-green-100 text-green-700',
};

function sourceLabel(source: string, t: DashboardStrings): string {
  switch (source) {
    case 'ai_marker':
      return t.flagSourceAI;
    case 'sentiment_auto':
      return t.flagSourceAuto;
    case 'mentor_manual':
      return t.flagSourceMentor;
    default:
      return source;
  }
}

function moodLabel(raw: string, t: DashboardStrings): string {
  switch (raw.toLowerCase()) {
    case 'distressed':
      return t.sentimentDistressed;
    case 'negative':
      return t.sentimentNegative;
    case 'neutral':
      return t.sentimentNeutral;
    case 'positive':
      return t.sentimentPositive;
    default:
      return raw;
  }
}

/**
 * Scrolls the transcript to the message that produced a flag and flashes it, so
 * the mentor can see the words behind the alert without hunting for them.
 */
function jumpToMessage(messageId: string) {
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-offset-2', 'ring-blue-500');
  window.setTimeout(() => {
    el.classList.remove('ring-2', 'ring-offset-2', 'ring-blue-500');
  }, 2000);
}

export function FlagsPanel({
  flags: initialFlags,
  socioId,
}: {
  flags: SerializedFlag[];
  socioId: string;
}) {
  const { lang, t } = useDashboardLang();
  const [flags, setFlags] = useState(initialFlags);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** id of the flag whose inline resolve form is open */
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<FlagDisposition | null>(null);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // "Open" here means the same thing it means to health and to /dashboard/alerts:
  // a snoozed flag is not shown until its snooze expires.
  const isActive = (f: SerializedFlag) =>
    isFlagActive({
      resolved: f.resolved,
      status: f.status ?? 'OPEN',
      snoozedUntil: f.snoozedUntil ? new Date(f.snoozedUntil) : null,
    });

  const filtered = showResolved ? flags : flags.filter(isActive);
  const unresolvedCount = flags.filter(isActive).length;
  const resolvedCount = flags.length - unresolvedCount;

  function patchFlag(flagId: string, patch: Partial<SerializedFlag>) {
    setFlags((prev) => prev.map((f) => (f.id === flagId ? { ...f, ...patch } : f)));
  }

  function closeForms() {
    setResolvingId(null);
    setSnoozingId(null);
    setDisposition(null);
    setNote('');
    setFormError(null);
  }

  async function post(flagId: string, action: string, body: unknown): Promise<Response | null> {
    setBusy(flagId);
    try {
      return await fetch(`/api/dashboard/flags/${flagId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    } catch (err) {
      console.error(`Failed to ${action} flag:`, err);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleAcknowledge(flagId: string) {
    const res = await post(flagId, 'acknowledge', {});
    if (res?.ok) patchFlag(flagId, { status: 'ACKNOWLEDGED' });
    else setFormError(t.flagActionError);
  }

  async function handleSnooze(flagId: string, days: SnoozeDays) {
    const res = await post(flagId, 'snooze', { days });
    if (res?.ok) {
      const updated = (await res.json()) as { snoozedUntil?: string | null };
      patchFlag(flagId, {
        status: 'SNOOZED',
        snoozedUntil:
          updated.snoozedUntil ??
          new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
      });
      closeForms();
    } else {
      setFormError(t.flagActionError);
    }
  }

  async function handleResolve(flag: SerializedFlag) {
    if (!disposition) {
      setFormError(t.flagDispositionRequiredError);
      return;
    }
    if (flag.level === 'RED' && note.trim().length === 0) {
      setFormError(t.flagNoteRequiredError);
      return;
    }

    const res = await post(flag.id, 'resolve', {
      disposition,
      note: note.trim() || undefined,
      linkedMessageId: flag.messageId ?? undefined,
    });

    if (res?.ok) {
      const updated = (await res.json()) as {
        resolvedAt?: string | null;
        resolvedBy?: string | null;
        resolvedByName?: string | null;
      };
      patchFlag(flag.id, {
        resolved: true,
        status: 'RESOLVED',
        disposition,
        resolutionNote: note.trim() || null,
        resolvedByName: updated.resolvedByName ?? flag.resolvedByName,
        resolvedAt: updated.resolvedAt
          ? new Date(updated.resolvedAt).toISOString()
          : new Date().toISOString(),
        resolvedBy: updated.resolvedBy ?? flag.resolvedBy,
      });
      closeForms();
    } else {
      setFormError(t.flagActionError);
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function statusBadge(flag: SerializedFlag): { label: string; style: string } {
    if (flag.resolved) {
      return { label: t.flagStatusResolved, style: BADGE_STYLE.RESOLVED };
    }
    if (flag.status === 'SNOOZED' && flag.snoozedUntil) {
      return {
        label: t.flagStatusSnoozedUntil(formatDate(flag.snoozedUntil)),
        style: BADGE_STYLE.SNOOZED,
      };
    }
    if (flag.status === 'ACKNOWLEDGED') {
      return { label: t.flagStatusSeen, style: BADGE_STYLE.ACKNOWLEDGED };
    }
    return { label: t.flagStatusOpen, style: BADGE_STYLE.OPEN };
  }

  // Structured flags render from the i18n table, in the mentor's language.
  // Older rows fall through to the legacy parser, then to the raw text.
  function formatReason(flag: SerializedFlag): string {
    if (flag.reasonCode) {
      const render = t.flagReason[flag.reasonCode as FlagReasonCode];
      if (render) {
        return render((flag.reasonParams ?? {}) as FlagReasonParams);
      }
    }
    return formatLegacyReason(flag.reason, flag.source);
  }

  // Make legacy auto-sentiment reasons (Spanish key=value) more readable
  function formatLegacyReason(reason: string, source: string): string {
    if (source !== 'sentiment_auto') {
      return reason;
    }

    const urgMatch = reason.match(/urgencia=(\d+)/i);
    const sentMatch = reason.match(/sentimiento=(\w+)/i);
    const confMatch = reason.match(/confusión=(\d+)/i);
    const frustMatch = reason.match(/frustración=(\d+)/i);

    const parts: string[] = [];
    if (urgMatch) parts.push(`${t.flagUrgency}: ${urgMatch[1]}/10`);
    if (confMatch) parts.push(`${t.flagConfusion}: ${confMatch[1]}/10`);
    if (frustMatch) parts.push(`${t.flagFrustration}: ${frustMatch[1]}/10`);
    if (sentMatch) {
      parts.push(`${t.flagMood}: ${moodLabel(sentMatch[1], t)}`);
    }

    return parts.length > 0 ? parts.join(' · ') : reason;
  }

  return (
    <div className="bg-white rounded-lg shadow p-4" data-socio-id={socioId}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">
          {t.alertsTitle}
          {unresolvedCount > 0 && (
            <span className="ml-2 text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">
              {unresolvedCount}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setShowResolved(!showResolved)}
          className="text-xs text-blue-600 hover:underline"
        >
          {showResolved
            ? `${t.hideResolved} (${resolvedCount})`
            : `${t.showResolved} (${resolvedCount})`}
        </button>
      </div>

      {filtered.length === 0 && <p className="text-sm text-gray-400">{t.noAlerts}</p>}

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filtered.map((flag) => {
          const badge = statusBadge(flag);
          const noteRequired = flag.level === 'RED';
          return (
            <div
              key={flag.id}
              className={`flex items-start gap-2 text-sm p-2 rounded ${
                flag.resolved ? 'opacity-50 bg-gray-50' : 'bg-white'
              }`}
            >
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${FLAG_DOT[flag.level]}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-gray-700">{formatReason(flag)}</p>

                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
                  <span className={`text-xs rounded-full px-2 py-0.5 ${badge.style}`}>
                    {badge.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDate(flag.createdAt)}
                    {' · '}
                    {sourceLabel(flag.source, t)}
                  </span>
                  {flag.messageId && (
                    <button
                      type="button"
                      onClick={() => jumpToMessage(flag.messageId as string)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {t.flagViewMessage}
                    </button>
                  )}
                </div>

                {/* Resolved: what was decided, by whom, and when. */}
                {flag.resolved && (
                  <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                    {flag.disposition && (
                      <p>{t.flagDisposition[flag.disposition as FlagDisposition] ?? flag.disposition}</p>
                    )}
                    {flag.resolutionNote && (
                      <p className="text-gray-600 italic">“{flag.resolutionNote}”</p>
                    )}
                    {flag.resolvedAt && (
                      <p>
                        {t.flagResolvedBy(
                          flag.resolvedByName ?? flag.resolvedBy ?? '—',
                          formatDate(flag.resolvedAt),
                        )}
                      </p>
                    )}
                  </div>
                )}

                {/* Snooze picker */}
                {snoozingId === flag.id && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-600">{t.flagSnoozePrompt}</span>
                    {SNOOZE_DAYS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={busy === flag.id}
                        onClick={() => void handleSnooze(flag.id, d)}
                        className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {t.flagSnoozeDays(d)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={closeForms}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      {t.flagActionCancel}
                    </button>
                  </div>
                )}

                {/* Inline resolve form */}
                {resolvingId === flag.id && (
                  <div className="mt-2 border border-gray-200 rounded p-2 space-y-2">
                    <fieldset>
                      <legend className="text-xs font-medium text-gray-700 mb-1">
                        {t.flagDispositionLegend}
                      </legend>
                      <div className="space-y-1">
                        {FLAG_DISPOSITIONS.map((d) => (
                          <label key={d} className="flex items-center gap-2 text-xs text-gray-700">
                            <input
                              type="radio"
                              name={`disposition-${flag.id}`}
                              value={d}
                              checked={disposition === d}
                              onChange={() => {
                                setDisposition(d);
                                setFormError(null);
                              }}
                            />
                            {t.flagDisposition[d]}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div>
                      <label
                        htmlFor={`note-${flag.id}`}
                        className="block text-xs font-medium text-gray-700 mb-1"
                      >
                        {noteRequired ? t.flagNoteLabelRequired : t.flagNoteLabelOptional}
                      </label>
                      <textarea
                        id={`note-${flag.id}`}
                        value={note}
                        required={noteRequired}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setFormError(null);
                        }}
                        placeholder={t.flagNotePlaceholder}
                        rows={2}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                      />
                    </div>

                    {formError && <p className="text-xs text-red-600">{formError}</p>}

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={busy === flag.id}
                        onClick={() => void handleResolve(flag)}
                        className="text-xs text-white bg-green-600 hover:bg-green-700 rounded px-2 py-1 disabled:opacity-50"
                      >
                        {busy === flag.id ? '…' : t.flagActionConfirmResolve}
                      </button>
                      <button
                        type="button"
                        onClick={closeForms}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        {t.flagActionCancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!flag.resolved && resolvingId !== flag.id && snoozingId !== flag.id && (
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {flag.status !== 'ACKNOWLEDGED' && (
                    <button
                      type="button"
                      disabled={busy === flag.id}
                      onClick={() => void handleAcknowledge(flag.id)}
                      className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {t.flagActionAcknowledge}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      closeForms();
                      setSnoozingId(flag.id);
                    }}
                    className="text-xs text-purple-600 hover:underline"
                  >
                    {t.flagActionSnooze}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeForms();
                      setResolvingId(flag.id);
                    }}
                    className="text-xs text-green-600 hover:underline"
                  >
                    {t.flagActionResolve}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
