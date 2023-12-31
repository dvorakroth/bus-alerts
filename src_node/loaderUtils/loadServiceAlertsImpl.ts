import pg from "pg";
import { DateTime } from "luxon";
import { JsonObject, TIME_FORMAT_ISO_NO_TZ, forceToNumberOrNull, gtfsRtTranslationsToObject } from "./loaderJunkyard.js";
import { consolidateActivePeriods, splitActivePeriodToSubperiods } from "./activePeriodUtils.js";
import { AlertInDb, AlertUseCase, DepartureChanges, OriginalSelector, RouteChanges, TripSelector } from "../dbTypes.js";
import winston from "winston";
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import { GTFS_CALENDAR_DOW, JERUSALEM_TZ, arrayToDictDifferent, copySortAndUnique, inPlaceSortAndUnique } from "../generalJunkyard.js";
import { OAR_PREFIX_REGION, parseOldAramaicRegion, parseOldAramaicRoutechgs } from "./oldAramaic.js";

const {transit_realtime} = gtfsRealtimeBindings;

const CITY_LIST_PREFIX = "ההודעה רלוונטית לישובים: ";

export async function loadIsraeliGtfsRt(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    feed: gtfsRealtimeBindings.transit_realtime.FeedMessage,
    TESTING_fake_today: DateTime|null
) {
    for (const entity of feed.entity) {
        await loadSingleEntity(gtfsDb, alertsDb, entity);
    }

    winston.info(`Added/updated ${feed.entity.length} alerts`)
    await markAlertsDeletedIfNotInList(alertsDb, feed.entity.map(({id}) => id), TESTING_fake_today);
}

const INFINITE_END_TIME = 7258118400; // 2200-01-01 00:00 UTC

