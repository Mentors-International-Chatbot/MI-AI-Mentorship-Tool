'use client';

import { useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';
import type { DashboardStrings } from '@/lib/i18n/dashboard';

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
};

const FLAG_DOT: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
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
  const [resolving, setResolving] = useState<string | null>(null);

  const filtered = showResolved ? flags : flags.filter((f) => !f.resolved);
  const unresolvedCount = flags.filter((f) => !f.resolved).length;
  const resolvedCount = flags.length - unresolvedCount;

  async function handleResolve(flagId: string) {
    setResolving(flagId);
    try {
      const res = await fetch(`/api/dashboard/flags/${flagId}/resolve`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = (await res.json()) as {
          resolved?: boolean;
          resolvedAt?: string | null;
          resolvedBy?: string | null;
        };
        setFlags((prev) =>
          prev.map((f) =>
            f.id === flagId
              ? {
                  ...f,
                  resolved: true,
                  resolvedAt: data.resolvedAt
                    ? new Date(data.resolvedAt).toISOString()
                    : new Date().toISOString(),
                  resolvedBy: data.resolvedBy ?? f.resolvedBy,
                }
              : f,
          ),
        );
      }
    } catch (err) {
      console.error('Failed to resolve flag:', err);
    }
    setResolving(null);
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Make legacy auto-sentiment reasons (Spanish key=value) more readable
  function formatReason(reason: string, source: string): string {
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

      {filtered.length === 0 && (
        <p className="text-sm text-gray-400">{t.noAlerts}</p>
      )}

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {filtered.map((flag) => (
          <div
            key={flag.id}
            className={`flex items-start gap-2 text-sm p-2 rounded ${
              flag.resolved ? 'opacity-40 bg-gray-50' : 'bg-white'
            }`}
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${FLAG_DOT[flag.level]}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-gray-700">{formatReason(flag.reason, flag.source)}</p>
              <p className="text-xs text-gray-400">
                {formatDate(flag.createdAt)}
                {' · '}
                {sourceLabel(flag.source, t)}
                {flag.resolved && ` · ${t.resolved}`}
              </p>
            </div>
            {!flag.resolved && (
              <button
                type="button"
                onClick={() => void handleResolve(flag.id)}
                disabled={resolving === flag.id}
                className="text-xs text-green-600 hover:text-green-700 hover:underline flex-shrink-0 disabled:opacity-50"
              >
                {resolving === flag.id ? '…' : t.resolveFlag}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
