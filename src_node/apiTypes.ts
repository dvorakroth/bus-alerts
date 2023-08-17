import { DateTime } from "luxon";
import { ActualLine, AlertUseCase, BaseAlert, ConsolidatedActivePeriod, LineDir, PrettyActivePeriod, SimpleActivePeriod, TranslationObject } from "./dbTypes.js";

export type {
    PrettyActivePeriod,
    SimpleActivePeriod,
    ConsolidatedActivePeriod,
    TranslationObject,
    AlertUseCase
};

export type AlertAdditionalData = {
    added_stops: [string, string][]; // stop_code, stop_name
    removed_stops: [string, string][]; // ditto
    relevant_lines: Record<string, string[]>; // agency_id -> [line_pk, line_pk, ...]
    relevant_agencies: Agency[];

    first_relevant_date: null|DateTime;
    current_active_period_start: null|DateTime;

    departure_changes: Record<string, Record<string, DepartureChangeDetail[]>>; // agency_id -> line_pk -> [change, change, change, ...]
}

export type DepartureChangeDetail = RouteMetadata & AddedRemovedDepartures & {
    to_text: string;
};

export type AddedRemovedDepartures = {
    added_hours: string[],
    removed_hours: string[]
}

export type RouteMetadata = {
    route_id: string,
    route_desc: string,
    agency_id: string,
    line_number: string,
    agency_name: string
};

export type AlertForApi = BaseAlert & AlertAdditionalData & {
    is_expired: boolean,
    is_deleted: boolean,

    distance?: number
};

export type RouteChangeForApi = RouteMetadata & {
    to_text: string,
    dir_name?: string,
    alt_name?: string
} & RouteChangeMapData;
//     shape: [number, number][], // [[lon, lat], [lon, lat], ...]
//     deleted_stop_ids: string[],
//     updated_stop_sequence: [string, boolean][] // [[stop_id, is_added], [stop_id, is_added], ...]
// };

export type StopForMap = {
    stop_id: string,
    stop_lon: number,
    stop_lat: number
};

export type MapBoundingBox = {
    min_lon: number,
    min_lat: number,
    max_lon: number,
    max_lat: number
};

export type RouteChangesResponse = {
    route_changes: Record<string, Record<string, RouteChangeForApi[]>>, // agency_id -> line_pk -> changes[]
    stops_for_map: Record<string, StopForMap>,
    map_bounding_box: MapBoundingBox,
    polygon?: [number, number][] // [[lon, lat], [lon, lat], ...]
};

export type Agency = {
    agency_id: string,
    agency_name: string
};

export type ActualLineWithAlertCount = 
    Omit<ActualLine, "all_directions_grouped" | "all_stopids_distinct">
    & {
        num_alerts: number;
        // first_relevant_date: DateTime|null;
        first_relevant_timestamp: DateTime|null;
        num_relevant_right_now: number|null;
        num_relevant_today: number|null;
        num_removed_stops: number|null;
        all_directions_grouped: undefined;
        all_stopids_distinct: undefined;
    }
    & {
        distance?: number;
    };

export type AllLinesResponse = {
    lines_with_alert: ActualLineWithAlertCount[];
    all_lines: ActualLineWithAlertCount[];
    all_agencies: Record<string, Agency>;
    uses_location: boolean;
};

export type StopMetadata = {
    stop_id: string;
    stop_lon: number;
    stop_lat: number;
    stop_name: string;
    stop_code: string;
};

export type AlertMinimal = {
    id: string;
    header: TranslationObject;
    use_case: AlertUseCase;
};

export type AlertPeriod = {
    start: number,
    end: number,
    bitmask: number
};

export type RouteChangeMapData = {
    updated_stop_sequence: [string, boolean][];
    deleted_stop_ids: string[];
    raw_stop_seq?: string[];
    shape: null|([number, number][]);

    map_bounding_box?: MapBoundingBox; // TODO use this in per-alert route changes
    has_no_route_changes?: boolean;
}

export type AlertPeriodWithRouteChanges =
    AlertPeriod &
    Omit<RouteChangeMapData, "raw_stop_seq" | "shape"> &
    {
        departure_changes?: AddedRemovedDepartures|undefined;

        raw_stop_seq: undefined;
        shape: undefined;
    };

export type FlattenedLineDir = LineDir & {
    alt_id: string;
    stop_seq: string[];
    shape: null|([number, number][]); // [[lon, lat], [lon, lat], ...]
    deleted_alerts: AlertMinimal[];
    time_sensitive_alerts?: {
        periods: AlertPeriodWithRouteChanges[];
        alert_metadata: AlertMinimal[];
    }

    dir_name: string|null;
    alt_name: string|null;
}

export type LineDetails = {
    pk: string;
    route_short_name: string;
    agency: Agency;
    headsign_1: string;
    headsign_2: string;
    is_night_line: boolean;
    dirs_flattened: FlattenedLineDir[];
};

export type SingleLineChanges = {
    line_details: LineDetails;
    all_stops: Record<string, StopMetadata>;
    map_bounding_box: MapBoundingBox;
}