async function loadSingleEntity(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    entity: gtfsRealtimeBindings.transit_realtime.IFeedEntity
) {
    const id = entity.id;
    const alert = entity.alert||{};

    let firstStartTime: number|null = null;
    let lastEndTime: number|null = null;
    const activePeriods: [number|null, number|null][] = [];

    for (const period of alert?.activePeriod||[]) {
        const start = forceToNumberOrNull(period.start);
        const end = forceToNumberOrNull(period.end);

        // apparently sometimes we get alerts with multiple overlapping active periods
        // so uh,,, fix that lol
        let foundOverlap = false;
        const normalizedStart = start||0;
        const normalizedEnd = end||INFINITE_END_TIME;

        for (const otherPeriod of activePeriods) {
            const otherPeriodNormalized: [number, number] = [
                otherPeriod[0]||0,
                otherPeriod[1]||INFINITE_END_TIME
            ];

            if (
                otherPeriodNormalized[0] <= normalizedEnd
                && otherPeriodNormalized[1] >= normalizedStart
            ) {
                foundOverlap = true;

                if (!start || !otherPeriod[0]) {
                    otherPeriod[0] = null;
                } else {
                    otherPeriod[0] = Math.min(start, otherPeriod[0]);
                }

                if (!end || !otherPeriod[1]) {
                    otherPeriod[1] = null;
                } else {
                    otherPeriod[1] = Math.max(end, otherPeriod[1])
                }

                break;
            }
        }

        if (!foundOverlap) {
            activePeriods.push([start, end]);
        }

        if (start) {
            if (firstStartTime === null || firstStartTime > start) {
                firstStartTime = start;
            }
        } else {
            firstStartTime = 0;
        }

        if (end) {
            if (lastEndTime === null || lastEndTime < end) {
                lastEndTime = end;
            }
        } else {
            // no end time = forever (more realistically, until alert is deleted)
            lastEndTime = INFINITE_END_TIME;
        }
    }

    const consolidatedActivePeriods = consolidateActivePeriods(activePeriods);
    const url = gtfsRtTranslationsToObject(alert.url?.translation || []);
    const header = gtfsRtTranslationsToObject(alert.headerText?.translation || []);
    const description = gtfsRtTranslationsToObject(alert.descriptionText?.translation || []);

    const cause = transit_realtime.Alert.Cause[alert.cause ?? transit_realtime.Alert.Cause.UNKNOWN_CAUSE];
    const effect = transit_realtime.Alert.Effect[alert.effect ?? transit_realtime.Alert.Effect.OTHER_EFFECT];

    const oldAramaic = (function() { // *sigh*
        if (description.oar) {
            const tmp = description.oar;
            delete description.oar;
            return tmp;
        } else {
            return null;
        }
    })();

    let useCase: AlertUseCase|null = null;
    let originalSelector: OriginalSelector = {};
    let isNational = false;

    let hasRouteAndStopEnt = false;
    let hasStopEnt = false;
    let hasTripEnt = false;
    // let hasRouteEnt = false;
    // let hasAgencyEnt = false;
    const foundAgencyIds: string[] = [];
    const foundRouteIds: string[] = [];

    for (const informedEntity of alert.informedEntity ?? []) {
        if (informedEntity.routeId && informedEntity.stopId) {
            hasRouteAndStopEnt = true;
            foundRouteIds.push(informedEntity.routeId);
        } else if (informedEntity.agencyId && informedEntity.agencyId !== "1") {
            // hasAgencyEnt = true;
            foundAgencyIds.push(informedEntity.agencyId);
        } else if (informedEntity.stopId) {
            hasStopEnt = true;
        } else if (informedEntity.trip) {
            hasTripEnt = true;
        } else if (informedEntity.routeId) {
            // hasRouteEnt = true;
            foundRouteIds.push(informedEntity.routeId);
        }
    }

    const relevantAgencies: string[] = [];
    const relevantRouteIds: string[] = [];
    const addedStopIds: string[] = [];
    const removedStopIds: string[] = [];
    let routeChanges: RouteChanges|null = null;
    let departureChanges: DepartureChanges|null = null;

    // const hasOarRouteId = oldAramaic && oldAramaic.startsWith("route_id=");

    if (hasRouteAndStopEnt) {
        // has entities containing both route_id and stop_id
        const routeStopPairs: [string, string][] = [];
        routeChanges = {};
        if (routeChanges === null) {
            throw "???"; //shouldn't happen; this is just here to typescript doesn't yell at me
        }

        for (const informedEntity of alert.informedEntity ?? []) {
            if (!informedEntity.stopId) {
                continue; // this actually happened once and bugged the api server's code -_-
            }

            const routeIds = informedEntity.routeId
                ? [informedEntity.routeId]
                : await fetchAllRouteIdsAtStopsInDateranges(
                    gtfsDb,
                    [informedEntity.stopId],
                    activePeriods//,
                    //foundAgencyIds
                );
            
            // if (!informedEntity.routeId/* && !foundAgencyIds.length*/) {
            //     // if we just did a fetchAllRouteIdsAtStopsInDateranges call
            //     // but we didn't restrict it by agency_id,
            //     // then restrict it by route_id instead? :|

            //     // maybe we should do this as a restriction by the agencies
            //     // of the routes we DID see? idk man this protocol is a
            //     // hellish mess

            //     for (let i = 0; i < routeIds.length; i++) {
            //         const routeId = routeIds[i];
            //         if (!routeId) continue;

            //         if (!foundRouteIds.includes(routeId)) {
            //             routeIds.splice(i, 1);
            //             // don't increment since we just deleted the current index
            //             // but we can't not-increment so instead we decrement
            //             // before the for loop increments lol
            //             --i;
            //         }
            //     }
            // }

            for (const routeId of routeIds) {
                removedStopIds.push(informedEntity.stopId);
                routeStopPairs.push([routeId, informedEntity.stopId]);

                if (!routeChanges.hasOwnProperty(routeId)) {
                    routeChanges[routeId] = [];
                    relevantRouteIds.push(routeId);
                }

                routeChanges[routeId]?.push({
                    removed_stop_id: informedEntity.stopId
                });
            }
        }

        if (!oldAramaic) {
            useCase = AlertUseCase.RouteChangesSimple;
            originalSelector = {route_stop_pairs: routeStopPairs};
        } else {
            useCase = AlertUseCase.RouteChangesFlex;
            originalSelector = {
                route_stop_pairs: routeStopPairs,
                old_aramaic: oldAramaic
            };
            const oarAdditions = parseOldAramaicRoutechgs(oldAramaic);

            // merge the schedule changes we got from old aramaic text
            // into the schedule changes we got from informedEntity[]
            for (const [routeId, additions] of Object.entries(oarAdditions)) {
                if (!routeChanges.hasOwnProperty(routeId)) {
                    routeChanges[routeId] = additions;
                    relevantRouteIds.push(routeId);
                } else {
                    // put additions before removals because the additions
                    // can be relative to a stop that gets removed
                    // and i wanna be good to future me and avoid these bugs(?)
                    routeChanges[routeId]?.splice(0, 0, ...additions);
                }

                addedStopIds.push(...additions.map(a => a.added_stop_id));
            }
        }

        inPlaceSortAndUnique(removedStopIds);
        inPlaceSortAndUnique(addedStopIds);
        inPlaceSortAndUnique(relevantRouteIds);
        relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
    } else if (hasStopEnt) {
        // no informedEntities with route_id+stop_id, but still some with just a stop_id
        useCase = AlertUseCase.StopsCancelled;

        const stop_ids = (alert.informedEntity?.map(e => e.stopId).filter(s => !!s) ?? []) as string[];

        originalSelector = {
            stop_ids
        };

        removedStopIds.push(...stop_ids);
        relevantRouteIds.push(...await fetchAllRouteIdsAtStopsInDateranges(
            gtfsDb,
            removedStopIds,
            activePeriods
        ));
        relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
    } else if (hasTripEnt) {
        useCase = AlertUseCase.ScheduleChanges;

        const trips: TripSelector[] = [];
        const allFakeTripIds: Set<string> = new Set<string>([]); // dolan y
        departureChanges = {};
        if (departureChanges === null) {
            throw "???"; // once again: shouldn't happen, only here so typescript won't yell at me
        }

        for (const informedEntity of alert.informedEntity ?? []) {
            const trip = {
                route_id: informedEntity.trip?.routeId ?? "",
                fake_trip_id: informedEntity.trip?.tripId ?? "", // ugh -_-
                action: informedEntity.trip?.scheduleRelationship ?? transit_realtime.TripDescriptor.ScheduleRelationship.SCHEDULED,
                start_time: informedEntity.trip?.startTime ?? ""
            };
            trips.push(trip);

            if (!departureChanges.hasOwnProperty(trip.route_id)) {
                departureChanges[trip.route_id] = {
                    added: [],
                    removed: []
                };
                relevantRouteIds.push(trip.route_id);
            }

            if (
                trip.action === transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED
                && trip.fake_trip_id
                && trip.fake_trip_id !== "0"
            ) {
                departureChanges[trip.route_id]?.removed?.push(trip.fake_trip_id);
                allFakeTripIds.add(trip.fake_trip_id);
            } else if (
                trip.action === transit_realtime.TripDescriptor.ScheduleRelationship.ADDED
                || !trip.fake_trip_id
                || trip.fake_trip_id === "0"
            ) {
                departureChanges[trip.route_id]?.added.push(trip.start_time);
            }
        }

        // convert removed trips from fake ids (-____-) to actual times
        const departureTimes = await fetchDeparturesForFakeTripIds(gtfsDb, [...allFakeTripIds]);
        for (const change of Object.values(departureChanges)) {
            change.removed = copySortAndUnique(
                change.removed.map(fakeId => departureTimes[fakeId]??"")
            );
            change.added = copySortAndUnique(change.added);
        }

        relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
        originalSelector = {trips};
    }

    const foundCityNames: string[] = [];

    if (useCase === null) {
        if (!foundAgencyIds.length && !foundRouteIds.length && description.he) {
            const i = description.he.indexOf(CITY_LIST_PREFIX);

            if (i >= 0) {
                useCase = AlertUseCase.Cities;
                foundCityNames.push(...
                    (description.he
                        .substring(i + CITY_LIST_PREFIX.length)
                        .split("\n")[0]
                        ?.split(",") ?? [])
                );
                originalSelector = {cities: foundCityNames}
            }
        }
    }

    isNational = 
        useCase === null
        && !foundAgencyIds.length
        && !foundRouteIds.length
        && !foundCityNames.length
        && !oldAramaic;

    if (isNational) {
        useCase = AlertUseCase.National;
        originalSelector = {};
    }

    let polygon = null;
    if (useCase === null && !foundAgencyIds.length && oldAramaic?.startsWith(OAR_PREFIX_REGION)) {
        polygon = parseOldAramaicRegion(oldAramaic);
        useCase = AlertUseCase.Region;
        originalSelector = {old_aramaic: oldAramaic, polygon};

        removedStopIds.push(...await fetchStopsByPolygon(gtfsDb, polygon));
        relevantRouteIds.push(...await fetchAllRouteIdsAtStopsInDateranges(gtfsDb, removedStopIds, activePeriods));
        relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
    }

    if (!useCase && foundRouteIds.length) {
        useCase = AlertUseCase.Route;
        relevantRouteIds.push(...foundRouteIds);
        relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
    }
    
    if (!useCase && foundAgencyIds.length) {
        useCase = AlertUseCase.Agency;
        relevantAgencies.push(...foundAgencyIds);
    }

    const alertObj = <AlertInDb>{
        id,
        first_start_time: DateTime.fromSeconds(firstStartTime ?? 0, {zone: JERUSALEM_TZ}),
        last_end_time: DateTime.fromSeconds(lastEndTime ?? INFINITE_END_TIME, {zone: JERUSALEM_TZ}),
        raw_data: transit_realtime.FeedEntity.encode(entity).finish(),

        use_case: useCase,
        original_selector: originalSelector,
        cause,
        effect,
        url,
        header,
        description,
        active_periods: {
            raw: activePeriods,
            consolidated: consolidatedActivePeriods
        },
        schedule_changes: routeChanges ?? departureChanges ?? null,

        is_national: isNational,
        deletion_tstz: null,

        relevant_agencies: inPlaceSortAndUnique(relevantAgencies),
        relevant_route_ids: inPlaceSortAndUnique(relevantRouteIds),
        added_stop_ids: inPlaceSortAndUnique(addedStopIds),
        removed_stop_ids: inPlaceSortAndUnique(removedStopIds)
    };

    await createOrUpdateAlert(alertsDb, alertObj);
}

