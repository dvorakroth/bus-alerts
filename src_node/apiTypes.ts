import { DateTime } from "luxon";
import { ActualLine, BaseAlert } from "./dbTypes.js";

export type AlertAdditionalData = {
    added_stops: [string, string][]; // stop_code, stop_name
    removed_stops: [string, string][]; // ditto
    relevant_lines: Record<string, string[]>; // agency_id -> [route_short_name, route_short_name, ...]
    relevant_agencies: Agency[];

    first_relevant_date: null|DateTime;
    current_active_period_start: null|DateTime;

    departure_changes: Record<string, Record<string, DepartureChangeDetail[]>>; // agency_id -> line_number -> [change, change, change, ...]
}

export type DepartureChangeDetail = RouteMetadata & {
    to_text: string,
    added_hours: string[],
    removed_hours: string[]
};

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
    alt_name?: string,
    shape: [number, number][], // [[lon, lat], [lon, lat], ...]
    deleted_stop_ids: string[],
    updated_stop_sequence: [string, boolean][] // [[stop_id, is_added], [stop_id, is_added], ...]
};

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
    route_changes: Record<string, Record<string, RouteChangeForApi[]>>, // agency_id -> line_number -> changes[]
    stops_for_map: Record<string, StopForMap>,
    map_bounding_box: MapBoundingBox
};

export type Agency = {
    agency_id: string,
    agency_name: string
};

export type ActualLineWithAlertCount = 
    Omit<ActualLine, "all_directions_grouped">
    & {
        num_alerts: number;
        first_relevant_date: DateTime|null;
        num_relevant_today: number|null;
        num_removed_stops: number|null;
        all_directions_grouped: undefined;
    };

export type AllLinesResponse = {
    lines_with_alert: ActualLineWithAlertCount[];
    all_lines: ActualLineWithAlertCount[];
    all_agencies: Record<string, Agency>;
    uses_location: boolean;
};
