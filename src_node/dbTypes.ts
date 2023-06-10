import { transit_realtime } from "gtfs-realtime-bindings";
import { DateTime } from "luxon";

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

export type TranslationObject = {
    he?: string;
    en?: string;
    ar?: string;
    oar?: string;
};

export type PrettyActivePeriod = 
    {simple: [string|null, string|null]} // just ISO date strings
    | {
        dates: (string|[string, string])[], // each element: either "yyyy-MM-dd" OR a range ["yyyy-MM-dd", "yyyy-MM-dd"]
        times: [string, string, boolean][]  // each element: ["HH:mm", "HH:mm", doesEndNextDay]
    };

type BaseAlertInDb = {
    id: string,
    first_start_time: DateTime,
    last_end_time: DateTime,

    use_case: AlertUseCase,
    header: TranslationObject,
    description: TranslationObject,
    active_periods: {
        raw: [number|null, number|null][],
        consolidated: PrettyActivePeriod[]
    },
    is_national: boolean,

    relevant_agencies: string[],
    relevant_route_ids: string[],
    added_stop_ids: string[],
    removed_stop_ids: string[]
} & (
    {
        use_case: AlertUseCase.ScheduleChanges,
        schedule_changes: DepartureChanges
    } | {
        use_case: AlertUseCase.RouteChangesFlex|AlertUseCase.RouteChangesSimple,
        schedule_changes: RouteChanges
    } | {
        schedule_changes: null
    }
);

export type AlertInDb = BaseAlertInDb & {
    raw_data: Uint8Array,

    original_selector: OriginalSelector,
    cause: string,
    effect: string,
    url: TranslationObject,

    deletion_tstz: DateTime|null
}

export type AlertWithRelatedInDb = BaseAlertInDb & {
    is_deleted: boolean,
    is_expired: boolean
};
