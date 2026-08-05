import type { Prisma } from '@prisma/client';

/**
 * Single source of truth for "does this flag still need attention".
 *
 * Two expressions of one predicate: `isFlagActive` for rows already in memory,
 * `activeFlagWhere` for the database. They MUST agree — `__tests__/active.test.ts`
 * runs a fixture set through both and asserts identical id sets, because a TS
 * predicate and a where clause drift silently otherwise. That drift is exactly
 * how `/dashboard/alerts` and health came to disagree about snoozed flags.
 *
 * Semantics:
 *   active = not resolved
 *            AND not AUTO_CLOSED
 *            AND (not SNOOZED, or the snooze has already expired)
 *
 * ACKNOWLEDGED is active: a mentor saying "I've seen this" is not the same as
 * the underlying problem going away.
 */

/** The fields the predicate reads. Structural, so both SocioFlag and lighter row shapes fit. */
export type FlagLike = {
    resolved: boolean;
    status: string;
    snoozedUntil: Date | null;
};

export function isFlagActive(flag: FlagLike, now: Date = new Date()): boolean {
    if (flag.resolved) return false;
    if (flag.status === 'AUTO_CLOSED') return false;
    if (flag.status === 'SNOOZED') {
        // A snooze with no end date would hide the flag forever, so it does not
        // count as snoozed at all. This is the one place the SQL below needs an
        // explicit `snoozedUntil: null` arm: `{ lte: now }` drops NULL rows.
        if (flag.snoozedUntil === null) return true;
        return flag.snoozedUntil.getTime() <= now.getTime();
    }
    return true;
}

export function activeFlagWhere(now: Date = new Date()): Prisma.SocioFlagWhereInput {
    return {
        resolved: false,
        status: { not: 'AUTO_CLOSED' },
        OR: [
            { status: { not: 'SNOOZED' } },
            { snoozedUntil: { lte: now } },
            { snoozedUntil: null },
        ],
    };
}
