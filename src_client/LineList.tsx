import * as React from "react";
import { Virtuoso, ItemContent, VirtuosoHandle } from "react-virtuoso";
import { FuriousSearchMatch, FuriousSearchResult, isFuriousSearchResult } from "../FuriousSearch/furiousindex";
// import { AlertSummary } from "./AlertSummary";
import { ActualLine, Agency, isServiceAlert, JsDict, LinesListResponse, ServiceAlert } from "./data";

// oy vey ios AND mac safari as of 2022-01-22 don't support this!!!! aaaaaAAAAaaAAaAAAAA
import * as smoothscroll from 'smoothscroll-polyfill'; 
import { AgencyTag } from "./AgencyTag";
import { ServerResponseContext } from "./LineListPage";
import { MatchedString } from "./AlertSummary";
import { DateTime } from "luxon";
import { isoToLocal, JERUSALEM_TZ } from "./date_utils";
import hazardImg from './assets/hazard.svg';
smoothscroll.polyfill();

export type LineListItem = ActualLine | FuriousSearchResult<ActualLine>;
export function breakoutLineListItem(l: LineListItem): [ActualLine, FuriousSearchResult<ActualLine>?] {
    return isFuriousSearchResult<ActualLine>(l)
        ? [l.obj, l]
        : [l, null];
}

interface LineListProps {
    lines: LineListItem[];
    showDistance: boolean;
    noAlertsToday?: boolean;
}

export default function LineList({lines, showDistance, noAlertsToday}: LineListProps) {
    const rowRenderer = React.useCallback<ItemContent<LineListItem>>(
        (index) => {
            if (!noAlertsToday && index < lines.length) {
                const [line, searchResult] = breakoutLineListItem(lines[index]);
                
                return <LineSummary line={line}
                                    matches={searchResult?.matches} />
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
        [lines, noAlertsToday, showDistance]
    );

    const virtuoso = React.useRef<VirtuosoHandle>(null);
    const scrollerRef = React.useRef<HTMLElement>(null);
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

    const totalCount = noAlertsToday
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
}

function LineSummary({line, matches}: LineSummaryProps) {
    // TODO show distance? if (serverResponse.uses_location)
    const serverResponse = React.useContext(ServerResponseContext);

    return <div className="alert-summary-wrapper"><div className="line-summary">
        <AlertCountTag num_alerts={line.num_alerts || 0} first_relevant_date={line.first_relevant_date} />
        <AgencyTag agency_id={line.agency_id} agency_name={null} />
        <div className="destinations">
            <div className={"line-number line-number-big operator-" + line.agency_id}>
                <MatchedString s={line.route_short_name}
                            matches={matches?.[0]?.[0]} />
            </div>
            <h1><MatchedString s={line.headsign_1} matches={matches?.[1]?.[0]} /></h1>
            {
                !line.headsign_2 ? null : <>
                    <span className="direction-separator">⬍</span>
                    <h1><MatchedString s={line.headsign_2} matches={matches?.[2]?.[0]} /></h1>
                </>
            }

            {(matches?.[3]?.length || matches?.[4]?.length)
                ? <>
                    <ul className="main-cities">
                        {line.main_cities.map(
                            (city, idx) => (
                                <li><MatchedString s={city} matches={matches?.[3]?.[idx]} /></li>
                            )
                        )}
                    </ul>
                    {
                        !line.secondary_cities?.length ? null
                            : <ul className="secondary-cities">
                                {line.secondary_cities.map(
                                    (city, idx) => (
                                        <li><MatchedString s={city} matches={matches?.[4]?.[idx]} /></li>
                                    )
                                )}
                            </ul>
            
                    }
                </>
                : null
            }
            
        </div>
        {/* {
            !line.alert_titles?.length ? null : <>
                <h2>התראות:</h2>
                <ul className="active-alerts">
                    {line.alert_titles.map(header => (<li>{header.he}</li>))}
                </ul>
            </>
        } */}
        {/* {
            !line.removed_stops?.length ? null : <>
                <h2>תחנות מבוטלות:</h2>
                <ul className="relevant-stops">
                    {line.removed_stops.map(([stopCode, stopName]) => <li>
                        {stopCode} - {stopName}
                    </li>)}
                </ul>
            </>
        }
        {
            !line.added_stops?.length ? null : <>
                <h2>תחנות חדשות:</h2>
                <ul className="relevant-stops">
                    {line.added_stops.map(([stopCode, stopName]) => <li>
                        {stopCode} - {stopName}
                    </li>)}
                </ul>
            </>
        } */}
    </div></div>;
}

interface AlertCountProps {
    num_alerts: number;
    first_relevant_date: string;
}

function AlertCountTag({num_alerts, first_relevant_date}: AlertCountProps) {
    let text = "";
    let is_for_today = 'future';

    if (!num_alerts) {
        text = "ללא התראות";
    } else {
        const today_in_jerus = DateTime.now().setZone(JERUSALEM_TZ).set({
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0
        });

        const _first_relevant_date = isoToLocal(first_relevant_date);

        if (_first_relevant_date.toMillis() === today_in_jerus.toMillis()) {
            is_for_today = 'today';
        }
        
        if (num_alerts === 1) {
            text = "התראה אחת";
        } else {
            text = num_alerts + " התראות";
        }
    }

    return <span className={"alert-count-tag alert-count-tag-" + (!num_alerts ? 'none' : is_for_today)}>
        {!num_alerts ? null : <img height="15" src={hazardImg} />}
        <span>{text}</span>
    </span>;
}