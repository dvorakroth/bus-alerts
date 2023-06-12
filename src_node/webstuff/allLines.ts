import { DateTime } from "luxon";
import { ActualLineWithAlertCount, Agency, AllLinesResponse } from "../apiTypes.js";
import { AlertWithRelatedInDb } from "../dbTypes.js";
import { alertFindNextRelevantDate } from "./alerts.js";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GroupedRoutes } from "./routeGrouping.js";
import winston from "winston";
import { JERUSALEM_TZ, compareNple, lineNumberForSorting, minimumDate } from "../generalJunkyard.js";

export async function getAllLines(
    alertsDbApi: AlertsDbApi,
    groupedRoutes: GroupedRoutes
): Promise<AllLinesResponse> {
    const alerts = await alertsDbApi.getAlerts();
    const firstRelevantDates: Record<string, DateTime> = {};

    const linepkToAlerts: Record<string, AlertWithRelatedInDb[]> = {};
    const linepkToRemovedStopIds: Record<string, Set<string>> = {};

    for (const alert of alerts) {
        if (alert.is_deleted || alert.is_expired) continue;

        const [firstRelevantDate, _] = alertFindNextRelevantDate(alert);
        if (!firstRelevantDate) continue;

        firstRelevantDates[alert.id] = firstRelevantDate;

        for (const route_id of alert.relevant_route_ids) {
            const pk = groupedRoutes.actualLinesByRouteId[route_id];
            if (!pk) {
                winston.debug(`route_id ${route_id} not found in actualLinesByRouteId; ignoring`);
                continue;
            }

            const alertsForLine = linepkToAlerts[pk]
                ?? (linepkToAlerts[pk] = []);
            
            const removedStopIdsForLine = linepkToRemovedStopIds[pk]
                ?? (linepkToRemovedStopIds[pk] = new Set());
            
            alertsForLine.push(alert);
            alert.removed_stop_ids.forEach(stopId => removedStopIdsForLine.add(stopId));
        }
    }

    const todayInJerusalem = DateTime.now().setZone(JERUSALEM_TZ).set({
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
    });

    const all_lines: ActualLineWithAlertCount[] = [];

    for (const actualLine of groupedRoutes.actualLinesList) {
        const alertsForLine = linepkToAlerts[actualLine.pk] ?? [];
        const removedStopIds = linepkToRemovedStopIds[actualLine.pk] ?? new Set();

        const withAlertCount = <ActualLineWithAlertCount>{
            ...actualLine,
            num_alerts: alertsForLine.length,
            first_relevant_date: minimumDate(
                (function *() {
                    for (const alert of alertsForLine) {
                        const frd = firstRelevantDates[alert.id];
                        if (!frd) continue;
                        yield frd;
                    }
                })()
            ),
            num_relevant_today: alertsForLine.filter(
                alert => {
                    const frd = firstRelevantDates[alert.id];
                    return frd && frd.toSeconds() === todayInJerusalem.toSeconds();
                }
            ).length,
            num_removed_stops: [...removedStopIds].filter(
                stop_id => actualLine.all_stopids_distinct.includes(stop_id)
            ).length,

            all_directions_grouped: undefined
        };

        all_lines.push(withAlertCount);
    }

    const lines_with_alert = all_lines
        .filter(({num_alerts}) => num_alerts > 0)
        .sort(
            (a, b) => compareNple(
                lineWithAlertSortingNple(a, groupedRoutes.allAgencies),
                lineWithAlertSortingNple(b, groupedRoutes.allAgencies)
            )
        );
    
    return {
        all_lines,
        lines_with_alert,
        all_agencies: groupedRoutes.allAgencies,
        uses_location: false
    };
}

function lineWithAlertSortingNple(
    line: ActualLineWithAlertCount,
    allAgencies: Record<string, Agency>
) {
    return [
        -line.num_alerts,
        lineNumberForSorting(line.route_short_name),
        allAgencies[line.agency_id]?.agency_name ?? ""
    ];
}
