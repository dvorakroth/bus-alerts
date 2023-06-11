import { DateTime } from "luxon";
import { AlertUseCase, AlertWithRelatedInDb } from "../dbTypes.js";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GtfsDbApi } from "./gtfsDbApi.js";
import { findRepresentativeDateForRouteChangesInAlert } from "./alerts.js";
import winston from "winston";

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

    const changes_by_agency_and_line: Record<string, Record<string, any>> = {}; // TODO type?

    const allStopIds = new Set([
        ...alertRaw.added_stop_ids,
        ...alertRaw.removed_stop_ids
    ]);

    const nearStopIds = new Set<string>([]);

    let representativeDate: DateTime|null = null;

    for (const route_id of alertRaw.relevant_route_ids) {
        // 2. actually apply the changes in the alert to this route
        const updates = await applyAlertToRoute(
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
        const representativeTripId = updates.representativeTripId;
        const rawStopSeq = updates.rawStopSeq ?? []; // this "shouldn't" be null in this case lol
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

        const routeMetadata = (await gtfsDbApi.getRouteMetadata([route_id]))[0];

        if (!routeMetadata) {
            throw new Error("Couldn't find details for route with id " + route_id);
        }

        const additionalRouteMetadata = {
            to_text: null // TODO
        };
        // TODO
    }
}

function doesAlertHaveRouteChanges(alertRaw: AlertWithRelatedInDb) {
    return (
        alertRaw.use_case === AlertUseCase.StopsCancelled
        || alertRaw.use_case === AlertUseCase.RouteChangesFlex
        || alertRaw.use_case === AlertUseCase.RouteChangesSimple
        // TODO region use case???
    );
}

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
) {
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
