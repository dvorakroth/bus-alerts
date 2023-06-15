import { DateTime } from "luxon";
import { ActualLineWithAlertCount, AlertForApi, AllLinesResponse, RouteChangeMapData, RouteChangesResponse } from "../src_node/apiTypes";

type StripDates<T> = T extends DateTime
    ? string
    : T extends Object
    ? {
        [k in keyof(T)]: StripDates<T[k]>
    }
    : T;

export type ServiceAlert = StripDates<AlertForApi>;
export type AlertsResponse = {
    alerts?: ServiceAlert[];
} & Partial<StripDates<RouteChangesResponse>>;

export type ActualLine = StripDates<ActualLineWithAlertCount>;
export type LinesListResponse = StripDates<AllLinesResponse>;

export type {
    Agency,
    SimpleActivePeriod,
    ConsolidatedActivePeriod,
    StopForMap,
    SingleLineChanges,
    MapBoundingBox,
    PrettyActivePeriod,
    RouteChangeForApi,
    DepartureChangeDetail,
    AlertPeriodWithRouteChanges,
    TranslationObject
} from "../src_node/apiTypes";
export type ActiveTime = [string, string, boolean];
export type DateOrDateRange = string | [string, string];
export type RouteChangeForMap = RouteChangeMapData & {has_no_changes?: boolean};

export const USE_CASES = {
    "NATIONAL": 1,
    "AGENCY": 2,
    "REGION": 3,
    "CITIES": 4,
    "STOPS_CANCELLED": 5,
    "ROUTE_CHANGES_FLEX": 6,
    "ROUTE_CHANGES_SIMPLE": 7,
    "SCHEDULE_CHANGES": 8
} as const;

export const USE_CASES_REVERSE = {
    1: "NATIONAL",
    2: "AGENCY",
    3: "REGION",
    4: "CITIES",
    5: "STOPS_CANCELLED",
    6: "ROUTE_CHANGES_FLEX",
    7: "ROUTE_CHANGES_SIMPLE",
    8: "SCHEDULE_CHANGES"
}
