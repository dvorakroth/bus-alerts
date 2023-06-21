import { DateTime } from "luxon";
// import Fuse from "../Fuse/src";
import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { FuriousSearchMatch } from "../../FuriousSearch/furiousindex";
import { Agency, ServiceAlert } from "../protocol";
import { DOW_SHORT, isoToLocal, JERUSALEM_TZ, short_datetime_hebrew, short_date_hebrew } from "../junkyard/date_utils";
import { ALERT_SEARCH_KEY_INDICES } from "../search_worker_data";
import { AgencyTag } from "../RandomComponents/AgencyTag";
import { DistanceTag } from "../RandomComponents/DistanceTag";

type ValueOf<T> = T[keyof T];

const RELEVANCE_LEVELS = {
    TODAY: 'today',
    TOMORROW: 'tomorrow',
    FUTURE: 'future',
    EXPIRED: 'expired',
    DELETED: 'deleted' 
} as const;
const RELEVANCE_TEXT = {
    [RELEVANCE_LEVELS.TODAY]: 'רלוונטית להיום!',
    [RELEVANCE_LEVELS.TOMORROW]: 'רלוונטית ממחר ',
    [RELEVANCE_LEVELS.FUTURE]: 'רלוונטית מיום ',
    [RELEVANCE_LEVELS.EXPIRED]: 'פגת תוקף',
    [RELEVANCE_LEVELS.DELETED]: 'נמחקה',
} as const;

function get_relevance_string(
    relevance_level: string,
    relevant_date: DateTime|null,
    first_start_time: DateTime|null
) {

    if (
        relevance_level === RELEVANCE_LEVELS.DELETED
        || relevance_level === RELEVANCE_LEVELS.EXPIRED
    ) {
        return RELEVANCE_TEXT[relevance_level];
    }

    if (!relevant_date || !first_start_time) {
        return RELEVANCE_TEXT[RELEVANCE_LEVELS.DELETED];
    }

    switch(relevance_level) {
        case RELEVANCE_LEVELS.TODAY:
        case RELEVANCE_LEVELS.TOMORROW:
            return RELEVANCE_TEXT[relevance_level] + " (יום " + DOW_SHORT[relevant_date.weekday] + ")";
        case RELEVANCE_LEVELS.FUTURE:
            return RELEVANCE_TEXT[relevance_level] +
                short_date_hebrew(relevant_date || first_start_time)
    }
}

export interface RelevanceTagProps {
    is_deleted: boolean;
    is_expired: boolean;
    first_relevant_date: string|null;
    first_start_time: string|null;
}

export const RelevanceTag = React.memo(
    (
        {
            is_deleted,
            is_expired,
            first_relevant_date,
            first_start_time
        }: RelevanceTagProps
    ) => {
        const _first_relevant_date = isoToLocal(first_relevant_date);
        const _first_start_time = isoToLocal(first_start_time);

        let relevance_level: ValueOf<typeof RELEVANCE_LEVELS> = RELEVANCE_LEVELS.FUTURE;
        if (is_deleted) {
            relevance_level = RELEVANCE_LEVELS.DELETED;
        } else if (is_expired || !first_relevant_date) {
            relevance_level = RELEVANCE_LEVELS.EXPIRED;
        } else {
            const today_in_jerus = DateTime.now().setZone(JERUSALEM_TZ).set({
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            });

            if (_first_relevant_date?.toMillis() === today_in_jerus.toMillis()) {
                relevance_level = RELEVANCE_LEVELS.TODAY;
            } else if (_first_relevant_date?.toMillis() === today_in_jerus.plus({days: 1}).toMillis()) {
                relevance_level = RELEVANCE_LEVELS.TOMORROW;
            }
        }

        return <span className={"relevant-tag relevant-tag-" + relevance_level}>
            {get_relevance_string(relevance_level, _first_relevant_date, _first_start_time)}
        </span>
    }
);


const RELEVANT_UNTIL          = "רלוונטית עד:";
const RELEVANT_AGENCIES_LABEL = "חברות מפעילות:";
const RELEVANT_LINES_LABEL    = "קווים מושפעים:";
const REMOVED_STOPS_LABEL     = "תחנות מבוטלות:";
const ADDED_STOPS_LABEL       = "תחנות חדשות:";
const MORE_DETAILS_STRING     = "לחצו לפרטים נוספים >";

