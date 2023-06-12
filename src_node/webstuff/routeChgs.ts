import { DateTime } from "luxon";
import { AlertUseCase, AlertWithRelatedInDb } from "../dbTypes.js";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GtfsDbApi } from "./gtfsDbApi.js";
import { findRepresentativeDateForRouteChangesInAlert, getHeadsign } from "./alerts.js";
import winston from "winston";
import { MapBoundingBox, RouteChangeForApi, StopForMap } from "../apiTypes.js";
import { chainIterables, compareNple, inPlaceSortAndUnique, zip } from "../generalJunkyard.js";

export async function getRouteChanges(
    alertId: string,
    alertRaw: AlertWithRelatedInDb|null,
    alertsDbApi: AlertsDbApi,
    gtfsDbApi: GtfsDbApi
) {
    // 1. get alert and relevant routes, if no route changes return null

    alertRaw = alertRaw ?? await alertsDbApi.getSingleAlert(alertId);

    if (!alertRaw) {
        throw new Error(`Could not computer RouteChanges: alert with id ${alertId} not found`);
    }

    if (!doesAlertHaveRouteChanges(alertRaw)) {
        return null;
    }

    const changes_by_agency_and_line: Record<string, Record<string, RouteChangeForApi[]>> = {};

    const allStopIds = new Set([
        ...alertRaw.added_stop_ids,
        ...alertRaw.removed_stop_ids
    ]);

    const nearStopIds = new Set<string>([]);

    let representativeDate: DateTime|null = null;

    for (const route_id of alertRaw.relevant_route_ids) {
        // 2. actually apply the changes in the alert to this route
        const updates: ApplyAlertState|null = await applyAlertToRoute(
            gtfsDbApi,
            alertRaw,
            route_id,
            allStopIds,
            representativeDate
        );

        if (!updates) {
            continue; // this "shouldn't" happen anyway lol
        }

        const stopSeq = updates.updatedStopSeq;
        const representativeTripId = updates.representativeTripId ?? ""; // this "shouldn't" be null in this case lol
        const rawStopSeq = updates.rawStopSeq ?? []; // this "shouldn't" either haha
        const deletedStopIds = updates.deletedStopIds;
        representativeDate = updates.representativeDate;

        // 3. for the map bounding box, collect all stop_ids of stop that
        // are adjacent to added stops

        for (let i = 1; i < stopSeq.length; i++) {
            const [stopId, isAdded] = stopSeq[i] ?? ["", false];
            const [prevStopId, prevStopIsAdded] = stopSeq[i - 1] ?? ["", false];

            if (isAdded && !prevStopIsAdded) {
                nearStopIds.add(prevStopId);
            } else if (!isAdded && prevStopIsAdded) {
                nearStopIds.add(stopId);
            }
        }

        // 4. decide what to call each route???? as in from/to????? aaaaa israel
        //    (and get route_short_name and agency_id)

        const routeMetadata = (await gtfsDbApi.getRouteMetadata([route_id]))[route_id];

        if (!routeMetadata) {
            throw new Error("Couldn't find details for route with id " + route_id);
        }

        const to_text = await getHeadsign(representativeTripId, rawStopSeq, gtfsDbApi);

        // 5. get shape

        const shape = await gtfsDbApi.getShapePoints(representativeTripId)
            ?? await getFallbackShape(rawStopSeq, gtfsDbApi); // straight lines if we couldn't find a shape
        
        const routeChangeData = {
            ...routeMetadata,
            to_text,
            shape,
            deleted_stop_ids: [...deletedStopIds],
            updated_stop_sequence: stopSeq
        };

        // add to the result struct
        const agencyLines = changes_by_agency_and_line[routeChangeData.agency_id]
            ?? (changes_by_agency_and_line[routeChangeData.agency_id] = {});
        
        const lineChanges = agencyLines[routeChangeData.line_number]
            ?? (agencyLines[routeChangeData.line_number] = []);
        
        lineChanges.push(routeChangeData);

        winston.debug("done processing route_id " + route_id);
    }

    // --> bonus step cause i'm thorough, and motivated by hatred and spite:
    //     sort out any duplicate to_text
    for (const agencyLines of Object.values(changes_by_agency_and_line)) {
        for (const lineChanges of Object.values(agencyLines)) {
            labelLineChangesHeadsignsForDirectionAndAlternative(lineChanges);
        }
    }

    // 6. get all stops' metadata
    const stops_for_map = await gtfsDbApi.getStopsForMap([...allStopIds]);

    // 7. sort each line's changes by.... uhhhh..... good question le'ts
    //    decide on this issue randomly lmao
    for (const agencyLines of Object.values(changes_by_agency_and_line)) {
        for (const lineChanges of Object.values(agencyLines)) {
            lineChanges.sort(
                (a, b) => compareNple(
                    [a.to_text, a.dir_name ?? "", a.alt_name ?? ""],
                    [b.to_text, b.dir_name ?? "", b.alt_name ?? ""]
                )
                // other candidates:
                //  - always north->south/west->east before opposite?
                //  - always big place to small place before opposite?
                //  - by gtfs direction_id???
                //  - by mot route license id thing (route_desc)
                //  - random order for maximum fun! party horn emoji!
            );
        }
    }

    // 8. bounding box for the map widget
    const map_bounding_box = boundingBoxForStops(
        chainIterables(
            alertRaw.added_stop_ids,
            alertRaw.removed_stop_ids,
            nearStopIds
        ),
        stops_for_map
    );

    return {
        route_changes: changes_by_agency_and_line,
        stops_for_map,
        map_bounding_box
    };
}

