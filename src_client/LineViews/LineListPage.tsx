import * as React from 'react';
import { FuriousIndex } from '../../FuriousSearch/furiousindex';
import { ActualLine, LinesListResponse } from '../protocol';
import LineList, { breakoutSearchableListItem, LineListItem } from './LineList';
import { LINE_SEARCH_KEYS, SEARCH_THRESHOLD, DEFAULT_SORT_COMPARE_FUNC } from '../search_worker_data';
import { LoadingOverlay } from '../AlertViews/AlertListPage';
import GeolocationButton from '../RandomComponents/GeolocationButton';
import { TopTabItem, TopTabs } from '../RandomComponents/TopTabs';

export const LineListResponseContext = React.createContext<LinesListResponse|null>(null);

interface Props {
    hasModal: boolean;
}

export default function LineListPage({hasModal}: Props) {
    const [isLoading, setIsLoading] = React.useState<boolean>(true);
    const [data, setData] = React.useState<LinesListResponse|null>(null);
    const [showDistance, setShowDistance] = React.useState<boolean>(false);
    const [currentLocation, setCurrentLocation] = React.useState<[number, number]|null>(null);
    const [searchString, setSearchString] = React.useState<string|null>(null);
    const [currentlyDisplayedData, setCurrentlyDisplayedData] = React.useState<LineListItem[]>([]);

    const searchIndex = React.useRef<FuriousIndex<ActualLine>|null>(null);
    const searchInput = React.useRef<HTMLInputElement|null>(null);
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
            ).then(response => response.json())
            // .then(response => {
            //     return new Promise((resolve) => {
            //         setTimeout(() => resolve(response), 10000)
            //     })
            // })
            .then((data: LinesListResponse) => {
                if (currentRefresh.current !== id) {
                    console.info('ignoring request #' + id + ' (waiting for #' + currentRefresh.current + ')');
                    return;
                }

                // module workers are still a shit show in 2022 lmao fml
                // searchWorker.current.postMessage({
                //     msg: "newdata",
                //     alerts: data?.alerts
                // });
                searchIndex.current = new FuriousIndex<ActualLine>(
                    data.all_lines,
                    LINE_SEARCH_KEYS(data.all_agencies),
                    DEFAULT_SORT_COMPARE_FUNC
                );
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

            // i have NO idea what the HELL i was thinking when i wrote this check so i commented it out?????
            // if (!data?.lines_with_alert?.length && currentlyDisplayedData?.length) {
            //     setCurrentlyDisplayedData([]);
            //     return;
            // }

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
            setSearchString(searchInput.current?.value ?? null);
        },
        []
    );
    
    const showFilterNotice = currentlyDisplayedData !== data?.lines_with_alert && searchString;
    const numFilteredWithAlerts = showFilterNotice && !hasModal
        ? currentlyDisplayedData.reduce(
            (sum, lineOrSearchResult) => (
                sum + Math.min(1, breakoutSearchableListItem(lineOrSearchResult)[0].num_alerts)
            ),
            0
        )
        : null;
    const noAlertsToday = !data?.lines_with_alert.length && !isLoading && !showFilterNotice;

    const onNewLocation = React.useCallback(
        (newLocation: GeolocationPosition) => {
            console.log("new location received: ", newLocation);

            let _newLocation: [number, number]|null = null;

            if (newLocation) {
                _newLocation = [newLocation.coords.latitude, newLocation.coords.longitude];
            }

            setCurrentLocation(_newLocation);
        },
        [setCurrentLocation]
    );


    return <LineListResponseContext.Provider value={data}>
        <div className={"search-bar-container" + (hasModal ? " hidden" : "")}>
            <div className="search-bar">
                <TopTabs selectedItem={TopTabItem.Lines} />
                <GeolocationButton onNewLocation={onNewLocation}/>
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
                <span>מתאימים לחיפוש: {currentlyDisplayedData.length} קווים, מתוכם בעלי התראות: {numFilteredWithAlerts}</span> { /* TODO phrasing? numbers? idk */ }
            </div>
            : null
        }
        
        <hr className={(hasModal ? "hidden" : "")} />
        <div className={"alerts-list-container" + (hasModal ? " hidden" : "")}>
                <LineList
                    lines={currentlyDisplayedData}
                    showDistance={showDistance}
                    noAlertsToday={noAlertsToday}
                    isLoading={isLoading}
                />
                {/* <LoadingOverlay shown={isLoading} /> */}
        </div>
    </LineListResponseContext.Provider>;

}