// const TEST_AGENCIES = [
//     ["2", "רכבת ישראל"],
//     ["3", "אגד"],
//     ["4", "אגד תעבורה"],
//     ["5", "דן"],
//     ["6", "ש.א.מ"],
//     ["7", "נסיעות ותיירות"],
//     ["8", "גי.בי.טורס"],
//     ["10", "מועצה אזורית אילות"],
//     ["14", "נתיב אקספרס"],
//     ["15", "מטרופולין"],
//     ["16", "סופרבוס"],
//     ["18", "קווים"],
//     ["20", "כרמלית"],
//     ["21", "כפיר"],
//     ["23", "גלים"],
//     ["24", "מועצה אזורית גולן"],
//     ["25", "אלקטרה אפיקים"],
//     ["31", "דן בדרום"],
//     ["32", "דן באר שבע"],
//     ["33", "כבל אקספרס"],
//     ["34", "תנופה"],
//     ["35", "בית שמש אקספרס"],
//     ["37", "אקסטרה"],
//     ["42", "ירושלים-רמאללה איחוד"],
//     ["44", "ירושלים-אבו-תור-ענאתא איחוד"],
//     ["45", "ירושלים-אלווסט איחוד"],
//     ["47", "ירושלים-הר הזיתים"],
//     ["49", "ירושלים - עיסאוויה מחנה שעפאט איחוד"],
//     ["50", "ירושלים-דרום איחוד"],
//     ["51", "ירושלים-צור באהר איחוד"],
//     ["91", "מוניות מטרו קו"],
//     ["92", "מוניות שי-לי של "],
//     ["93", "מוניות מאיה יצחק שדה"],
//     ["97", "אודליה מוניות בעמ"],
//     ["98", "מוניות רב קווית 4-5"]
// ].map(([agency_id, agency_name]) => ({agency_id, agency_name}));

// const TEST_ROUTES: JsDict<string[]> = TEST_AGENCIES.reduce<JsDict<string[]>>(
//     (prev, {agency_id}) => {
//         prev[agency_id] = [agency_id, agency_id];
//         return prev;
//     },
//     {}
// );

// const TEST_AGENCIES = [
//     ["3", "אגד"], ["5", "דן"], ["91", "מוניות מטרו קו"], ["21", "כפיר"]
// ].map(([agency_id, agency_name]) => ({agency_id, agency_name}));

// const TEST_ROUTES = {
//     "3": ["3", "3", "3", "3", "3", "3", "3"], 
//     "5": ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "5"],
//     "91": ["91", "91", "91"],
//     "21": ["21", "21", "21", "21", "21", "21"]
// };

interface RelevantAgenciesListProps {
    relevant_agencies: Agency[]; // list of agency_ids
    agencyNameMatches?: FuriousSearchMatch[];
}

function RelevantAgenciesList({relevant_agencies, agencyNameMatches}: RelevantAgenciesListProps) {
    // relevant_agencies = TEST_AGENCIES;
    return (relevant_agencies.length > 0)
        ? <>
            <h2>{RELEVANT_AGENCIES_LABEL}</h2>
            <div className="relevant-agencies">
                {relevant_agencies.map(({agency_id, agency_name}, idx) =>
                    <AgencyTag key={agency_id}
                               agency_id={agency_id}
                               agency_name={agency_name}
                               matches={agencyNameMatches?.[idx]} />
                )}
            </div>
        </>
        : null;
}

export interface RelevantLinesListProps {
    relevant_lines: Record<string, string[]>;
    relevant_agencies: Agency[];
    agencyNameMatches?: FuriousSearchMatch[];
    lineNumberMatches?: FuriousSearchMatch[];
}

export function RelevantLinesList(
    {
        relevant_lines,
        relevant_agencies,
        agencyNameMatches,
        lineNumberMatches
    }: RelevantLinesListProps
) {
    // hmm did i ever really need this check? hmmmmmm whatever not gonna loop thru lol
    // if (!relevant_lines?.length) {
    //     return null;
    // }
    
    // relevant_lines = TEST_ROUTES;
    // relevant_agencies = TEST_AGENCIES;

    // we trust the server (which, conveniently enough, i'm also the gardener of)
    // to give us an already-sorted list of agencies, and already-sorted lists
    // of line_numbers

    let lineGlobalIdx = 0;

    return <>
            <h2>{RELEVANT_LINES_LABEL}</h2>
            {relevant_agencies.map(({agency_name, agency_id}, agencyIdx) =>
                <React.Fragment key={agency_id}>
                    <AgencyTag agency_name={agency_name}
                               agency_id={agency_id}
                               matches={agencyNameMatches?.[agencyIdx]} />
                    <ul className="relevant-lines" key={agency_id}>
                        {(relevant_lines[agency_id] || []).map((line_number) => {
                            lineGlobalIdx += 1;

                            return <li className={"line-number operator-" + agency_id}
                                key={agency_id + "__" + line_number}>
                                    <MatchedString s={line_number}
                                                   matches={lineNumberMatches?.[lineGlobalIdx - 1]} />
                            </li>;
                        })}
                    </ul>
                </React.Fragment>
            )}
        </>;
}

