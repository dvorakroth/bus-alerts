import * as React from "react";
import * as ReactRouterDOM from "react-router-dom"; 

import { Virtuoso, ItemContent, VirtuosoHandle } from "react-virtuoso";
import { FuriousSearchMatch, FuriousSearchResult, isFuriousSearchResult } from "../../FuriousSearch/furiousindex";
import { ActualLine } from "../protocol";

// oy vey ios AND mac safari as of 2022-01-22 don't support this!!!! aaaaaAAAAaaAAaAAAAA
import * as smoothscroll from 'smoothscroll-polyfill'; 
import { AgencyTag } from "../RandomComponents/AgencyTag";
import { LineListResponseContext } from "./LineListPage";
import { MatchedString } from "../AlertViews/AlertSummary";
import hazardImg from '../assets/hazard.svg';
import cancelledstop from '../assets/cancelledstop.svg';
import checkmarkImg from '../assets/checkmark.svg';
import { DistanceTag } from "../RandomComponents/DistanceTag";
import { LineSummarySkeleton } from "../RandomComponents/Skeletons";
import clsx from "clsx";
import { JERUSALEM_TZ, short_date_hebrew, short_time_hebrew } from "../junkyard/date_utils";
import { DateTime } from "luxon";
smoothscroll.polyfill();

export type LineListItem = ActualLine | FuriousSearchResult<ActualLine>;
export function breakoutSearchableListItem<T>(l: T | FuriousSearchResult<T>): [T, FuriousSearchResult<T>|null] {
    return isFuriousSearchResult<T>(l)
        ? [l.obj, l]
        : [l, null];
}

interface LineListProps {
    lines: LineListItem[];
    showDistance: boolean;
    noAlertsToday?: boolean;
    isLoading: boolean;
}

export default function LineList({
    lines,
    showDistance,
    noAlertsToday,
    isLoading
}: LineListProps) {
    const rowRenderer = React.useCallback<ItemContent<LineListItem>>(
        (index) => {
            if (isLoading) {
                return <LineSummarySkeleton />;
            }

            const searchResultOrLine = lines[index];
            if (!noAlertsToday && searchResultOrLine) {
                const [line, searchResult] = breakoutSearchableListItem(searchResultOrLine);
                
                return <LineSummary line={line}
                                    matches={searchResult?.matches ?? []}
                                    showDistance={showDistance} />
            } else if (noAlertsToday && index == 0) {
                return <div className="no-alerts-today">
                    <span>אין התראות היום</span>
                    <span className="snarky-comment">(או שיש באג באתר? לכו תדעו 🙃)</span>
                </div>;
            } else if (
                (noAlertsToday && index == 1) || (!noAlertsToday && index >= lines.length)
            ) {
                return <div className="list-end-gizmo"></div>;
            }
        },
        [lines, noAlertsToday, showDistance, isLoading]
    );

    const virtuoso = React.useRef<VirtuosoHandle|null>(null);
    const scrollerRef = React.useRef<HTMLElement|null>(null);
    const [isAtTop, setIsAtTop] = React.useState<boolean>(true);
    const atTopStateChange = React.useCallback(
        (atTop) => {
            setIsAtTop(atTop);
        },
        [setIsAtTop]
    );

    const scrollToTop = React.useCallback(
        () => {
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            if (scrollerRef.current) { // great hack!!!! love it!!!!! fml!!!!!!!
                scrollerRef.current.style.overflowY = 'hidden';
            }
            setTimeout(
                () => {
                    if (scrollerRef.current) { // (btw it's to stop scroll momentum)
                        scrollerRef.current.style.overflowY = 'auto';
                    }
                    virtuoso.current?.scrollTo({
                        top: 0,
                        behavior: reduceMotion ? 'auto' : 'smooth'
                    });
                    
                },
                10
            )
            
        },
        [virtuoso, scrollerRef]
    );

    const totalCount = isLoading
        ? 4
        : noAlertsToday
        ? 2
        : (lines.length && (lines.length + 1));

    return <div className="alert-list-view">
        <Virtuoso<LineListItem> 
            totalCount={totalCount}
            itemContent={rowRenderer}
            ref={virtuoso}
            atTopStateChange={atTopStateChange}
            scrollerRef={(ref) => scrollerRef.current=ref as any}
            overscan={3}
            />
        <button className={"scroll-to-top" + (isAtTop ? " hidden" : "")}
                onClick={scrollToTop}
                aria-label="חזרה לראש הרשימה">
        </button>
    </div>;
}

interface LineSummaryProps {
    line: ActualLine;
    matches: FuriousSearchMatch[][];
    showDistance: boolean;
}

