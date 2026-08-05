import { repo } from '@/lib/repo';
import { isFlagActive } from '@/lib/flags/active';
import type { SocioFlag, SocioProgress } from '@/lib/repo/types';

export type HealthStatus = 'RED' | 'YELLOW' | 'GREEN';

/**
 * Why a socio landed on their health status.
 *
 * Structured rather than pre-rendered text: this is the data layer, which has
 * no view of the dashboard viewer's language. Formatting happens at the render
 * layer via `formatHealthReason`, so the same descriptor reads correctly for a
 * Spanish, English, or Portuguese mentor.
 *
 * Plain data — these cross the server → client boundary as props.
 */
export type HealthReason =
    | { kind: 'unresolved_alerts'; count: number; severity: 'red' | 'yellow' }
    | { kind: 'inactive'; days: number }
    | { kind: 'low_understanding'; score: number }
    | { kind: 'moderate_understanding'; score: number }
    | { kind: 'none' };

export interface SocioHealth {
    status: HealthStatus;
    reasons: HealthReason[];
}

export async function computeSocioHealth(socioId: string): Promise<SocioHealth> {
    const [flags, progress] = await Promise.all([
        repo.getFlags(socioId),
        repo.getSocioProgress(socioId),
    ]);

    return computeHealthFromData(flags, progress);
}

export function computeHealthFromData(
    flags: SocioFlag[],
    progress: SocioProgress,
    now: Date = new Date(),
): SocioHealth {
    const reasons: HealthReason[] = [];
    let status: HealthStatus = 'GREEN';

    const active = flags.filter(f => isFlagActive(f, now));
    const unresolvedRed = active.filter(f => f.level === 'RED');
    const unresolvedYellow = active.filter(f => f.level === 'YELLOW');

    // RED conditions
    if (unresolvedRed.length > 0) {
        status = 'RED';
        reasons.push({ kind: 'unresolved_alerts', count: unresolvedRed.length, severity: 'red' });
    }

    const daysSinceInteraction = progress.lastInteractionAt
        ? (now.getTime() - progress.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
        : null;

    if (daysSinceInteraction !== null && daysSinceInteraction > 21) {
        status = 'RED';
        reasons.push({ kind: 'inactive', days: Math.floor(daysSinceInteraction) });
    }

    if (progress.weeklyUnderstanding !== null && progress.weeklyUnderstanding <= 4) {
        status = 'RED';
        reasons.push({ kind: 'low_understanding', score: progress.weeklyUnderstanding });
    }

    // YELLOW conditions (only upgrade if not already RED)
    if (status !== 'RED') {
        if (unresolvedYellow.length > 0) {
            status = 'YELLOW';
            reasons.push({
                kind: 'unresolved_alerts',
                count: unresolvedYellow.length,
                severity: 'yellow',
            });
        }

        if (daysSinceInteraction !== null && daysSinceInteraction > 7 && daysSinceInteraction <= 21) {
            status = 'YELLOW';
            reasons.push({ kind: 'inactive', days: Math.floor(daysSinceInteraction) });
        }

        if (progress.weeklyUnderstanding !== null && progress.weeklyUnderstanding >= 5 && progress.weeklyUnderstanding <= 6) {
            status = 'YELLOW';
            reasons.push({ kind: 'moderate_understanding', score: progress.weeklyUnderstanding });
        }
    }

    if (status === 'GREEN') {
        reasons.push({ kind: 'none' });
    }

    return { status, reasons };
}
