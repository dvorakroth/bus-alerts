import { AlertUseCase, AlertWithRelatedInDb } from "../dbTypes.js";
import { inPlaceSortAndUnique } from "../generalJunkyard.js";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GtfsDbApi } from "./gtfsDbApi.js";

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

    const allStopIds = [
        ...alertRaw.added_stop_ids,
        ...alertRaw.removed_stop_ids
    ];
    inPlaceSortAndUnique(allStopIds);

    const nearStopIds = new Set<string>([]);

    let representativeDate: DateTime|null = null;

    // TODO
}

function doesAlertHaveRouteChanges(alertRaw: AlertWithRelatedInDb) {
    return (
        alertRaw.use_case === AlertUseCase.StopsCancelled
        || alertRaw.use_case === AlertUseCase.RouteChangesFlex
        || alertRaw.use_case === AlertUseCase.RouteChangesSimple
        // TODO region use case???
    );
}
