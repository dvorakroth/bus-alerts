import { DateTime } from "luxon";
import { BaseAlert } from "./dbTypes.js";

export type AlertAdditionalData = {
    added_stops: [string, string][]; // stop_code, stop_name
    removed_stops: [string, string][]; // ditto
    relevant_lines: Record<string, string[]>; // agency_id -> [route_short_name, route_short_name, ...]
    relevant_agencies: {agency_id: string, agency_name: string}[];

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

export type RouteChangesResponse = {
    route_changes: {}, // TODO
    stop_for_map: {}, // TODO
    map_bounding_box: {} // TODO
};