async function markAlertsDeletedIfNotInList(
    alertsDb: pg.Client,
    alertIdsToKeep: string[],
    TESTING_fake_today: DateTime|null
) {
    if (!alertIdsToKeep.length) {
        return;
    }

    const now = TESTING_fake_today ?? DateTime.now().setZone(JERUSALEM_TZ);

    winston.debug('markAlertsDeletedIfNotInList');
    const res = await alertsDb.query<never, [string, string[]]>(
        `UPDATE alert
        SET deletion_tstz = $1::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\' 
        WHERE deletion_tstz IS NULL AND id <> ALL($2::varchar[]);`,
        [now.toFormat(TIME_FORMAT_ISO_NO_TZ), alertIdsToKeep]
    );
    winston.info(`Marked ${res.rowCount} alerts as deleted`);
}

async function fetchAllRouteIdsAtStopsInDateranges(
    gtfsDb: pg.Client,
    stopIds: string[],
    activePeriods: [number|null, number|null][],
    restrictAgencyIds?: string[]
): Promise<string[]> {
    if (!stopIds.length || !activePeriods.length) {
        return [];
    }

    const {queryText, queryValues} = generateQuery__fetchAllRouteIdsAtStopsInDateranges(
        stopIds,
        activePeriods,
        restrictAgencyIds
    );

    winston.debug('fetchAllRouteIdsAtStopsInDateranges');
    // winston.debug(queryText);
    const res = await gtfsDb.query<{route_id: string}, typeof queryValues>(
        queryText,
        queryValues
    );

    return res.rows.map(({route_id}) => route_id);
}