function LineSummary({line, matches, showDistance}: LineSummaryProps) {
    const serverResponse = React.useContext(LineListResponseContext);

    const location = ReactRouterDOM.useLocation();
    const navigate = ReactRouterDOM.useNavigate();

    const lineUrl = `/line/${line.pk}`;
    const clickHandler = React.useCallback(
        (event: React.MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();

            navigate(lineUrl, {
                state: {
                    backgroundLocation: location,
                    line,
                    showDistance
                }
            });
        }, [navigate, lineUrl, location, line, showDistance]
    );

    if (!serverResponse) return <></>; // ??

    const firstRelevantTimestamp = line.first_relevant_timestamp
        ? DateTime.fromISO(line.first_relevant_timestamp).setZone(JERUSALEM_TZ)
        : null;

    return <div className="alert-summary-wrapper"><div className="line-summary" onClick={clickHandler}>
        {/* {line.num_relevant_right_now
            ? <div className="relevant-tag relevant-tag-today">התראות פעילות כרגע!</div>
            : line.num_relevant_today
            ? <div className="relevant-tag relevant-tag-tomorrow">התראות להיום!</div>
            : null
        } */}
        {line.distance === undefined ? null
            : <DistanceTag distance={line.distance} />
        }
        {/* <AlertCountTag num_alerts={line.num_alerts || 0} first_relevant_date={line.first_relevant_date} /> */}
        <AgencyTag
            agency_id={line.agency_id}
            agency_name={serverResponse.all_agencies[line.agency_id]?.agency_name ?? ""}
            hideName={!matches?.[5]?.[0]}
            is_night_line={line.is_night_line}
            matches={matches?.[5]?.[0]}
        />
        <div className="destinations">
            <div className={"line-number line-number-verybig operator-" + line.agency_id}>
                <MatchedString s={line.route_short_name}
                            matches={matches?.[0]?.[0]} />
            </div>
            <h1><MatchedString s={line.headsign_1 ?? ""} matches={matches?.[1]?.[0]} /></h1>
            {
                !line.headsign_2 ? null : <>
                    <span className="direction-separator">⬍</span>
                    <h1><MatchedString s={line.headsign_2} matches={matches?.[2]?.[0]} /></h1>
                </>
            }

            {(matches?.[3]?.length || matches?.[4]?.length || (!line.headsign_1?.includes("-") && !line.headsign_2?.includes("-")))
                ? <>
                    <ul className="main-cities">
                        {line.main_cities.map(
                            (city, idx) => (
                                <li key={idx}><MatchedString s={city} matches={matches?.[3]?.[idx]} /></li>
                            )
                        )}
                    </ul>
                    {
                        !line.secondary_cities?.length ? null
                            : <ul className="secondary-cities">
                                {line.secondary_cities.map(
                                    (city, idx) => (
                                        <li key={idx}><MatchedString s={city} matches={matches?.[4]?.[idx]} /></li>
                                    )
                                )}
                            </ul>
            
                    }
                </>
                : null
            }
            
        </div>
        <div className="alert-counters">
            <div className={"alert-count-big alert-count-tag-" + (line.num_alerts ? "tomorrow" : "none")}>
                <span className={clsx("count", {"is-zero": !line.num_alerts})}>
                    {
                        line.num_relevant_right_now
                            ? /*"" + line.num_relevant_right_now + ", " +*/ "כרגע"
                            : line.num_relevant_today
                            ? /*"" + line.num_relevant_today + ", " +*/ "משעה" + " " + short_time_hebrew(firstRelevantTimestamp!)
                            : line.num_alerts
                            ? /*"" + line.num_alerts + ", " +*/ "מיום" + " " + short_date_hebrew(firstRelevantTimestamp!)
                            : "אין התראות"
                    }
                </span>
                <div className="icon-wrapper">
                    {line.num_alerts
                        ? <img src={hazardImg} alt="יש התראות" title="יש התראות" />
                        : <img src={checkmarkImg} aria-hidden={true} />
                    }
                </div>
                {/* <span className="label">התראות</span> */}
            </div>
            {/* <div className={"alert-count-big alert-count-tag-" + (line.num_relevant_today ? "today" : "none")}>
                <span className="count">{line.num_relevant_today || 0}</span>
                <span className="label">להיום</span>
            </div> */}
            {
                !line.num_removed_stops ? null
                    : <div className={"alert-count-big alert-count-tag-today"}>
                        <span className="count">{line.num_removed_stops || 0}</span>
                        <div className="icon-wrapper cancelled">
                            <img src={cancelledstop} alt="תחנות מבוטלות" title="תחנות מבוטלות" />
                        </div>
                        {/* <span className="label">תחנות מבוטלות</span> */}
                    </div>
            }
            
        </div>
        <a href={lineUrl} className="more-details" onClick={clickHandler}>
             {"לחצו לפרטים נוספים >"}
        </a>
    </div></div>;
}

// interface AlertCountProps {
//     num_alerts: number;
//     first_relevant_date: string;
// }

// function AlertCountTag({num_alerts, first_relevant_date}: AlertCountProps) {
//     let text = "";
//     let is_for_today = 'future';

//     if (!num_alerts) {
//         text = "ללא התראות";
//     } else {
//         const today_in_jerus = DateTime.now().setZone(JERUSALEM_TZ).set({
//             hour: 0,
//             minute: 0,
//             second: 0,
//             millisecond: 0
//         });

//         const _first_relevant_date = isoToLocal(first_relevant_date);

//         if (_first_relevant_date.toMillis() === today_in_jerus.toMillis()) {
//             is_for_today = 'today';
//         }
        
//         if (num_alerts === 1) {
//             text = "התראה אחת";
//         } else {
//             text = num_alerts + " התראות";
//         }
//     }

//     return <span className={"alert-count-tag alert-count-tag-" + (!num_alerts ? 'none' : is_for_today)}>
//         {!num_alerts ? null : <img height="15" src={hazardImg} />}
//         <span>{text}</span>
//     </span>;
// }