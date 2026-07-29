import type { DashboardStrings } from '@/lib/i18n/dashboard';
import type { HealthReason } from './service';

/**
 * Renders a {@link HealthReason} in the dashboard viewer's language.
 *
 * The render-layer half of the split: `computeHealthFromData` decides *why* a
 * socio has their status, this decides how to say it. Exhaustive over the union
 * — adding a reason kind without a string is a compile error, not a blank cell.
 */
export function formatHealthReason(reason: HealthReason, t: DashboardStrings): string {
    switch (reason.kind) {
        case 'unresolved_alerts':
            return reason.severity === 'red'
                ? t.healthReasonRedAlerts(reason.count)
                : t.healthReasonYellowAlerts(reason.count);
        case 'inactive':
            return t.healthReasonInactive(reason.days);
        case 'low_understanding':
            return t.healthReasonLowUnderstanding(reason.score);
        case 'moderate_understanding':
            return t.healthReasonModerateUnderstanding(reason.score);
        case 'none':
            return t.healthReasonNone;
    }
}