function doesAlertHaveRouteChanges(alertRaw: AlertWithRelatedInDb) {
    return (
        alertRaw.use_case === AlertUseCase.StopsCancelled
        || alertRaw.use_case === AlertUseCase.RouteChangesFlex
        || alertRaw.use_case === AlertUseCase.RouteChangesSimple
        // TODO region use case???
    );
}

type ApplyAlertState = {
    representativeDate: DateTime|null,
    representativeTripId: string|null,
    rawStopSeq: string[]|null,
    updatedStopSeq: [string, boolean][],
    deletedStopIds: Set<string>
};

async function applyAlertToRoute(
    gtfsDbApi: GtfsDbApi,
    alertRaw: AlertWithRelatedInDb,
    route_id: string,
    mutAllStopIdsSet: Set<string>|null = null,
    representativeDate: DateTime|null = null,
    representativeTripId: string|null = null,
    rawStopSeq: string[]|null = null,
    updatedStopSeq: [string, boolean][]|null = null,
    deletedStopIds: Set<string>|null = null
): Promise<ApplyAlertState|null> {
    // TODO: it looks like i never took care of the REGION use case lmaoooooo
    //       i'd feel much more comfortable implementing it if they,, uh,,,,,, ever used it :|
    //       but sure; i can try to do it al iver just in case


    if (!doesAlertHaveRouteChanges(alertRaw)) {
        return null;
    }
    
    if (!updatedStopSeq) {
        // to create an updatedStopSeq, we first need to get a representative trip

        if (!representativeTripId) {
            // to get a representative trip, we first need to get a representative date

            if (!representativeDate) {
                representativeDate = findRepresentativeDateForRouteChangesInAlert(alertRaw);
            }

            representativeTripId = await gtfsDbApi.getRepresentativeTripId(route_id, representativeDate);
        }

        if (!representativeTripId) {
            throw new Error(`Could not find a representative trip id for route ${route_id} on date ${representativeDate?.toFormat('yyyy-MM-dd')}`);
        }

        if (!rawStopSeq) {
            rawStopSeq = await gtfsDbApi.getStopSeq(representativeTripId);
        }

        if (mutAllStopIdsSet) {
            rawStopSeq.forEach(s => mutAllStopIdsSet.add(s));
        }

        updatedStopSeq = rawStopSeq.map(
            stop_id => [stop_id, false] // [stop_id, is_added]
        );
        deletedStopIds = new Set();
    }

    if (!deletedStopIds) {
        deletedStopIds = new Set();
    }

    // and actually do the magic of computing the new stop sequence
    if (alertRaw.use_case === AlertUseCase.StopsCancelled) {
        // special case :|

        for (const removedStopId of alertRaw.removed_stop_ids) {
            const didRemove = removeStopFromUpdatedStopSeq(updatedStopSeq, removedStopId);

            if (didRemove || alertRaw.relevant_route_ids.length === 1) {
                deletedStopIds.add(removedStopId);
            }
        }
    } else if (alertRaw.use_case === AlertUseCase.RouteChangesFlex || alertRaw.use_case === AlertUseCase.RouteChangesSimple) {
        const changesForRoute = alertRaw.schedule_changes?.[route_id];
        if (!changesForRoute) return null;

        for (const change of changesForRoute) {
            if ("removed_stop_id" in change) {
                const didRemove = removeStopFromUpdatedStopSeq(updatedStopSeq, change.removed_stop_id);

                // the old python server used to warn about when a stop couldn't
                // actually be found in the updatedStopSeq, but uh,,, that happens
                // so often that it's just.... useless to even care about it *facepalm*

                if (didRemove || alertRaw.relevant_route_ids.length === 1) {
                    deletedStopIds.add(change.removed_stop_id);
                }
            } else {
                let destIdx = updatedStopSeq.findIndex(([s, _]) => s === change.relative_stop_id);

                // nice lil edge case the mot didn't think about:
                // what if a trip stops somewhere twice, and we're told to add
                // another stop before/after that one that appears twice?

                // should i like check for that edge case? and put the stop.....
                // uhm.... where.... the .... distance to the other stops?
                // is shortest? idk; or i'll just bug, and blame the government
                // because that's easier

                if (destIdx < 0) {
                    // (here, again, the old python server used to warn if we
                    // couldn't find the stop we're supposed to insert something
                    // relative to; but since our mot is run by toddlers who
                    // care more about highways to illegal settlements in
                    // occupied palestine than providing functioning public transit,
                    // this is such a common occurrence that even debug logging it
                    // feels utterly useless)
                    winston.debug(`tried adding stop relative to stop on on route; route_id=${route_id}, ${JSON.stringify(change)}, alert_id=${alertRaw.id}, trip_id=${representativeTripId}`);

                    continue;
                }

                if (!change.is_before) {
                    destIdx += 1;
                }

                updatedStopSeq.splice(destIdx, 0, [change.added_stop_id, true]);
                winston.debug(`added stop ${change.added_stop_id} to route ${route_id} at index ${destIdx}`);

                if (mutAllStopIdsSet) {
                    mutAllStopIdsSet.add(change.added_stop_id);
                }
            }
        }
    }

    if (mutAllStopIdsSet) {
        deletedStopIds.forEach(s => mutAllStopIdsSet.add(s));
    }

    return {
        representativeDate,
        representativeTripId,
        rawStopSeq,
        updatedStopSeq,
        deletedStopIds
    };
}

