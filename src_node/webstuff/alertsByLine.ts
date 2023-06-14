import { DateTime } from "luxon";
import { ActualLineWithAlertCount, Agency, AlertForApi, AlertPeriod, AllLinesResponse, LineDetails, SingleLineChanges } from "../apiTypes.js";
import { AlertWithRelatedInDb } from "../dbTypes.js";
import { AllAlertsResult, alertFindNextRelevantDate } from "./alerts.js";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GroupedRoutes } from "./routeGrouping.js";
import winston from "winston";
import { JERUSALEM_TZ, arrayToDictDifferent, compareNple, compareTuple, lineNumberForSorting, minimumDate, zip } from "../generalJunkyard.js";
import { GtfsDbApi } from "./gtfsDbApi.js";
import { ApplyAlertState, applyAlertToRoute, boundingBoxForStops, doesAlertHaveRouteChanges, labelHeadsignsForDirectionAndAlternative } from "./routeChgs.js";

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

export async function getSingleLine(
    linePk: string,
    allAlerts: AllAlertsResult,
    groupedRoutes: GroupedRoutes,
    gtfsDbApi: GtfsDbApi
): Promise<SingleLineChanges|null> {
    const actualLine = groupedRoutes.actualLinesDict[linePk];
    if (!actualLine) return null;

    const agency = groupedRoutes.allAgencies[actualLine.agency_id]
        ?? {agency_id: actualLine.agency_id, agency_name: "??"};

    const line_details = <LineDetails>{
        pk: linePk,
        route_short_name: actualLine.route_short_name,
        agency,
        headsign_1: actualLine.headsign_1,
        headsign_2: actualLine.headsign_2,
        is_night_line: actualLine.is_night_line,
        dirs_flattened: []
    };

    const allStopIds = new Set(actualLine.all_stopids_distinct);

    // the thought behind flattening the directions is that i want just one
    // consolidated list shown to the user and sorted by the server, because
    // flattening and sorting it in a react component would be silly(?)

    // collect these for the labelHeadsignsForDirectionAndAlternative function
    const headsignToDirAltPairs: Record<string, [string, string][]> = {};
    const headsignsCollected = new Set<string>();
    const dirAltPairsCollected: [string, string][] = [];

    const todayInJerusalem = DateTime.now().setZone(JERUSALEM_TZ).set({
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
    });

    // the actual flattening:
    for (const alt of actualLine.all_directions_grouped) {
        for (const dir of alt.directions) {
            const representativeTripId = await gtfsDbApi.getRepresentativeTripId(
                dir.route_id,
                todayInJerusalem
            );

            const flatDir = {
                ...dir,
                alt_id: alt.alt_id,
                stop_seq: representativeTripId ? await gtfsDbApi.getStopSeq(representativeTripId) : [],
                shape: representativeTripId ? await gtfsDbApi.getShapePoints(representativeTripId) : [],
                other_alerts: [],
                alert_periods: [],
                dir_name: null,
                alt_name: null
            };
            line_details.dirs_flattened.push(flatDir);

            dirAltPairsCollected.push([dir.dir_id, alt.alt_id]);
            if (dir.headsign !== null) {
                headsignsCollected.add(dir.headsign);
                const dirAltPairsForHeadsign = headsignToDirAltPairs[dir.headsign]
                    ?? (headsignToDirAltPairs[dir.headsign] = []);
                dirAltPairsForHeadsign.push([dir.dir_id, alt.alt_id]);
            }
        }
    }

    // collect alerts for each direction in dirs_flattened
    const alerts_grouped: [AlertForApi, AlertWithRelatedInDb][][] = [];

    for (const flatDir of line_details.dirs_flattened) {
        const alertsForThisDirection: [AlertForApi, AlertWithRelatedInDb][] = [];

        for (const alert of allAlerts.alerts) {
            if (alert.is_expired) continue;

            const alertRaw = allAlerts.rawAlertsById[alert.id];
            if (!alertRaw?.relevant_route_ids?.includes(flatDir.route_id)) continue;

            alertsForThisDirection.push([alert, alertRaw]);
        }

        alerts_grouped.push(alertsForThisDirection);
    }

    for (const [flatDir, alertPairs] of zip(line_details.dirs_flattened, alerts_grouped)) {
        const routeChangeAlerts: [AlertForApi, AlertWithRelatedInDb][] = [];

        // at first, just get every alert's route_changes (but limited to each route_id) on its own
        for (const [alert, alertRaw] of alertPairs) {
            if (doesAlertHaveRouteChanges(alertRaw)) {
                routeChangeAlerts.push([alert, alertRaw]);
            } else {
                const agency_id = line_details.agency.agency_id;
                const line_number = line_details.route_short_name;

                const alertMinimal = {
                    header: alert.header,
                    description: alert.description,
                    active_periods: alert.active_periods,
                    is_deleted: alert.is_deleted,
                    departure_change: alert.departure_changes[agency_id]?.[line_number]?.find(
                        depChg => depChg.route_id === flatDir.route_id
                    )
                };
                flatDir.other_alerts.push(alertMinimal)
            }
        }

        if(!routeChangeAlerts.length) {
            continue;
        }

        flatDir.route_change_alerts = {
            periods: [],
            alertMetadata: alertPairs.map(([{id, header}, _]) => ({id, header}))
        };

        // now after we got all those alerts we can actually do the ~*~*MAGIC*~*~

        // divide the routeChangeAlerts active_periods.raw into a sequence of nicer periods
        const alertPeriods = listOfAlertsToActivePeriodIntersectionsAndBitmasks(routeChangeAlerts);

        for (const period of alertPeriods) {
            const startDate = DateTime.fromSeconds(period.start, {zone: JERUSALEM_TZ}).set({
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            });

            let state: ApplyAlertState|null = null;

            for (let i = 0; i < alertPairs.length; i++) {
                const alertRaw = alertPairs[i]?.[1];
                if (!alertRaw) continue;

                const idxBitmask = (1 << i);
                const isActive = (period.bitmask & idxBitmask) !== 0;

                if (!isActive) {
                    continue;
                }

                state = await applyAlertToRoute(
                    gtfsDbApi,
                    alertRaw,
                    flatDir.route_id,
                    allStopIds,
                    state?.representativeDate ?? startDate,
                    state?.representativeTripId ?? null,
                    state?.rawStopSeq ?? null,
                    state?.updatedStopSeq ?? null,
                    state?.deletedStopIds ?? null
                ) as ApplyAlertState|null;
                // for some inscrutable reason, if i don't include the
                // "as ApplyAlertState|null" here, tsc yells at me??????
                // idk, whatever
            }

            const representativeTripId = state?.representativeTripId
                ? state.representativeTripId
                : await gtfsDbApi.getRepresentativeTripId(flatDir.route_id, startDate);

            if (state?.updatedStopSeq) {
                flatDir.route_change_alerts.periods.push({
                    ...period,
                    updated_stop_sequence: state.updatedStopSeq,
                    deleted_stop_ids: [...state.deletedStopIds],
                    raw_stop_seq: state.rawStopSeq ?? [],
                    shape: state.representativeTripId
                        ? await gtfsDbApi.getShapePoints(state.representativeTripId)
                        : null
                });
            } else {
                const stopSeq = representativeTripId
                    ? await gtfsDbApi.getStopSeq(representativeTripId)
                    : [];

                flatDir.route_change_alerts.periods.push({
                    ...period,
                    updated_stop_sequence: stopSeq.map(s => [s, false]),
                    deleted_stop_ids: [],
                    raw_stop_seq: stopSeq,
                    shape: representativeTripId
                        ? await gtfsDbApi.getShapePoints(representativeTripId)
                        : null
                })
            }
        }
    }

    const all_stops = await gtfsDbApi.getStopMetadata([...allStopIds]);
    const map_bounding_box = boundingBoxForStops(
        Object.keys(all_stops),
        all_stops
    );

    // if a shape is missing then just make shit up
    for (const dir of line_details.dirs_flattened) {
        if (!dir.shape?.length) {
            dir.shape = [];

            for (const stop_id of dir.stop_seq) {
                const stop = all_stops[stop_id];
                if (!stop) continue;

                dir.shape.push([stop.stop_lon, stop.stop_lat]);
            }
        }

        for (const period of dir.route_change_alerts?.periods ?? []) {
            if (!period.shape?.length) {
                period.shape = [...dir.shape];
            }
        }

        // TODO better map bbox?
    }

    const dirAltNames = labelHeadsignsForDirectionAndAlternative(
        // man i have NO IDEA what the FUCK i was doing here lol
        // but that's what this code looked like in the old server
        // so you bet your ass i'm just keeping it as it is! enjoy:
        arrayToDictDifferent(
            [...headsignsCollected],
            h => h,
            _ => dirAltPairsCollected
        ),
        headsignToDirAltPairs,
        line_details.dirs_flattened.map(d => [d.headsign ?? "??", [d.dir_id, d.alt_id]]),
        true
    );

    for (const [dir, [dir_name, alt_name]] of zip(line_details.dirs_flattened, dirAltNames)) {
        dir.dir_name = dir_name;
        dir.alt_name = alt_name;
    }

    line_details.dirs_flattened.sort(
        (a, b) => compareTuple(
            [a.dir_name ?? "", a.alt_name ?? ""],
            [b.dir_name ?? "", b.alt_name ?? ""]
        )
    );

    return {
        all_stops,
        line_details,
        map_bounding_box
    };
}

