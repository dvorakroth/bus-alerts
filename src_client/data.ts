export type JsDict<T> = { [id: string]: T };

export interface Agency {
    agency_id: string;
    agency_name: string;
}

export interface TranslatedString {
    he: string;
    en: string;
    ar: string;
}

export interface SimpleActivePeriod {
    simple: [string, string];
}

export type DateOrDateRange = string | [string, string];
export type ActiveTime = [string, string, boolean];

export interface ConsolidatedActivePeriod {
    dates: DateOrDateRange[];
    times: ActiveTime[];
}

export type ActivePeriod = SimpleActivePeriod | ConsolidatedActivePeriod;

// export interface DepartureChanges {
//     added: string[];
//     removed: string[];
// }

// export interface StopRemoved {
//     removed_stop_id: string;
// }

// export interface StopAdded {
//     added_stop_id: string;
//     relative_stop_id: string;
//     is_before: boolean;
// }

// export type RouteChanges = StopRemoved | StopAdded;

// export type ScheduleChanges = JsDict<DepartureChanges[]> | JsDict<RouteChanges[]>;

// export function isDepartureChanges(obj: any): obj is DepartureChanges {
//     return Array.isArray(obj?.added) && Array.isArray(obj?.removed);
// }

export const USE_CASES: JsDict<number> = {
    "NATIONAL": 1,
    "AGENCY": 2,
    "REGION": 3,
    "CITIES": 4,
    "STOPS_CANCELLED": 5,
    "ROUTE_CHANGES_FLEX": 6,
    "ROUTE_CHANGES_SIMPLE": 7,
    "SCHEDULE_CHANGES": 8
};
export const USE_CASES_REVERSE = 
    Object.keys(USE_CASES)
        .reduce<JsDict<string>>(
            (prev, name) => {
                prev[USE_CASES[name]] = name;
                return prev;
            },
            {}
        );

type ValueOf<T> = T[keyof T];

// export function isServiceAlert(obj: any): obj is ServiceAlert {
//     return 'use_case' in obj && typeof(USE_CASES_REVERSE[obj.use_case]) === "string";
// }

export interface ServiceAlert {
    id: string;
    first_start_time: string;
    last_end_time: string;
    use_case: ValueOf<typeof USE_CASES>;
    // cause: string;
    // effect: string;
    // url: TranslatedString;
    header: TranslatedString;
    description: TranslatedString;
    active_periods: {
        raw: [number, number][],
        consolidated: ActivePeriod[]
    };
    // schedule_changes: ScheduleChanges;
    is_national: boolean;
    is_deleted: boolean;

    relevant_agencies: Agency[];
    // relevant_route_ids: string[];
    // added_stop_ids: string[];
    // removed_stop_ids: string[];

    is_expired: boolean;

    relevant_lines: JsDict<string[]>; // agency_id -> line_number[]
    added_stops: [string, string][];
    removed_stops: [string, string][];

    first_relevant_date: string;
    distance?: number;
    departure_changes?: JsDict<JsDict<DepartureChange[]>>; // timetable_changes[agency_id]?.[line_number] = [{}, {}, {}, ...]?

    relevant_lines_for_search?: string[];
}

export interface StopForMap {
    stop_code: string;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
}

export interface RouteChange {
    agency_id: string;
    agency_name: string;
    line_number: string;

    to_text: string; // headsign? city? stop? haha w/e
    alt_name?: string; // god help us all
    dir_name?: string; // alt_name and dir_name are for giving slightly more informative headsigns when there's duplicates
    
    shape: [number, number][]; // geojson compatible [lon, lat] coords
    deleted_stop_ids: string[]; // ids because stop_code isn't unique haha this is fine
    updated_stop_sequence: [string, boolean][]; // [stop_id, is_new]
}

export interface BoundingBox {
    min_lon: number;
    min_lat: number;
    max_lon: number;
    max_lat: number;
}

export interface DepartureChange {
    agency_id: string;
    agency_name: string;
    line_number: string;
    to_text: string;
    added_hours: string[];
    removed_hours: string[];
}

export interface AlertsResponse {
    alerts?: ServiceAlert[];
    route_changes?: JsDict<JsDict<RouteChange[]>>; // route_changes[agency_id]?.[line_number] = [{}, {}, {}, ...]?
    stops_for_map?: JsDict<StopForMap>; // by id
    map_bounding_box?: BoundingBox;
}

export type ActualLinePk = `${string}_${string}`;

export interface ActualLine {
    pk: ActualLinePk;
    mot_license_id: string;
    route_short_name: string;
    agency_id: string;
    headsign_1: string;
    headsign_2: string;
    is_night_line: boolean;
    // num_alternatives: number;
    // all_mot_alternative_ids: string[];
    // all_mot_direction_ids_groups: string[][];
    // all_route_ids_grouped: string[][];
    // all_headsigns_grouped: string[][];

    main_cities: string[];
    secondary_cities: string[];
    
    num_alerts: number;
    first_relevant_date: string;
    num_relevant_today: number;
    num_removed_stops: number;
    // num_relevant_tomorrow: number;
    // num_relevant_future: number;
    // alert_titles: TranslatedString[];
    // removed_stops: [string, string][];
    // added_stops: [string, string][];
}

export interface LinesListResponse {
    lines_with_alert: ActualLine[];
    // linepk_to_alert_count: JsDict<number>;
    all_lines: ActualLine[];
    all_agencies: JsDict<Agency>;
    uses_location: boolean;
}

export interface LineDir {
    headsign: string;
    is_circular: boolean;
    stop_seq: string[];
    shape: [number, number][];
    city_list: string[];
}

export interface LineAlt {
    alt_id: string;
    directions: LineDir[];
}

export interface SingleLineDetails {
    pk: ActualLinePk;
    route_short_name: string;
    agency: Agency;
    headsign_1: string;
    headsign_2: string;
    is_night_line: boolean;
    all_directions_grouped: LineAlt[];
}

export interface SingleLineResponse {
    line_details: SingleLineDetails;
    all_stops: JsDict<StopForMap>;
}