export function generateQuery__fetchAllRouteIdsAtStopsInDateranges(
    stopIds: string[],
    activePeriods: [number|null, number|null][],
    restrictAgencyIds?: string[]
): {queryText: string, queryValues: [string[], ...string[]]} {
    // i fear the day when i need to maintain this function haha upside down smiley emoji
    // (NOTE 2023-06-09 13:36 haha i need to not just *maintain* this, but REWRITE IT in typescript haha upside down smiley emoji)
    // (NOTE 2023-06-09 14:53 fuck me haha)
    // (NOTE 2023-08-08 20:54 godfuckingdammit)

    let paramCounter = 0;
    let queryText = `
        SELECT DISTINCT trips.route_id FROM trips
        INNER JOIN stoptimes_int ON trips.trip_id = stoptimes_int.trip_id
        INNER JOIN calendar ON trips.service_id = calendar.service_id
        ${restrictAgencyIds?.length ? 'INNER JOIN routes ON trips.route_id = routes.route_id' : ''}
        WHERE stoptimes_int.stop_id = ANY($${++paramCounter}::varchar[])
        ${restrictAgencyIds?.length ? `AND routes.agency_id = ANY($${++paramCounter}::varchar[])` : ''}
    `;
    const queryValues: [string[], ...string[]] = [stopIds];
    
    if (restrictAgencyIds?.length) {
        queryValues.push(restrictAgencyIds);
    }

    const allPeriodConditions: string[] = [];
    const allPeriodValues: string[] = [];

    for (const [startUnixtime, endUnixtime] of activePeriods) {
        const activePeriodParts = splitActivePeriodToSubperiods(
            startUnixtime,
            endUnixtime
        );

        for (const part of activePeriodParts) {
            if (!part) {
                continue;
            }
            const [start, end] = part;

            let partCondition = "";
            const partValues: string[] = [];

            if (start && !end) {
                partCondition = `
                    calendar.end_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time
                    >=
                    $${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\'
                `;
                partValues.push(start.toFormat(TIME_FORMAT_ISO_NO_TZ));
            } else if (!start && end) {
                partCondition = `
                    calendar.start_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time
                    <
                    $${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\'
                `;
                partValues.push(end.toFormat(TIME_FORMAT_ISO_NO_TZ));
            } else if (start && end) {
                partCondition = `
                    (
                        calendar.start_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time,
                        calendar.end_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time + INTERVAL \'1 second\'
                    )
                    OVERLAPS (
                        $${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\',
                        $${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\'
                    )
                `;
                partValues.push(start.toFormat(TIME_FORMAT_ISO_NO_TZ));
                partValues.push(end.toFormat(TIME_FORMAT_ISO_NO_TZ));

                // loop through all days in this part
                // and add their DOWs to relevant_dow
                const relevantDow = new Set<number>();

                for (
                    let d = start;
                    d.toSeconds() < end.toSeconds() && relevantDow.size < 7;
                    d = d.plus({days: 1})
                ) {
                    relevantDow.add(d.weekday - 1); // subtract 1, because GTFS_CALENDAR_DOW is a 0-indexed array
                }

                const isLessThanADay = start.plus({days: 1}).toSeconds() > end.toSeconds();

                if (0 < relevantDow.size && relevantDow.size < 7) {
                    partCondition += `
                        AND (
                            (
                                stoptimes_int.arrival_time < INTERVAL \'24 hours\'
                                AND (
                                    ${[...relevantDow].map(
                                        dow => `calendar.${GTFS_CALENDAR_DOW[dow]} = TRUE`
                                    ).join(" OR ")}
                                )
                                ${isLessThanADay
                                    ? `
                                        AND
                                            (
                                                $${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\'
                                                +
                                                stoptimes_int.arrival_time
                                            )
                                        BETWEEN
                                            ($${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\')
                                        AND
                                            ($${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\')
                                    `
                                    : ""
                                }
                            ) OR (
                                stoptimes_int.arrival_time >= INTERVAL \'24 hours\'
                                AND (
                                    ${[...relevantDow].map(
                                        dow => `calendar.${GTFS_CALENDAR_DOW[(dow + 6) % 7]} = TRUE`
                                    ).join(" OR ")}
                                )
                                ${isLessThanADay
                                    ? `
                                        AND
                                            (
                                                $${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\'
                                                +
                                                stoptimes_int.arrival_time
                                            )
                                        BETWEEN
                                            ($${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\')
                                        AND
                                            ($${++paramCounter}::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\')
                                    `
                                    : ""
                                }
                            )
                        )
                    `;
                    if (isLessThanADay) {
                        partValues.push(...[
                            start
                                .set({hour: 0, minute: 0, second: 0, millisecond: 0})
                                .toFormat(TIME_FORMAT_ISO_NO_TZ),
                            start.toFormat(TIME_FORMAT_ISO_NO_TZ),
                            end.toFormat(TIME_FORMAT_ISO_NO_TZ),
                            start
                                .set({hour: 0, minute: 0, second: 0, millisecond: 0})
                                .plus({days: 1})
                                .toFormat(TIME_FORMAT_ISO_NO_TZ),
                            start.toFormat(TIME_FORMAT_ISO_NO_TZ),
                            end.toFormat(TIME_FORMAT_ISO_NO_TZ)
                        ]);
                    }
                }
            }

            if (partCondition.length) {
                allPeriodConditions.push(partCondition);
                allPeriodValues.push(...partValues);
            }
        }
    }

    if (allPeriodConditions.length) {
        queryText +=
            "AND ("
            + allPeriodConditions.map(s => "(" + s + ")").join(" OR ")
            + ")";
        queryValues.push(...allPeriodValues);
    }

    queryText += ";";

    return {queryText, queryValues};
}

async function fetchUniqueAgenciesForRoutes(
    gtfsDb: pg.Client,
    routeIds: string[]
): Promise<string[]> {
    if (!routeIds.length) {
        return [];
    }

    winston.debug('fetchUniqueAgenciesForRoutes');
    const res = await gtfsDb.query<{agency_id: string}, [string[]]>(
        "SELECT DISTINCT agency_id FROM routes WHERE route_id = ANY($1::varchar[])",
        [routeIds]
    )

    return res.rows.map(({agency_id}) => agency_id);
}

async function fetchDeparturesForFakeTripIds(
    gtfsDb: pg.Client,
    fakeTripIds: string[]
): Promise<{[fakeTripId: string]: string}> {
    if (!fakeTripIds.length) {
        return {};
    }

    winston.debug('fetchDeparturesForFakeTripIds');
    const res = await gtfsDb.query<{TripId: string, DepartureTime: string}, [string[]]>(
        "SELECT DISTINCT \"TripId\", \"DepartureTime\" FROM trip_id_to_date WHERE \"TripId\" = ANY($1::varchar[]);",
        [fakeTripIds]
    );

    return arrayToDictDifferent(
        res.rows,
        r => r.TripId,
        r => r.DepartureTime
    );
}

async function fetchStopsByPolygon(
    gtfsDb: pg.Client,
    polygon: [string, string][]
): Promise<string[]> {
    if (!polygon.length) {
        return [];
    }

    winston.debug('fetchStopsByPolygon');
    const res = await gtfsDb.query<{stop_id: string}, [string]>(
        "SELECT stop_id FROM stops WHERE point(stop_lat, stop_lon) <@ $1::polygon;",
        [
            "(" + polygon.map(([lat,lon]) => `(${lat},${lon})`).join(",") + ")"
        ]
    );

    return res.rows.map(({stop_id}) => stop_id);
}

type CreateAlertValues = [
    string, string, string, Uint8Array, number,
    JsonObject, string, string, JsonObject, JsonObject,
    JsonObject, JsonObject, JsonObject|null, boolean, string|null
];

type AlertAgencyValue = {
    alert_id: string,
    agency_id: string
};

type AlertRouteValue = {
    alert_id: string,
    route_id: string
};

type AlertStopValue = {
    alert_id: string,
    stop_id: string,
    is_added: boolean,
    is_removed: boolean
};

async function createOrUpdateAlert(
    alertsDb: pg.Client,
    alertObj: AlertInDb
): Promise<void> {


    // this isn't just plopped in directly in the function call because
    // then if i get one of the types wrong, typescript's error gets really
    // cryptic because pg.Client.query<>() has a million overloads
    const values: CreateAlertValues = [
        alertObj.id,
        alertObj.first_start_time.toFormat(TIME_FORMAT_ISO_NO_TZ),
        alertObj.last_end_time.toFormat(TIME_FORMAT_ISO_NO_TZ),
        alertObj.raw_data,
        alertObj.use_case,

        alertObj.original_selector,
        alertObj.cause,
        alertObj.effect,
        alertObj.url,
        alertObj.header,

        alertObj.description,
        alertObj.active_periods,
        alertObj.schedule_changes,
        alertObj.is_national,
        alertObj.deletion_tstz?.toFormat(TIME_FORMAT_ISO_NO_TZ) ?? null
    ];

    winston.debug('createOrUpdateAlert insert into alert');
    await alertsDb.query<never, CreateAlertValues>(
        `INSERT INTO alert VALUES (
            $1,
            $2::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\',
            $3::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\',
            $4::BYTEA,
            $5,

            $6::JSON,
            $7,
            $8,
            $9::JSON,
            $10::JSON,

            $11::JSON,
            $12::JSON,
            $13::JSON,
            $14::BOOLEAN,
            $15::TIMESTAMP AT TIME ZONE \'Asia/Jerusalem\'
        ) ON CONFLICT (id) DO UPDATE SET
            first_start_time = EXCLUDED.first_start_time,
            last_end_time = EXCLUDED.last_end_time,
            raw_data = EXCLUDED.raw_data,
            use_case = EXCLUDED.use_case,
            original_selector = EXCLUDED.original_selector,
            cause = EXCLUDED.cause,
            effect = EXCLUDED.effect,
            url = EXCLUDED.url,
            header = EXCLUDED.header,
            description = EXCLUDED.description,
            active_periods = EXCLUDED.active_periods,
            schedule_changes = EXCLUDED.schedule_changes,
            is_national = EXCLUDED.is_national,
            deletion_tstz = CASE WHEN EXCLUDED.deletion_tstz IS NULL
                    THEN NULL
                    ELSE LEAST(EXCLUDED.deletion_tstz, alert.deletion_tstz)
                END;`,
        values
    );

    winston.debug("Added/updated alert with id: " + alertObj.id);

    const agencyDeletionRes = await alertsDb.query<never, [string, string[]]>(
        `DELETE FROM alert_agency
        WHERE alert_id=$1 AND agency_id <> ALL($2::varchar[]);`,
        [
            alertObj.id,
            alertObj.relevant_agencies
        ]
    );

    winston.debug(`Deleted ${agencyDeletionRes.rowCount} rows from alert_agency`);

    const routeDeletionRes = await alertsDb.query<never, [string, string[]]>(
        `DELETE FROM alert_route
        WHERE alert_id=$1 AND route_id <> ALL($2::varchar[]);`,
        [
            alertObj.id,
            alertObj.relevant_route_ids
        ]
    );

    winston.debug(`Deleted ${routeDeletionRes.rowCount} rows from alert_route`);

    const allStopIds = alertObj.removed_stop_ids.concat(alertObj.added_stop_ids);
    inPlaceSortAndUnique(allStopIds);

    const stopDeletionsRes = await alertsDb.query<never, [string, string[]]>(
        `DELETE FROM alert_stop
        WHERE alert_id=$1 AND stop_id <> ALL($2::varchar[]);`,
        [
            alertObj.id,
            allStopIds
        ]
    );

    winston.debug(`Deleted ${stopDeletionsRes.rowCount} rows from alert_stop`);

    if (alertObj.relevant_agencies.length) {
        const agencyEntries = alertObj.relevant_agencies.map(
            agency_id => <AlertAgencyValue>{
                alert_id: alertObj.id,
                agency_id
            }
        );

        const agencyAdditionRes = await alertsDb.query<never, [string]>(
            `INSERT INTO alert_agency
                (
                    SELECT m.*
                    FROM json_populate_recordset(NULL::alert_agency, $1::JSON) m
                )
            ON CONFLICT DO NOTHING;`,
            [JSON.stringify(agencyEntries)] // this has to be stringified because node-pg doesn't know how to send over JSON arrays, only objects
        );

        winston.debug(`Added ${agencyAdditionRes.rowCount} rows to alert_agency`);
    }

    if (alertObj.relevant_route_ids.length) {
        const routeEntries = alertObj.relevant_route_ids.map(
            route_id => <AlertRouteValue>{
                alert_id: alertObj.id,
                route_id
            }
        );

        const routeAdditionRes = await alertsDb.query<never, [string]>(
            `INSERT INTO alert_route
                (
                    SELECT m.*
                    FROM json_populate_recordset(NULL::alert_route, $1::JSON) m
                )
            ON CONFLICT DO NOTHING;`,
            [JSON.stringify(routeEntries)] // this has to be stringified because node-pg doesn't know how to send over JSON arrays, only objects
        );

        winston.debug(`Added ${routeAdditionRes.rowCount} rows to alert_route`);
    }

    if (allStopIds.length) {
        const allStopEntries = allStopIds.map(stop_id => <AlertStopValue>{
            alert_id: alertObj.id,
            stop_id,
            is_added: alertObj.added_stop_ids.indexOf(stop_id) >= 0,
            is_removed: alertObj.removed_stop_ids.indexOf(stop_id) >= 0
        });

        const stopAdditionRes = await alertsDb.query<never, [string]>(
            `INSERT INTO alert_stop
                (
                    SELECT m.*
                    FROM json_populate_recordset(NULL::alert_stop, $1::JSON) m
                )
            ON CONFLICT DO NOTHING;`,
            [JSON.stringify(allStopEntries)] // this has to be stringified because node-pg doesn't know how to send over JSON arrays, only objects
        );

        winston.debug(`Added ${stopAdditionRes.rowCount} rows to alert_stop`);
    }
}
