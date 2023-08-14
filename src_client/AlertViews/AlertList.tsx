import * as React from "react";
import { Virtuoso, ItemContent, VirtuosoHandle } from "react-virtuoso";
import { FurrySearchResult } from "furry-text-search";
import { AlertSummary } from "./AlertSummary";
import { ServiceAlert } from "../protocol";

// oy vey ios AND mac safari as of 2022-01-22 don't support this!!!! aaaaaAAAAaaAAaAAAAA
import * as smoothscroll from 'smoothscroll-polyfill'; 
import { breakoutSearchableListItem } from "../LineViews/LineList";
import { AlertSummarySkeleton } from "../RandomComponents/Skeletons";
import { AlertListLoadingStatus } from "./AlertListPage";
import { ServerErrorMessage } from "../RandomComponents/ServerErrorMessage";
smoothscroll.polyfill();

export type ServiceAlertOrSearchResult = ServiceAlert | FurrySearchResult<ServiceAlert>;

interface AlertListProps {
    alerts: ServiceAlertOrSearchResult[];
    showDistance: boolean;
    noAlertsToday?: boolean;
    loadingStatus: AlertListLoadingStatus;
}

export default function AlertList({
    alerts,
    showDistance,
    noAlertsToday,
    loadingStatus
}: AlertListProps) {
    const isLoading = loadingStatus === AlertListLoadingStatus.Loading;
    const isError = loadingStatus === AlertListLoadingStatus.ServerError;

    const rowRenderer = React.useCallback<ItemContent<ServiceAlertOrSearchResult>>(
        (index) => {
            if (isLoading) {
                return <AlertSummarySkeleton />;
            }

            const searchResultOrAlert = alerts[index];
            if (!noAlertsToday && searchResultOrAlert) {
                const [alert, searchResult] = breakoutSearchableListItem(searchResultOrAlert);
                
                return <AlertSummary alert={alert}
                                    matches={searchResult?.matches}
                                    showDistance={showDistance} />
            } else if (noAlertsToday && index === 0) {
                return <div className="no-alerts-today">
                    <span>אין התראות היום</span>
                    <span className="snarky-comment">(או שיש באג באתר? לכו תדעו 🙃)</span>
                </div>;
            } else if (isError && index === 0) {
                return <div className="no-alerts-today">
                    <ServerErrorMessage />
                </div>
            } else if (
                (noAlertsToday && index === 1)
                || (!noAlertsToday && index >= alerts.length)
                || (isError && index === 1)
            ) {
                return <div className="list-end-gizmo"></div>;
            }
        },
        [alerts, noAlertsToday, showDistance, isLoading]
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
        : (noAlertsToday || isError)
        ? 2
        : (alerts.length && (alerts.length + 1));

    return <div className="alert-list-view">
        <Virtuoso<ServiceAlertOrSearchResult> 
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