export const RelevantLinesOrAgencies = React.memo(
    ({
        relevant_lines,
        relevant_agencies,
        agencyNameMatches,
        lineNumberMatches
    }: RelevantLinesListProps) => {
        let hasRelevantLines = React.useMemo(
            () => {
                let result = false;

                for (const agency of relevant_agencies) {
                    if (relevant_lines[agency.agency_id]?.length) {
                        result = true;
                        break;
                    }
                }

                return result;
            },
            [relevant_lines, relevant_agencies]
        );
        

        return hasRelevantLines
            ? <RelevantLinesList relevant_lines={relevant_lines}
                                relevant_agencies={relevant_agencies}
                                agencyNameMatches={agencyNameMatches}
                                lineNumberMatches={lineNumberMatches} />
            : <RelevantAgenciesList agencyNameMatches={agencyNameMatches} 
                                    relevant_agencies={relevant_agencies} />;
    },
    (oldProps, newProps) => {
        if (oldProps.relevant_lines !== newProps.relevant_lines) {
            return false;
        }

        if (oldProps.relevant_agencies !== newProps.relevant_agencies) {
            return false;
        }

        if (!areMatchListsEqual(oldProps.agencyNameMatches, newProps.agencyNameMatches)) {
            return false;
        }

        if (!areMatchListsEqual(oldProps.lineNumberMatches, newProps.lineNumberMatches)) {
            return false;
        }

        return true;
    }
);

function areMatchListsEqual(a: FuriousSearchMatch[]|undefined, b: FuriousSearchMatch[]|undefined) {
    if (a === b || (!a && !b)) {
        return true;
    }

    if (!a) {
        return !b?.length;
    }
    
    if (!b) {
        return !a?.length;
    }

    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (!areMatchesEqual(a[i], b[i])) {
            return false;
        }
    }

    return true;
}

export function areMatchesEqual(a: FuriousSearchMatch|undefined, b: FuriousSearchMatch|undefined) {
    if (a === b || (!a && !b)) {
        return true;
    }

    if (!a) {
        return !b?.length;
    }

    if (!b) {
        return !a?.length;
    }

    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i]?.[0] !== b[i]?.[0] || a[i]?.[1] !== b[i]?.[1]) {
            return false;
        }
    }

    return true;
}

const MAX_STOPS_IN_LIST = 7; // chosen arbitrarily sunglasses emoji

interface RelevantStopsListProps {
    relevant_stops: [string, string][];
    isRemoved: boolean;
    stopNameMatches?: FuriousSearchMatch[];
    stopCodeMatches?: FuriousSearchMatch[];
}

export const RelevantStopsList = React.memo(
    (
        {
            relevant_stops,
            isRemoved,
            stopNameMatches,
            stopCodeMatches
        }: RelevantStopsListProps
    ) => {
        const shownStops = [];
        let hiddenStopCount = 0;

        for (let i = 0; i < relevant_stops.length; i++) {
            const stop = relevant_stops[i];
            if (!stop) continue;

            const nameMatches = stopNameMatches?.[i];
            const codeMatches = stopCodeMatches?.[i];

            if (i < MAX_STOPS_IN_LIST || nameMatches?.length || codeMatches?.length) {
                shownStops.push({stop, nameMatches, codeMatches});
            } else {
                hiddenStopCount += 1;
            }
        }

        return (relevant_stops.length > 0)
            ? <>
                <h2>{isRemoved ? REMOVED_STOPS_LABEL : ADDED_STOPS_LABEL}</h2>
                <ul className="relevant-stops">
                    {shownStops.map(
                        ({stop: [stop_code, stop_name], nameMatches, codeMatches}) => 
                            <li key={stop_code}>
                                    <MatchedString s={stop_code} matches={codeMatches} />
                                    &nbsp;-&nbsp;
                                    <MatchedString s={stop_name} matches={nameMatches} />
                            </li>
                    )}
                    {
                        !hiddenStopCount ? null
                            : <li className="hidden-count">
                                {hiddenStopCount === 1
                                    ? `(ועוד תחנה 1 נוספת...)`
                                    : `(ועוד ${hiddenStopCount} תחנות נוספות...)`
                                }
                            </li>
                    }
                </ul>
            </>
            : null
    },
    (oldProps, newProps) => {
        if (oldProps.isRemoved !== newProps.isRemoved) {
            return false;
        }

        if (oldProps.relevant_stops !== newProps.relevant_stops) {
            return false;
        }

        if (!areMatchListsEqual(oldProps.stopCodeMatches, newProps.stopCodeMatches)) {
            return false;
        }

        if (!areMatchListsEqual(oldProps.stopNameMatches, newProps.stopNameMatches)) {
            return false;
        }

        return true;
    }
);

