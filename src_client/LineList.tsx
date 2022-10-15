import * as React from "react";
import { Virtuoso, ItemContent, VirtuosoHandle } from "react-virtuoso";
import { FuriousSearchMatch, FuriousSearchResult, isFuriousSearchResult } from "../FuriousSearch/furiousindex";
// import { AlertSummary } from "./AlertSummary";
import { ActualLine, Agency, isServiceAlert, JsDict, LinesListResponse, ServiceAlert } from "./data";

// oy vey ios AND mac safari as of 2022-01-22 don't support this!!!! aaaaaAAAAaaAAaAAAAA
import * as smoothscroll from 'smoothscroll-polyfill'; 
import { AgencyTag } from "./AgencyTag";
import { ServerResponseContext } from "./LinesListPage";
import { MatchedString } from "./AlertSummary";
smoothscroll.polyfill();

export type LineListItem = ActualLine | FuriousSearchResult<ActualLine>;

interface LineListProps {
    lines: LineListItem[];
    showDistance: boolean;
    noAlertsToday?: boolean;
}

export default function LineList({lines, showDistance, noAlertsToday}: LineListProps) {
    const rowRenderer = React.useCallback<ItemContent<LineListItem>>(
        (index) => {
            if (!noAlertsToday && index < lines.length) {
                const searchResultOrLine = lines[index];
                const [line, searchResult] = isFuriousSearchResult<ActualLine>(searchResultOrLine)
                    ? [searchResultOrLine.obj, searchResultOrLine]
                    : [searchResultOrLine, null];
                
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
    matches: FuriousSearchMatch[][]; // TODO ugh
}

function LineSummary({line, matches}: LineSummaryProps) {
    // TODO show distance? if (serverResponse.uses_location)
    const serverResponse = React.useContext(ServerResponseContext);

    return <div className="alert-summary-wrapper"><div className="line-summary">
        <AgencyTag agency_id={line.agency_id} agency_name={serverResponse?.all_agencies?.[line.agency_id]?.agency_name} />
        <div className={"line-number operator-" + line.agency_id}>
            <MatchedString s={line.route_short_name}
                           matches={matches?.[0]?.[0]} />
        </div>
        <h1><MatchedString s={line.headsign_1} matches={matches?.[1]?.[0]} /></h1>
        {
            !line.headsign_2 ? null : <>
                {/* TODO: add some arrows or sth */}
                <h1><MatchedString s={line.headsign_2} matches={matches?.[2]?.[0]} /></h1>
            </>
        }
        <p>Currently has {line.num_alerts || 0} alerts</p>
    </div></div>;
}