function removeStopFromUpdatedStopSeq(
    updatedStopSeq: [string, boolean][],
    stopId: string
) {
    let didRemove = false;
    let nextIndex;
    while ((nextIndex = updatedStopSeq.findIndex(([s, _]) => s === stopId)) >= 0) {
        updatedStopSeq.splice(nextIndex, 1);
        didRemove = true;
    }

    return didRemove;
}

async function getFallbackShape(rawStopSeq: string[], gtfsDbApi: GtfsDbApi) {
    const stopData = await gtfsDbApi.getStopsForMap(rawStopSeq);

    const result: [number, number][] = [];
    for (const stopId of rawStopSeq) {
        const stop = stopData[stopId];
        if (!stop) continue;

        result.push([stop.stop_lon, stop.stop_lat]);
    }
    return result;
}

const ROUTE_DESC_DIR_ALT_REGEX = /^[^-]+-([^-]+)-([^-]+)$/g;

function labelLineChangesHeadsignsForDirectionAndAlternative(
    mut_lineChanges: RouteChangeForApi[]
) {
    const headsignToDirAltPairs: Record<string, [string, string][]> = {};

    const headsignDirAlt_perChange: [string, [string, string]][] = [];

    for (const chg of mut_lineChanges) {
        const dirAltPairs = headsignToDirAltPairs[chg.to_text]
            ?? (headsignToDirAltPairs[chg.to_text] = []);
        
        // using matchAll here because i want to avoid Weird JS Regex Behavior(tm)
        const regexMatch = [...chg.route_desc.matchAll(ROUTE_DESC_DIR_ALT_REGEX)][0];
        const pair: [string, string] = [
            regexMatch?.[1] ?? "",
            regexMatch?.[2] ?? ""
        ];

        dirAltPairs.push(pair);
        headsignDirAlt_perChange.push([chg.to_text, pair]);
    }

    const dirAltNames_perChange = labelHeadsignsForDirectionAndAlternative(
        headsignToDirAltPairs,
        headsignToDirAltPairs,
        headsignDirAlt_perChange
    );

    for (const [chg, [dirName, altName]] of zip(mut_lineChanges, dirAltNames_perChange)) {
        if (dirName) chg.dir_name = dirName;
        if (altName) chg.alt_name = altName;
    }
}

