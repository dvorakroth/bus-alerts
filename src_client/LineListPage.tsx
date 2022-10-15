import * as React from 'react';
import { FuriousIndex } from '../FuriousSearch/furiousindex';
import AlertsList from './AlertsList';
import { ActualLine, LinesListResponse } from './data';
import LineList, { breakoutLineListItem, LineListItem } from './LineList';
import { LINE_SEARCH_KEYS, SEARCH_THRESHOLD, ALERT_SORT_COMPARE_FUNC, DEFAULT_SORT_COMPARE_FUNC } from './search_worker_data';
import { LoadingOverlay } from './ServiceAlertsMainScreen';

export const ServerResponseContext = React.createContext<LinesListResponse>(null);

interface Props {
    hasModal: boolean;
}

export default function LineListPage({hasModal}: Props) {
    const [isLoading, setIsLoading] = React.useState<boolean>(true);
    const [data, setData] = React.useState<LinesListResponse>(null);
    const [showDistance, setShowDistance] = React.useState<boolean>(false);
    const [currentLocation, setCurrentLocation] = React.useState<[number, number]>(null);
    const [searchString, setSearchString] = React.useState<string>(null);
    const [currentlyDisplayedData, setCurrentlyDisplayedData] = React.useState<LineListItem[]>([]);

    const searchIndex = React.useRef<FuriousIndex<ActualLine>>(null);
    const searchInput = React.useRef(null);
    const currentRefresh = React.useRef<number>(0); // to make sure we only display the freshest data
    const currentSearch  = React.useRef<number>(0); // ...and searches!


    React.useEffect(
        () => {
            const id = ++currentRefresh.current;
            ++currentSearch.current;

            if (!isLoading) {
                setIsLoading(true);
            }

            const currentLocationStr = currentLocation
                ? currentLocation[0].toFixed(6) + '_' + currentLocation[1].toFixed(6)
                : "";

            fetch(
                '/api/all_lines?current_location=' + encodeURIComponent(currentLocationStr)
            ).then(response => response.json()).then((data: LinesListResponse) => {
                if (currentRefresh.current !== id) {
                    console.info('ignoring request #' + id + ' (waiting for #' + currentRefresh.current + ')');
                    return;
                }

                // searchWorker.current.postMessage({
                //     msg: "newdata",
                //     alerts: data?.alerts
                // });
                searchIndex.current = new FuriousIndex<ActualLine>(data.all_lines, LINE_SEARCH_KEYS, DEFAULT_SORT_COMPARE_FUNC);
                setData(data);
                setIsLoading(false);
                setShowDistance(!!currentLocationStr);
            });
        },
        [currentLocation]
    );

    React.useEffect(
        () => {
            const id = ++currentSearch.current;

            if (!data?.lines_with_alert?.length && currentlyDisplayedData?.length) {
                setCurrentlyDisplayedData([]);
                return;
            }

            let searchStringSep: string[];

            if (
                !searchString
                || (searchStringSep = searchString.split(/\s+/).filter(s => !!s))?.length === 0
            ) {
                setCurrentlyDisplayedData(data?.lines_with_alert || []);
                return;
            }

            // this could have been so elegeant with a webworker.....,,,.,.,.,.,

            // searchWorker.current.postMessage({
            //     msg: "dosearch",
            //     queries: searchStringSep,
            //     id
            // });
            setTimeout(
                () => {
                    if (searchIndex.current) {
                        const results = searchIndex.current.search(searchStringSep, SEARCH_THRESHOLD, false);

                        if (id === currentSearch.current) {
                            setCurrentlyDisplayedData(results);
                        } else {
                            console.warn(`ignoring search ${id} (waiting for ${currentSearch.current})`)
                        }
                    }
                },
                0
            );
        },
        [data, searchString]
    );

    const onSearchInputChanged = React.useCallback(
        () => {
            setSearchString(searchInput.current.value);
        },
        []
    );
    
    const showFilterNotice = currentlyDisplayedData !== data?.lines_with_alert && searchString;
    const numFilteredWithAlerts = showFilterNotice && !hasModal
        ? currentlyDisplayedData.reduce(
            (sum, lineOrSearchResult) => (
                sum + Math.min(1, breakoutLineListItem(lineOrSearchResult)[0].num_alerts)
            ),
            0
        )
        : null;
    const noAlertsToday = !data?.lines_with_alert.length && !isLoading;

    return <ServerResponseContext.Provider value={data}>
        <div className={"search-bar-container" + (hasModal ? " hidden" : "")}>
            <div className="search-bar">
                {/* <GeolocationButton onNewLocation={onNewLocation}/> */}
                <input
                    type="text"
                    id="search-input"
                    placeholder="חיפוש לפי טקסט חופשי"
                    ref={searchInput}
                    onInput={onSearchInputChanged}
                />
                <span className="credit">מתוכנת כשירות לציבור מאת <a href="https://ish.works/" target="_blank">איש.וורקס</a></span>
                {
                // <div className="search-date-part">
                //     <label className="search-date-label">
                //         <input type="checkbox"/>
                //         הגבלה לתאריך ספציפי:
                //     </label>
                //     <input type="date"/>
                // </div>
            }
            </div>
        </div>
        {showFilterNotice && !hasModal
            ? <div className={"filter-notice" + ((showFilterNotice && !hasModal) ? " shown" : " hidden")}>
                <span>קווים מתאימים לחיפוש: {currentlyDisplayedData.length}, מתוכם בעלי התראות: {numFilteredWithAlerts}</span> { /* TODO phrasing? numbers? idk */ }
            </div>
            : null
        }
        
        <hr className={(hasModal ? "hidden" : "")} />
        <div className={"alerts-list-container" + (hasModal ? " hidden" : "")}>
                <LineList
                    lines={currentlyDisplayedData}
                    showDistance={showDistance}
                    noAlertsToday={noAlertsToday}
                />
                <LoadingOverlay shown={isLoading} />
        </div>
    </ServerResponseContext.Provider>;

}