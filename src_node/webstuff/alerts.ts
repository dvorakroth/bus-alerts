import { DateTime } from "luxon";
import { AlertUseCase, AlertWithRelatedInDb } from "../dbTypes.js";
import { JERUSALEM_TZ, arrayToDict, compareNple, compareTuple, extractCityFromStopDesc, lineNumberForSorting, parseUnixtimeIntoJerusalemTz } from "../generalJunkyard.js";
import { AlertSupplementalMetadata, GtfsDbApi } from "./gtfsDbApi.js";
import { AlertForApi, DepartureChangeDetail } from "../apiTypes.js";

export type AllAlertsResult = {
    rawAlertsById: Record<string, AlertWithRelatedInDb>,
    alerts: AlertForApi[],
    metadata: AlertSupplementalMetadata
};

export async function enrichAlerts(
    alertsRaw: AlertWithRelatedInDb[],
    gtfsDbApi: GtfsDbApi
): Promise<AllAlertsResult> {
    // chew up and regurgitate the data a bit for the client
    // like a wolf mother for her tiny adorable wolf pups

    const metadata = await gtfsDbApi.getRelatedMetadataForAlerts(alertsRaw);

    const result: AlertForApi[] = [];

    for (const alert of alertsRaw) {
        const added_stop_codes = alert.added_stop_ids.map(
            stop_id => metadata.stops[stop_id]?.stop_code ?? ""
        );
        const removed_stop_codes = alert.removed_stop_ids.map(
            stop_id => metadata.stops[stop_id]?.stop_code ?? ""
        );

        const added_stops = await gtfsDbApi.getStopsSortedByTripCount(
            added_stop_codes
        );
        const removed_stops = await gtfsDbApi.getStopsSortedByTripCount(
            removed_stop_codes
        );
        const relevant_lines_sets: Record<string, Set<string>> = {};

        for (const routeId of alert.relevant_route_ids) {
            const route = metadata.routes[routeId];
            if (!route) continue;

            const line_pk = route.route_short_name + "_" + (route.route_desc.split("-")[0] ?? "");

            const linesForAgency = relevant_lines_sets[route.agency_id] || (
                relevant_lines_sets[route.agency_id] = new Set()
            );
            linesForAgency.add(line_pk);
        }

        const relevant_lines: Record<string, string[]> = {};
        for (const [agency_id, lineSet] of Object.entries(relevant_lines_sets)) {
            relevant_lines[agency_id] = [...lineSet].sort(
                (a, b) => compareTuple(
                    lineNumberForSorting(a.split("_")[0] ?? a),
                    lineNumberForSorting(b.split("_")[0] ?? b)
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

        const departure_changes = await getDepartureChanges(alert, gtfsDbApi);

        result.push({
            ...alert,
            added_stops,
            removed_stops,
            relevant_lines,
            relevant_agencies,
            first_relevant_date,
            current_active_period_start,
            departure_changes
        });
    }

    sortAlerts(result);

    return {
        alerts: result,
        metadata,
        rawAlertsById: arrayToDict(alertsRaw, a => a.id)
    };
}

export function sortAlerts(alertsForApi: AlertForApi[]) {
    alertsForApi.sort((a, b) => compareNple(alertSortingNple(a), alertSortingNple(b)));
}

function alertSortingNple(alert: AlertForApi) {
    return [
        alert.is_expired ? 1 : 0,
        alert.is_deleted ? 1 : 0,
        alert.distance ?? Infinity,
        (alert.current_active_period_start ?? alert.last_end_time).toSeconds(),
        (alert.is_expired || alert.is_deleted) ? (alert.is_national ? 0 : 1) : 0
    ] as const;
}

export function alertFindNextRelevantDate(alert: AlertWithRelatedInDb, wholeTimestamp = false): [null|DateTime, null|DateTime] {
    if (alert.is_deleted || alert.is_expired) return [null, null];

    const nowInJerusalem = DateTime.now().setZone(JERUSALEM_TZ);
    const todayInJerusalem = nowInJerusalem.set({
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
        if (end && end.toSeconds() <= nowInJerusalem.toSeconds()) {
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
        const startDay = wholeTimestamp
            ? start
            : start.set({
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

async function getDepartureChanges(alert: AlertWithRelatedInDb, gtfsDbApi: GtfsDbApi) {
    // 1. if no departure changes, return {}; get representative date and prepare result variable

    if (alert.use_case !== AlertUseCase.ScheduleChanges) {
        return {};
    }

    const result: Record<string, Record<string, DepartureChangeDetail[]>> = {};
    const representativeDate = findRepresentativeDateForRouteChangesInAlert(alert);
    const allRouteMetadata = await gtfsDbApi.getRouteMetadata(alert.relevant_route_ids);

    for (const route_id of alert.relevant_route_ids) {
        // 2. get metadata and compute headsign (upside down smiley)
        const routeMetadata = allRouteMetadata[route_id];

        if (!routeMetadata) {
            continue; // ignore bad route_ids, because, apparently, that's a thing that happens????
        }

        const representativeTripId = await gtfsDbApi.getRepresentativeTripId(route_id, representativeDate);
        const to_text = representativeTripId
            ? await getHeadsign(representativeTripId, null, gtfsDbApi)
            : "???";
        
        // 3. extract the departure changes from the less-nice data structure
        const chgs = alert.schedule_changes?.[route_id];
        const added_hours = chgs?.added ?? [];
        const removed_hours = chgs?.removed ?? [];

        // 4. add to the dict
        const agency_id = routeMetadata.agency_id;
        const line_number = routeMetadata.line_number;
        
        const departureChangeDetail = {
            ...routeMetadata,
            to_text,
            added_hours,
            removed_hours
        };

        const agencyChgs = (
            result[agency_id] ?? (result[agency_id] = {})
        );

        const lineChgs = (
            agencyChgs[line_number] ?? (agencyChgs[line_number] = [])
        );

        lineChgs.push(departureChangeDetail);
    }

    // 5. do the same sort as in getRouteChanges
    // NOTE: i wrote that comment, and then time did its thing(?) and apparently
    // this is now a different sort? lol who knows good luck have fun future me!
    for (const agencyChgs of Object.values(result)) {
        for (const lineChgs of Object.values(agencyChgs)) {
            lineChgs.sort(
                ({to_text: a}, {to_text: b}) => (
                    a < b
                        ? -1
                        : a > b
                        ? 1
                        : 0
                )
            );
        }
    }

    return result;
}

export function findRepresentativeDateForRouteChangesInAlert(alert: AlertWithRelatedInDb) {
    const activePeriodsParsed = alert.active_periods.raw.map(
        ([start, end]) => [parseUnixtimeIntoJerusalemTz(start), parseUnixtimeIntoJerusalemTz(end)]
    );

    const todayInJerusalem = DateTime.now().setZone(JERUSALEM_TZ).set({
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
    });

    let representativeDate: DateTime|null = null;

    if (alert.is_expired) {
        for (const [_, end] of activePeriodsParsed) {
            if (!end) {
                return todayInJerusalem;
            }

            if (!representativeDate || end.toSeconds() > representativeDate.toSeconds()) {
                representativeDate = end;
            }
        }
    } else if (alert.is_deleted) {
        return alert.last_end_time.set({
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0
        });
        // TODO maybe instead, return the date when the alert was deleted? or the minimum between them?
    } else {
        for (const [start, end] of activePeriodsParsed) {
            if (!end && !start) {
                // unbounded period - use today
                return todayInJerusalem;
            }

            if (end && end.toSeconds() <= todayInJerusalem.toSeconds()) {
                // period already ended; skip it
                continue;
            }

            if (!start || start.toSeconds() <= todayInJerusalem.toSeconds()) {
                // period is active now!
                return todayInJerusalem;
            }

            // period is in the future
            if (!representativeDate || start.toSeconds() < representativeDate.toSeconds()) {
                representativeDate = start;
            }
        }
    }

    return representativeDate ?? todayInJerusalem;
}

export async function getHeadsign(tripId: string, rawStopSeq: string[]|null = null, gtfsDbApi: GtfsDbApi) {
    const headsign = await gtfsDbApi.getTripHeadsign(tripId);

    if (headsign) {
        return headsign.replace("_", " - ");
    }

    if (!rawStopSeq) {
        rawStopSeq = await gtfsDbApi.getStopSeq(tripId)
    }

    const firstStopId = rawStopSeq[0] ?? "";
    const lastStopId = rawStopSeq[rawStopSeq.length - 1] ?? "";

    const endStopsDesc = await gtfsDbApi.getStopDesc([firstStopId, lastStopId]);

    const firstStopCity = extractCityFromStopDesc(endStopsDesc[firstStopId] ?? "");
    const lastStopCity  = extractCityFromStopDesc(endStopsDesc[lastStopId] ?? "");

    if (firstStopCity !== lastStopCity) {
        return lastStopCity;
    } else {
        const lastStopObj = await gtfsDbApi.getRelatedMetadata([], [], [lastStopId]);
        return lastStopObj.stops[lastStopId]?.stop_name ?? "";
    }
}

