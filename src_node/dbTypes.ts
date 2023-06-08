import { transit_realtime } from "gtfs-realtime-bindings";

export enum AlertUseCase {
    National = 1,
    Agency = 2,
    Region = 3,
    Cities = 4,
    StopsCancelled = 5,
    RouteChangesFlex = 6, // "stop-on-route"
    RouteChangesSimple = 7, // "routes-at-stop"
    ScheduleChanges = 8 // "trips-of-route"

    // i think the names i made up are better than the terrible mot ones
}

export type OriginalSelector =
    {
        stop_ids: string[]
    } | {
        route_stop_pairs: [string, string][],
        old_aramaic?: string
    } | {
        trips: TripSelector[]
    } | {
        cities: string[]
    } | {
        // empty object, for when it's a national alert
    } | {
        old_aramaic: string
    };

export type TripSelector = {
    route_id: string,
    fake_trip_id: string,
    action: transit_realtime.TripDescriptor.ScheduleRelationship,
    start_time: string
};

export type RouteChanges = {
    [routeId: string]: (AddStopChange|RemoveStopChange)[]
};

export type AddStopChange = {
    added_stop_id: string,
    relative_stop_id: string,
    is_before: boolean
};

export type RemoveStopChange = {
    removed_stop_id: string
};

export type DepartureChanges = {
    [routeId: string]: {
        added: string[],
        removed: string[]
    }
};
