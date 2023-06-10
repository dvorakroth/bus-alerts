import { DateTime } from "luxon";
import { AlertUseCase, AlertWithRelatedInDb, DepartureChanges } from "../dbTypes.js";
import { JERUSALEM_TZ, compareTuple, extractCityFromStopDesc, inPlaceSortAndUniqueCustom, lineNumberForSorting, parseUnixtimeIntoJerusalemTz } from "../generalJunkyard.js";
import { GtfsDbApi, RouteMetadata } from "./gtfsDbApi.js";

type AlertAdditionalData = {
    added_stops: [string, string][]; // stop_code, stop_name
    removed_stops: [string, string][]; // ditto
    relevant_lines: Record<string, string[]>; // agency_id -> [route_short_name, route_short_name, ...]
    relevant_agencies: {agency_id: string, agency_name: string}[];

    first_relevant_date: null|DateTime;
    current_active_period_start: null|DateTime;

    departure_changes: Record<string, Record<string, DepartureChangeDetail[]>>; // agency_id -> line_number -> [change, change, change, ...]
}

async function enrichAlerts(alerts: AlertWithRelatedInDb[], gtfsDbApi: GtfsDbApi) {
    // chew up and regurgitate the data a bit for the client
    // like a wolf mother for her tiny adorable wolf pups

    const metadata = await gtfsDbApi.getRelatedMetadataForAlerts(alerts);

    const result: Record<string, AlertAdditionalData> = {}; // alert_id -> additional data

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

        const departure_changes = await getDepartureChanges(alert, gtfsDbApi);

        result[alert.id] = {
            added_stops,
            removed_stops,
            relevant_lines,
            relevant_agencies,
            first_relevant_date,
            current_active_period_start,
            departure_changes
        };
    }

    // TODO sort? compose the alerts into the final api type?

    return [result, metadata];
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

type DepartureChangeDetail = RouteMetadata & {
    to_text: string,
    added_hours: string[],
    removed_hours: string[]
};

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

function findRepresentativeDateForRouteChangesInAlert(alert: AlertWithRelatedInDb) {
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
        for (const [start, end] of activePeriodsParsed) {
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

async function getHeadsign(tripId: string, rawStopSeq: string[]|null = null, gtfsDbApi: GtfsDbApi) {
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