const NEBULOUS_DISTANT_FUTURE = DateTime.fromISO("2200-01-01T00:00:00.000Z").toSeconds();

function listOfAlertsToActivePeriodIntersectionsAndBitmasks(
    alertPairs: [AlertForApi, AlertWithRelatedInDb][]
) {
    const allActivePeriodBoundaires: {timestamp: number, alertIdx: number, isEnd: boolean}[] = [];

    for (let i = 0; i < alertPairs.length; i++) {
        const rawActivePeriods = alertPairs[i]?.[0]?.active_periods.raw;
        if (!rawActivePeriods) continue;

        for (const [start, end] of rawActivePeriods) {
            allActivePeriodBoundaires.push({
                timestamp: start || 0, 
                alertIdx: i,
                isEnd: false
            });
            allActivePeriodBoundaires.push({
                timestamp: end || NEBULOUS_DISTANT_FUTURE,
                alertIdx: i,
                isEnd: true
            });
        }
    }

    allActivePeriodBoundaires.sort(
        (a, b) => compareNple(
            [a.timestamp, a.alertIdx, a.isEnd],
            [b.timestamp, b.alertIdx, b.isEnd]
        )
    );
    
    const allPeriods: AlertPeriod[] = [];
    let currentPeriod: AlertPeriod|null = null;

    for (const {timestamp, alertIdx, isEnd} of allActivePeriodBoundaires) {
        if (!currentPeriod) {
            // this is the first period boundary we're encountering

            if (isEnd) {
                // i don't know what kind of terrible data would get us HERE
                // but if it does, ignore it and hope for the best lol!
                continue;
            }

            currentPeriod = {
                start: timestamp,
                end: NEBULOUS_DISTANT_FUTURE,
                bitmask: 0
            };
            allPeriods.push(currentPeriod);
        } else if (currentPeriod.start !== timestamp) {
            currentPeriod.end = timestamp
            currentPeriod = {
                start: timestamp,
                end: NEBULOUS_DISTANT_FUTURE,
                bitmask: currentPeriod.bitmask
            };
            allPeriods.push(currentPeriod);
        }

        const idxBitmask = 1 << alertIdx;

        if (!isEnd) {
            // this alert just started, add it to the bitmask
            currentPeriod.bitmask |= idxBitmask;
        } else if (currentPeriod.bitmask & idxBitmask) {
            // this alert just ended, and it actually was in the bitmask
            // (i could theoretically do &= ~idxBitmask), but javascript's bitwise
            // not operator feels unpredictable, so for my own sake, i added the
            // extra check and did a xor instead)
            currentPeriod.bitmask ^= idxBitmask;
        }
    }

    // add edge periods starting at 1970 and ending at 2200
    // with bitmask 0 to help the ui along
    const firstPeriod = allPeriods[0];
    if (firstPeriod && firstPeriod.start > 0) {
        if (firstPeriod.bitmask === 0) {
            firstPeriod.start = 0;
        } else {
            allPeriods.splice(0, 0, {
                start: 0,
                end: firstPeriod.start,
                bitmask: 0
            });
        }
    }

    const lastPeriod = allPeriods[allPeriods.length - 1];
    if (lastPeriod && lastPeriod.end < NEBULOUS_DISTANT_FUTURE) {
        if (lastPeriod.bitmask === 0) {
            lastPeriod.end = NEBULOUS_DISTANT_FUTURE;
        } else {
            allPeriods.push({
                start: lastPeriod.end,
                end: NEBULOUS_DISTANT_FUTURE,
                bitmask: 0
            });
        }
    }

    return allPeriods;
}
