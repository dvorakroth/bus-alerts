import { DateTime } from "luxon";
import { ActualLineWithAlertCount, AddedRemovedDepartures, Agency, AlertForApi, AlertPeriod, AlertPeriodWithRouteChanges, AllLinesResponse, FlattenedLineDir, LineDetails, SingleLineChanges, StopForMap } from "../apiTypes.js";
import { AlertUseCase, AlertWithRelatedInDb } from "../dbTypes.js";
import { AllAlertsResult, alertFindNextRelevantDate } from "./alerts.js";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GroupedRoutes } from "./routeGrouping.js";
import winston from "winston";
import { JERUSALEM_TZ, arrayToDictDifferent, compareNple, compareTuple, copySortAndUnique, lineNumberForSorting, minimumDate, zip } from "../generalJunkyard.js";
import { GtfsDbApi } from "./gtfsDbApi.js";
import { ApplyAlertState, applyAlertToRoute, boundingBoxForStops, doesAlertHaveRouteChanges, labelHeadsignsForDirectionAndAlternative } from "./routeChgs.js";
import { GANTT_DEFAULT_ZOOM_LEVEL, alertGanttMinMaxLimits } from "../bothSidesConsts.js";

export async function getAllLines(
    alertsDbApi: AlertsDbApi,
    groupedRoutes: GroupedRoutes
): Promise<AllLinesResponse> {
    const alerts = await alertsDbApi.getAlerts();
    const firstRelevantTimestamps: Record<string, DateTime> = {};

    const linepkToAlertIds: Record<string, Set<string>> = {};
    const linepkToRemovedStopIds: Record<string, Set<string>> = {};

    // 
    const nowInJerusalem = DateTime.now().setZone(JERUSALEM_TZ);
    const {
        minimumStartPosition,
        maximumEndPosition
    } = alertGanttMinMaxLimits(nowInJerusalem, GANTT_DEFAULT_ZOOM_LEVEL);

    const minimumStartPositionUnixtime = minimumStartPosition.toSeconds();
    const maximumEndPositionUnixtime = maximumEndPosition.toSeconds();

    for (const alert of alerts) {
        if (alert.is_deleted || alert.is_expired) continue;

        if (
            alert.first_start_time.toSeconds() >= maximumEndPositionUnixtime
            ||
            alert.last_end_time.toSeconds() <= minimumStartPositionUnixtime
        ) {
            continue;
        }

        const [firstRelevantTimestamp, _] = alertFindNextRelevantDate(alert, true);
        if (!firstRelevantTimestamp) continue;

        firstRelevantTimestamps[alert.id] = firstRelevantTimestamp;

        for (const route_id of alert.relevant_route_ids) {
            const pk = groupedRoutes.actualLinesByRouteId[route_id];
            if (!pk) {
                winston.debug(`route_id ${route_id} not found in actualLinesByRouteId; ignoring`);
                continue;
            }

            const alertIdsForLine = linepkToAlertIds[pk]
                ?? (linepkToAlertIds[pk] = new Set());
            
            const removedStopIdsForLine = linepkToRemovedStopIds[pk]
                ?? (linepkToRemovedStopIds[pk] = new Set());
            
            alertIdsForLine.add(alert.id);
            alert.removed_stop_ids.forEach(stopId => removedStopIdsForLine.add(stopId));
        }
    }

    const todayInJerusalem = nowInJerusalem.set({
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
    });

    const all_lines: ActualLineWithAlertCount[] = [];

    for (const actualLine of groupedRoutes.actualLinesList) {
        const alertsForLine = linepkToAlertIds[actualLine.pk] ?? new Set();
        const removedStopIds = linepkToRemovedStopIds[actualLine.pk] ?? new Set();

        const withAlertCount = <ActualLineWithAlertCount>{
            ...actualLine,
            num_alerts: alertsForLine.size,
            first_relevant_timestamp: minimumDate(
                (function *() {
                    for (const alertId of alertsForLine) {
                        const frts = firstRelevantTimestamps[alertId];
                        if (!frts) continue;
                        yield frts;
                    }
                })()
            ),
            num_relevant_right_now: [...alertsForLine].filter(
                alertId => {
                    const frts = firstRelevantTimestamps[alertId];
                    return frts && frts.toSeconds() <= nowInJerusalem.toSeconds()
                }
            ).length,
            num_relevant_today: [...alertsForLine].filter(
                alertId => {
                    const frd = firstRelevantTimestamps[alertId]?.set({
                        hour: 0,
                        minute: 0,
                        second: 0,
                        millisecond: 0
                    });
                    return frd && frd.toSeconds() === todayInJerusalem.toSeconds();
                }
            ).length,
            num_removed_stops: [...removedStopIds].filter(
                stop_id => actualLine.all_stopids_distinct.includes(stop_id)
            ).length,

            all_directions_grouped: undefined,
            all_stopids_distinct: undefined
        };

        all_lines.push(withAlertCount);
    }

    const lines_with_alert = all_lines
        .filter(({num_alerts}) => num_alerts > 0);
    sortLinesWithAlerts(lines_with_alert, groupedRoutes);
    
    return {
        all_lines,
        lines_with_alert,
        all_agencies: groupedRoutes.allAgencies,
        uses_location: false
    };
}

