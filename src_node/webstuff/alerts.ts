import { DateTime } from "luxon";
import { AlertWithRelatedInDb } from "../dbTypes.js";
import { JERUSALEM_TZ, compareTuple, inPlaceSortAndUniqueCustom, lineNumberForSorting, parseUnixtimeIntoJerusalemTz } from "../generalJunkyard.js";
import { GtfsDbApi } from "./gtfsDbApi.js";

type AlertAdditionalData = {
    added_stops: [string, string][]; // stop_code, stop_name
    removed_stops: [string, string][]; // ditto
    relevant_lines: Record<string, string[]>; // agency_id -> [route_short_name, route_short_name, ...]
    relevant_agencies: {agency_id: string, agency_name: string}[];

    first_relevant_date: null|DateTime;
    current_active_period_start: null|DateTime;
}

async function enrichAlerts(alerts: AlertWithRelatedInDb[], gtfsDbApi: GtfsDbApi) {
    // chew up and regurgitate the data a bit for the client
    // like a wolf mother for her tiny adorable wolf pups

    const metadata = await gtfsDbApi.getRelatedMetadataForAlerts(alerts);

    const result: AlertAdditionalData[] = [];

    for (const alert of alerts) {
        const added_stops: [string, string][] = [];
        const removed_stops: [string, string][] = [];
        const relevant_lines_sets: Record<string, Set<string>> = {};

        for (const stopId of alert.added_stop_ids) {
            const stop = metadata.stops[stopId];
            if (stop)
                added_stops.push([stop.stop_code, stop.stop_name]);
        }

        for (const stopId of alert.removed_stop_ids) {
            const stop = metadata.stops[stopId];
            if (stop)
                removed_stops.push([stop.stop_code, stop.stop_name]);
        }

        for (const routeId of alert.relevant_route_ids) {
            const route = metadata.routes[routeId];
            if (!route) continue;

            const linesForAgency = relevant_lines_sets[route.agency_id] || (
                relevant_lines_sets[route.agency_id] = new Set()
            );
            linesForAgency.add(route.route_short_name);
        }

        // man these sort comparators are probably inefficient as heck now that
        // we're no longer using python huh
        // though honestly all of python (and most of js) is inefficient as it is
        // and the requests are all gonna be cached anyway so meh whatever
        inPlaceSortAndUniqueCustom(
            added_stops,
            ([aStopCode], [bStopCode]) => compareTuple(
                lineNumberForSorting(aStopCode),
                lineNumberForSorting(bStopCode)
            ),
            ([a, aa], [b, bb]) => a === b && aa === bb
        );
        inPlaceSortAndUniqueCustom(
            removed_stops,
            ([aStopCode], [bStopCode]) => compareTuple(
                lineNumberForSorting(aStopCode),
                lineNumberForSorting(bStopCode)
            ),
            ([a, aa], [b, bb]) => a === b && aa === bb
        );

        const relevant_lines: Record<string, string[]> = {};
        for (const [agency_id, lineSet] of Object.entries(relevant_lines_sets)) {
            relevant_lines[agency_id] = [...lineSet].sort(
                (a, b) => compareTuple(
                    lineNumberForSorting(a),
                    lineNumberForSorting(b)
                )
            );
        }

        const relevant_agencies = [];
        for (const agencyId of alert.relevant_agencies) {
            const agency = metadata.agencies[agencyId];
            if (agency)
                relevant_agencies.push(agency);
        }
        relevant_agencies.sort(
            ({agency_name: a}, {agency_name: b}) => {
                if (a > b) return 1;
                else if (a < b) return -1;
                else return 0;
            }
        );

        const [first_relevant_date, current_active_period_start] = alertFindNextRelevantDate(alert);

        // TODO departure changes

        result.push({
            added_stops,
            removed_stops,
            relevant_lines,
            relevant_agencies,
            first_relevant_date,
            current_active_period_start
        });
    }

    return result;
}

function alertFindNextRelevantDate(alert: AlertWithRelatedInDb): [null|DateTime, null|DateTime] {
    if (alert.is_deleted || alert.is_expired) return [null, null];

    const todayInJerusalem = DateTime.now().setZone(JERUSALEM_TZ).set({
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
    });

    // convert list of active_periods from unixtime to DateTime objects with the israeli timezone
    const activePeriodsParsed = alert.active_periods.raw.map(
        ([start, end]) => [parseUnixtimeIntoJerusalemTz(start), parseUnixtimeIntoJerusalemTz(end)]
    );

    // find next relevant date
    let firstRelevantDate: null|DateTime = null;
    let currentActivePeriodStart = null;

    for (const [start, end] of activePeriodsParsed) {
        // make sure this period hasn't expired yet; if it has, ignore it
        if (end && end.toSeconds() <= todayInJerusalem.toSeconds()) {
            continue;
        }

        // if this period already started (given it's not expired), then it's relevant to today
        if (!start || start.toSeconds() <= todayInJerusalem.toSeconds()) {
            firstRelevantDate = todayInJerusalem;
            currentActivePeriodStart = start
                ? start
                : DateTime.fromISO("1970-01-01T00:00:00.000", {zone: JERUSALEM_TZ});
            break; // definitely relevant to today, so stop iterating
        }

        // period is in the future
        const startDay = start.set({
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0
        });

        if (!firstRelevantDate || startDay.toSeconds() < firstRelevantDate.toSeconds()) {
            firstRelevantDate = startDay;
            currentActivePeriodStart = start;
        }
    }

    return [firstRelevantDate, currentActivePeriodStart];
}