import { FurryKeyDefinition, FurrySortFunc } from "furry-text-search";
import { ActualLine, Agency, ServiceAlert } from "./protocol";

// export type SearchWorkerMessageNewData = {
//     msg: "newdata",
//     alerts: ServiceAlert[]
// };

// export type SearchWorkerMessageDoSearch = {
//     msg: "dosearch",
//     queries: string[],
//     id: number
// }

// export type SearchWorkerRequest = 
//     SearchWorkerMessageNewData 
//     | SearchWorkerMessageDoSearch;

// export type SearchWorkerResponse = {
//     id: number,
//     results: FurrySearchResult<ServiceAlert>[]
// }

// export function isNewData(obj: SearchWorkerRequest): obj is SearchWorkerMessageNewData {
//     return obj.msg === "newdata";
// }

// export function isDoSearch(obj: SearchWorkerMessageDoSearch): obj is SearchWorkerMessageDoSearch {
//     return obj.msg === "dosearch";
// }

export const LINE_SEARCH_KEY_INDICES = {
    ROUTE_SHORT_NAME: 0,
    HEADSIGN_1: 1,
    HEADSIGN_2: 2,
    MAIN_CITIES: 3,
    SECONDARY_CITIES: 4
}

export const ALERT_SEARCH_KEY_INDICES = {
    HEADER_HE: 0,
    DESCRIPTION_HE: 1,
    AGENCY_NAME: 2,
    LINE_NUMBER: 3,
    ADDED_STOP_NAME: 4,
    ADDED_STOP_CODE: 5,
    REMOVED_STOP_NAME: 6,
    REMOVED_STOP_CODE: 7
};

export const LINE_SEARCH_KEYS = (all_agencies: Record<string, Agency>): FurryKeyDefinition<ActualLine>[] => [
    {
        get: a => a.route_short_name,
        weight: 1
    },
    {
        get: a => a.headsign_1 ?? "",
        weight: 0.1
    },
    {
        get: a => a.headsign_2 ?? "",
        weight: 0.1
    },
    {
        get: a => a.main_cities,
        weight: 0.1
    },
    {
        get: a => a.secondary_cities,
        weight: 0.1
    },
    {
        get: a => all_agencies[a.agency_id]?.agency_name ?? "",
        weight: 0.05
    }
];

export const ALERT_SEARCH_KEYS: FurryKeyDefinition<ServiceAlert>[] = [
    {
        // "name": "header.he",
        "get": (a) => a.header.he ?? "",
        "weight": 1
    },
    {
        // "name": "description.he",
        "get": (a) => a.description.he ?? "",
        "weight": 0.3
    },
    {
        // "name": "relevant_agencies.agency_name",
        "get": (a) => a.relevant_agencies.map(agency => agency.agency_name),
        "weight": 2
    },
    {
        // "name": "relevant_lines_for_search",
        "get": (a) => a.relevant_agencies
                        .map(
                            ({agency_id}) => 
                                a.relevant_lines[agency_id]?.map(
                                    line_pk => line_pk.split("_")[0] ?? line_pk
                                )
                                ?? []
                        )
                        .reduce((a, b) => a.concat(b), []),
        "weight": 1
    },
    {
        // "name": "added_stops.1", // stop_name
        "get": (a) => a.added_stops.map(([stop_code, stop_name]) => stop_name),
        "weight": 1
    },
    {
        // "name": "added_stops.0", // stop_code
        "get": (a) => a.added_stops.map(([stop_code, stop_name]) => stop_code),
        "weight": 0.1,
        useExactSearch: true
        // "$force_extended": true,
        // "$force_extended_prefix": "="
    },
    {
        // "name": "removed_stops.1", // stop_name
        "get": (a) => a.removed_stops.map(([stop_code, stop_name]) => stop_name),
        "weight": 1
    },
    {
        // "name": "removed_stops.0", // stop_code
        "get": (a) => a.removed_stops.map(([stop_code, stop_name]) => stop_code),
        "weight": 0.1,
        useExactSearch: true
        // "$force_extended": true,
        // "$force_extended_prefix": "="
    }
];

export const DEFAULT_SORT_COMPARE_FUNC: FurrySortFunc<any> = (a, b) => {
    if (a.score === b.score)
        return a.idx - b.idx;
    else
        return a.score - b.score;
}

export const ALERT_SORT_COMPARE_FUNC: FurrySortFunc<ServiceAlert> = (a, b) => {
    const aDeleted = a.obj.is_deleted || a.obj.is_expired;
    const bDeleted = b.obj.is_deleted || b.obj.is_expired;

    if (aDeleted === bDeleted) {
        if (a.score === b.score) {
            return a.idx - b.idx;
        } else {
            return a.score - b.score;
        }
    } else {
        return aDeleted ? 1 : -1; // put deleted after non deleted
    }
}

export const SEARCH_THRESHOLD = 0.35;
