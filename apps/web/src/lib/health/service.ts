import { repo } from '@/lib/repo';
import type { SocioFlag, SocioProgress } from '@/lib/repo/types';

export type HealthStatus = 'RED' | 'YELLOW' | 'GREEN';

export interface SocioHealth {
    status: HealthStatus;
    reasons: string[];
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
): SocioHealth {
    const reasons: string[] = [];
    let status: HealthStatus = 'GREEN';

    const unresolvedRed = flags.filter(f => f.level === 'RED' && !f.resolved);
    const unresolvedYellow = flags.filter(f => f.level === 'YELLOW' && !f.resolved);

    // RED conditions
    if (unresolvedRed.length > 0) {
        status = 'RED';
        reasons.push(`${unresolvedRed.length} alerta(s) roja(s) sin resolver`);
    }

    const daysSinceInteraction = progress.lastInteractionAt
        ? (Date.now() - progress.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
        : null;

    if (daysSinceInteraction !== null && daysSinceInteraction > 21) {
        status = 'RED';
        reasons.push(`Inactivo por ${Math.floor(daysSinceInteraction)} días`);
    }

    if (progress.weeklyUnderstanding !== null && progress.weeklyUnderstanding <= 4) {
        status = 'RED';
        reasons.push(`Comprensión baja: ${progress.weeklyUnderstanding}/10`);
    }

    // YELLOW conditions (only upgrade if not already RED)
    if (status !== 'RED') {
        if (unresolvedYellow.length > 0) {
            status = 'YELLOW';
            reasons.push(`${unresolvedYellow.length} alerta(s) amarilla(s) sin resolver`);
        }

        if (daysSinceInteraction !== null && daysSinceInteraction > 7 && daysSinceInteraction <= 21) {
            status = 'YELLOW';
            reasons.push(`Inactivo por ${Math.floor(daysSinceInteraction)} días`);
        }

        if (progress.weeklyUnderstanding !== null && progress.weeklyUnderstanding >= 5 && progress.weeklyUnderstanding <= 6) {
            status = 'YELLOW';
            reasons.push(`Comprensión moderada: ${progress.weeklyUnderstanding}/10`);
        }
    }

    if (status === 'GREEN') {
        reasons.push('Sin alertas');
    }

    return { status, reasons };
}