export function sortLinesWithAlerts(
    lines: ActualLineWithAlertCount[],
    groupedRoutes: GroupedRoutes
) {
    return lines.sort(
        (a, b) => compareNple(
            lineWithAlertSortingNple(a, groupedRoutes.allAgencies),
            lineWithAlertSortingNple(b, groupedRoutes.allAgencies)
        )
    );
}

function lineWithAlertSortingNple(
    line: ActualLineWithAlertCount,
    allAgencies: Record<string, Agency>
) {
    return [
        line.distance ?? Infinity,
        -(line.num_removed_stops ?? 0),
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
                deleted_alerts: [],
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
        const timeSensitiveAlerts: [AlertForApi, AlertWithRelatedInDb][] = [];

        // at first, just get every alert's route_changes (but limited to each route_id) on its own
        for (const [alert, alertRaw] of alertPairs) {
            if (alert.is_expired) continue;

            if (alert.is_deleted) {
                const alertMinimal = {
                    id: alert.id,
                    header: alert.header,
                    use_case: alert.use_case
                };
                flatDir.deleted_alerts.push(alertMinimal)
            } else if (
                doesAlertHaveRouteChanges(alertRaw)
                || alertRaw.use_case === AlertUseCase.ScheduleChanges
            ) {
                timeSensitiveAlerts.push([alert, alertRaw]);
            }
        }

        if(!timeSensitiveAlerts.length) {
            continue;
        }

        flatDir.time_sensitive_alerts = {
            periods: [],
            alert_metadata: alertPairs.map(
                ([{id, header, use_case}, _]) => ({id, header, use_case})
            )
        };

        // now after we got all those alerts we can actually do the ~*~*MAGIC*~*~

        // divide the routeChangeAlerts active_periods.raw into a sequence of nicer periods
        const alertPeriods = listOfAlertsToActivePeriodIntersectionsAndBitmasks(timeSensitiveAlerts);

        for (const period of alertPeriods) {
            const startDate = DateTime.fromSeconds(period.start, {zone: JERUSALEM_TZ}).set({
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            });

            let state: ApplyAlertState|null = null;
            let departure_changes: AddedRemovedDepartures|undefined = undefined;

            for (let i = 0; i < alertPairs.length; i++) {
                const alertRaw = alertPairs[i]?.[1];
                if (!alertRaw) continue;

                const idxBitmask = (1 << i);
                const isActive = (period.bitmask & idxBitmask) !== 0;

                if (!isActive) {
                    continue;
                }

                if (doesAlertHaveRouteChanges(alertRaw)) {
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
                
                if (alertRaw.use_case === AlertUseCase.ScheduleChanges) {
                    const alertDepartureChanges = alertRaw.schedule_changes?.[flatDir.route_id];
                    if (!alertDepartureChanges) continue;

                    if (!departure_changes) {
                        departure_changes = {
                            added_hours: alertDepartureChanges.added,
                            removed_hours: alertDepartureChanges.removed
                        };
                    } else {
                        departure_changes.added_hours = copySortAndUnique([
                            ...departure_changes.added_hours,
                            ...alertDepartureChanges.added
                        ]);

                        departure_changes.removed_hours = copySortAndUnique([
                            ...departure_changes.removed_hours,
                            ...alertDepartureChanges.removed
                        ]);
                    }
                }
            }

            const representativeTripId = state?.representativeTripId
                ? state.representativeTripId
                : await gtfsDbApi.getRepresentativeTripId(flatDir.route_id, startDate);

            if (state?.updatedStopSeq) {
                flatDir.time_sensitive_alerts.periods.push({
                    ...period,
                    updated_stop_sequence: state.updatedStopSeq,
                    deleted_stop_ids: [...state.deletedStopIds],
                    raw_stop_seq: undefined,// state.rawStopSeq ?? [],
                    shape: undefined, /*state.representativeTripId
                        ? await gtfsDbApi.getShapePoints(state.representativeTripId)
                        : null,*/
                    departure_changes
                });
            } else {
                const stopSeq = representativeTripId
                    ? await gtfsDbApi.getStopSeq(representativeTripId)
                    : [];

                flatDir.time_sensitive_alerts.periods.push({
                    ...period,
                    updated_stop_sequence: stopSeq.map(s => [s, false]),
                    deleted_stop_ids: [],
                    raw_stop_seq: undefined, //stopSeq,
                    shape: undefined, /*representativeTripId
                        ? await gtfsDbApi.getShapePoints(representativeTripId)
                        : null,*/
                    departure_changes,
                    has_no_route_changes: true
                });
            }
        }
    }

    const all_stops = await gtfsDbApi.getStopMetadata([...allStopIds]);
    const map_bounding_box = boundingBoxForStops(
        Object.keys(all_stops),
        all_stops
    );

    for (const dir of line_details.dirs_flattened) {
        if (!dir.shape?.length) {
            // if a shape is missing then just make shit up
            dir.shape = [];

            for (const stop_id of dir.stop_seq) {
                const stop = all_stops[stop_id];
                if (!stop) continue;

                dir.shape.push([stop.stop_lon, stop.stop_lat]);
            }
        }

        for (const period of dir.time_sensitive_alerts?.periods ?? []) {
            // if (!period.shape?.length) {
            //     period.shape = [...dir.shape];
            // }

            const bbox = calculateBoundingBoxForPeriod(period, dir, all_stops);
            if (bbox) {
                period.map_bounding_box = bbox;
            }
        }
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

function calculateBoundingBoxForPeriod(
    period: AlertPeriodWithRouteChanges,
    dir: FlattenedLineDir,
    all_stops: Record<string, StopForMap>
) {
    if (period.bitmask === 0) {
        if (!dir.stop_seq.length) return null;

        return boundingBoxForStops(
            dir.stop_seq,
            all_stops
        );
    }

    const relevantStopIds = new Set<string>(period.deleted_stop_ids);

    let prevStopId: string|null = null;
    let prevIsAdded: boolean|null = null;

    for (const [stopId, isAdded] of period.updated_stop_sequence) {
        if (isAdded) {
            relevantStopIds.add(stopId);
        }

        if (prevStopId && prevIsAdded !== null) {
            if (isAdded && !prevIsAdded) {
                relevantStopIds.add(prevStopId);
            } else if (!isAdded && prevIsAdded) {
                relevantStopIds.add(stopId);
            }
        }

        prevStopId = stopId;
        prevIsAdded = isAdded;
    }

    if (relevantStopIds.size) {
        return boundingBoxForStops(relevantStopIds, all_stops);
    } else if (dir.stop_seq.length) {
        return boundingBoxForStops(dir.stop_seq, all_stops);
    } else {
        return null;
    }
}