interface MatchedStringProps {
    s: string;
    matches?: FuriousSearchMatch;
}

export const MatchedString = React.memo(
    ({s, matches}: MatchedStringProps) => {
        if (!matches) {
            return <>{s}</>;
        }

        const segments:  (JSX.Element | string)[]  = [];
        const segIsMtch: boolean[] = [];
        let lastIndex = -1;

        for (const [matchStart, matchEnd] of matches) {
            if (lastIndex + 1 < matchStart) {
                segments.push(s.substring(lastIndex + 1, matchStart));
                segIsMtch.push(false);
            }

            segments.push(
                <span className="search-match" key={segIsMtch.length}>
                    {s.substring(matchStart, matchEnd + 1)}
                </span>
            );
            segIsMtch.push(true);

            lastIndex = matchEnd;
        }

        if (lastIndex + 1 < s.length) {
            segments.push(s.substring(lastIndex + 1));
            segIsMtch.push(false);
        }

        return <>{segments}</>;

        // return <>{segments.map(
        //     (seg, idx) =>
        //         segIsMtch[idx]
        //             ? <span className="search-match" key={idx}>{seg}</span>
        //             : seg
        // )}</>;
    },
    (oldProps, newProps) => {
        return oldProps.s === newProps.s && areMatchesEqual(oldProps.matches, newProps.matches);
    }
);

export interface AlertSummaryProps {
    alert: ServiceAlert;
    matches?: FuriousSearchMatch[][]|null;
    showDistance: boolean;
}

//for debugging stuff ugh
// const USE_CASES = [null, "NATIONAL", "AGENCY", "REGION", "CITIES", "STOPS_CANCELLED", "ROUTE_CHANGES_FLEX", "ROUTE_CHANGES_SIMPLE", "SCHEDULE_CHANGES"];

export function AlertSummary({
    alert,
    matches,
    showDistance
}: AlertSummaryProps) {
    const {
        id,
        header,
        relevant_agencies,
        relevant_lines,
        added_stops,
        removed_stops,
        first_relevant_date,
        first_start_time,
        last_end_time,
        is_deleted,
        is_expired,
        distance
        // use_case
    } = alert;

    // const _first_relevant_date = isoToLocal(first_relevant_date);
    // const _first_start_time    = isoToLocal(first_start_time);
    const _last_end_time       = isoToLocal(last_end_time);

    const location = useLocation();

    return <div className="alert-summary-wrapper"><div className="alert-summary">
        {/* <p>{"use case: " + USE_CASES_REVERSE[alert.use_case]}</p> */}
        {/* {fuseResult ? <div>search score: {fuseResult.score}</div> : null} */}
        <RelevanceTag is_deleted={is_deleted} is_expired={is_expired} first_start_time={first_start_time} first_relevant_date={first_relevant_date} />
        {showDistance && distance !== undefined
            ? <DistanceTag distance={distance}/>
            : null}
        {_last_end_time
            ? <span className="last-end-time">
                {RELEVANT_UNTIL + " " + short_datetime_hebrew(_last_end_time)}
            </span>
            : null}
        <h1><MatchedString s={header?.he ??""} matches={matches?.[ALERT_SEARCH_KEY_INDICES.HEADER_HE]?.[0]} /></h1>
        <RelevantLinesOrAgencies relevant_agencies={relevant_agencies}
                                 relevant_lines={relevant_lines}
                                 agencyNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.AGENCY_NAME]}
                                 lineNumberMatches={matches?.[ALERT_SEARCH_KEY_INDICES.LINE_NUMBER]}/>
        <RelevantStopsList relevant_stops={removed_stops}
                           isRemoved={true}
                           stopNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.REMOVED_STOP_NAME]}
                           stopCodeMatches={matches?.[ALERT_SEARCH_KEY_INDICES.REMOVED_STOP_CODE]} />
        <RelevantStopsList relevant_stops={added_stops}
                           isRemoved={false}
                           stopNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.ADDED_STOP_NAME]}
                           stopCodeMatches={matches?.[ALERT_SEARCH_KEY_INDICES.ADDED_STOP_CODE]}  />
        <Link className={"more-details" + (matches?.[ALERT_SEARCH_KEY_INDICES.DESCRIPTION_HE]?.[0]?.length ? " search-match" : "")}
              to={`/alert/${id}`}
              state={{backgroundLocation: location, alert: alert, showDistance: showDistance, matches: matches}}>
            {MORE_DETAILS_STRING}
        </Link>
    </div></div>;
}