function *labelHeadsignsForDirectionAndAlternative(
    byAlt_headsignToDirAltPairs: Record<string, [string, string][]>,
    byDir_headsignToDirAltPairs: Record<string, [string, string][]>,
    headsignDirAlt_list: [string, [string, string]][],
    labelDirsPerAlt = false
): IterableIterator<[string|null, string|null]> {
    for (const [headsign, dirAltPair] of headsignDirAlt_list) {
        const dupsByAlt = byAlt_headsignToDirAltPairs[headsign] ?? [];
        const dupsByDir = byDir_headsignToDirAltPairs[headsign] ?? [];

        let dirName: string|null = null;
        let altName: string|null = null;

        if (dupsByAlt.length <= 1 && dupsByDir.length <= 1) {
            // no duplicates for this headsign! yay upside down smiley
            yield [dirName, altName];
            continue;
        }

        const [dirId, altId] = dirAltPair;

        if (dupsByDir.some(([dir, alt]) => dir !== dirId && (!labelDirsPerAlt || alt === altId))) {
            // if there's any dups with a different direction id

            // in some distant nebulous future, i could try giving actual names
            // to the directions and alternatives; but not today, not quite yet
            // bukra fil mishmish
            dirName = "" + getNumberForDirection(labelDirsPerAlt, dirId, altId, dupsByDir);
        }

        if (altId !== "#" && altId !== "0" && dupsByAlt.some(([_, alt]) => alt !== altId)) {
            // if there's any dups with a different alternative id
            // (and also this isn't the main alternative)

            // remember what i said about actual names for directions?
            // well, same for the alternatives
            // i mean, like, how the heck does one even approach this problem???
            // we're given basically zero computer readable information that
            // summarizes the differences between directions/alternatives!
            // i guess if someone was eager enough, they COULD go through the
            // stop_seq of a representative trip, but then, how do you turn that
            // into not only user-readable info, but user-useful info, that isn't
            // too long to fit in the ui?????? can't just dump stop names/city names,
            // and detecting street names would be absolutely hellish

            // so uhm,, yeah
            // numbers it is for now

            // again possibly the slowest most inefficient blah blah blah
            // note: a !== "#" && a !== "0"] cause we don't care about the main
            // alternative here

            // i want to display: Towards A, Towards A (Alt 1), Towards A (Alt 2)
            // and not quite:     Towards A, Towards A (Alt 2), Towards A (Alt 3)

            const alternatives = dupsByAlt
                .filter(([_, a]) => a !== "#" && a !== "0")
                .map(([_, a]) => a);
            inPlaceSortAndUnique(alternatives);

            if (alternatives.length === 1) {
                // but also we want to display: Towards A, Towards A (Alt)
                // and not quite:               Towards A, Towards A (Alt 1)
                // because "1" doesn't make sense when there's just the one
                altName = "#"
            } else {
                altName = "" + (alternatives.indexOf(altId) + 1);
            }
        }

        yield [dirName, altName];
    }
}

function getNumberForDirection(
    labelDirsPerAlt: boolean,
    dirId: string,
    altId: string,
    dupsByDir: [string, string][]
) {
    // possible the slowest most inefficient way to do this but as
    // stated earlier, yours truly is truly bad at algo

    const filteredPairs =
        labelDirsPerAlt
            ? dupsByDir.filter(([_, a]) => a === altId)
            : dupsByDir;
    
    const justDirections = filteredPairs.map(([d, _]) => d);
    inPlaceSortAndUnique(justDirections);

    return justDirections.indexOf(dirId) + 1;
}

function boundingBoxForStops(
    stopIds: Iterable<string>,
    stops_for_map: Record<string, StopForMap>
): MapBoundingBox {
    /**
     * get bounding box of affected stops, for setting the maps' bounding box
     */

    let min_lon = Infinity;
    let min_lat = Infinity;
    let max_lon = -Infinity;
    let max_lat = -Infinity;

    for (const stopId of stopIds) {
        const stop = stops_for_map[stopId];
        if (!stop) continue;

        if (min_lon > stop.stop_lon) {
            min_lon = stop.stop_lon;
        }
        if (min_lat > stop.stop_lat) {
            min_lat = stop.stop_lat;
        }
        if (max_lon < stop.stop_lon) {
            max_lon = stop.stop_lon;
        }
        if (max_lat < stop.stop_lat) {
            max_lat = stop.stop_lat;
        }
    }

    return {
        min_lon,
        min_lat,
        max_lon,
        max_lat
    };
}
