// import Fuse from "../Fuse/src";
import * as React from "react";
import { FurryIndex } from "furry-text-search";
import AlertList, { ServiceAlertOrSearchResult } from "./AlertList";
import { AlertsResponse, ServiceAlert } from "../protocol";
import GeolocationButton from "../RandomComponents/GeolocationButton";
import { ALERT_SEARCH_KEYS, SEARCH_THRESHOLD, ALERT_SORT_COMPARE_FUNC } from "../search_worker_data";
import { TopTabItem, TopTabs } from "../RandomComponents/TopTabs";

export enum AlertListLoadingStatus {
    Loading,
    Loaded,
    ServerError
}

interface ServiceAlertsMainScreenProps {
    hasModal: boolean;
};

export default function AlertListPage({hasModal}: ServiceAlertsMainScreenProps) {
    const [loadingStatus, setLoadingStatus] = React.useState<AlertListLoadingStatus>(AlertListLoadingStatus.Loading);
    const [data, setData] = React.useState<AlertsResponse|null>(null);
    const [showDistance, setShowDistance] = React.useState<boolean>(false);
    const [currentLocation, setCurrentLocation] = React.useState<[number, number]|null>(null);
    const [searchString, setSearchString] = React.useState<string|null>(null);
    const [currentlyDisplayedData, setCurrentlyDisplayedData] = React.useState<ServiceAlertOrSearchResult[]>([]);

    // const searchWorker = React.useRef<Worker>(null);
    const searchIndex = React.useRef<FurryIndex<ServiceAlert>|null>(null);
    const searchInput = React.useRef<HTMLInputElement|null>(null);
    const currentRefresh = React.useRef<number>(0); // to make sure we only display the freshest data
    const currentSearch  = React.useRef<number>(0); // ...and searches!

    // did you know? ~50% of ios users', and =100% of firefox users' browsers don't support
    // module web workers as of 2022-01-20! what a time we live in! and since i'm not in the
    // mood for transpiling this right now (and setTimeout(0) works ok) then you get to stare
    // at this fossilized worker code and weep with me!

    // if (!searchWorker.current) {
        // searchWorker.current = new Worker('/search_worker.ts', {type: 'module'}); // will vite handle this?
    // }

    // searchWorker.current.onmessage = React.useCallback(
    //     e => {
    //         const data = e.data as SearchWorkerResponse;

    //         if (data.id === currentSearch.current) {
    //             setCurrentlyDisplayedData(data.results);
    //         }
    //     },
    //     [currentSearch, setCurrentlyDisplayedData]
    // );

    React.useEffect(
        () => {
            const id = ++currentRefresh.current;
            ++currentSearch.current;

            if (loadingStatus !== AlertListLoadingStatus.Loading) {
                setLoadingStatus(AlertListLoadingStatus.Loading);
            }

            const currentLocationStr = currentLocation
                ? currentLocation[0].toFixed(6) + '_' + currentLocation[1].toFixed(6)
                : null;
            
            const currentLocationParam = currentLocationStr
                ? "current_location=" + encodeURIComponent(currentLocationStr)
                : null;

            const fetchOptions = currentLocationParam
                ? {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: currentLocationParam
                }
                : { method: "GET" };

            (async () => {
                const response = await fetch(
                    '/api/all_alerts',
                    fetchOptions
                );
                // await new Promise(resolve => setTimeout(resolve, 10000));
                const data = (await response.json()) as AlertsResponse;
                if (currentRefresh.current !== id) {
                    console.info('ignoring request #' + id + ' (waiting for #' + currentRefresh.current + ')');
                    return;
                }

                // searchWorker.current.postMessage({
                //     msg: "newdata",
                //     alerts: data?.alerts
                // });
                searchIndex.current = new FurryIndex<ServiceAlert>(data.alerts ?? [], ALERT_SEARCH_KEYS, ALERT_SORT_COMPARE_FUNC);
                setData(data);
                setLoadingStatus(AlertListLoadingStatus.Loaded);
                setShowDistance(!!currentLocationStr);
            })().catch(() => {
                setLoadingStatus(AlertListLoadingStatus.ServerError);
            });
        },
        [currentLocation]
    );

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

    const onSearchInputChanged = React.useCallback(
        () => {
            setSearchString(searchInput.current?.value ?? null);
        },
        []
    );

    React.useEffect(
        () => {
            const id = ++currentSearch.current;

            if (!data?.alerts?.length && currentlyDisplayedData?.length) {
                setCurrentlyDisplayedData([]);
                return;
            }

            let searchStringSep: string[];

            if (
                !searchString
                || (searchStringSep = searchString.split(/\s+/).filter(s => !!s))?.length === 0
            ) {
                setCurrentlyDisplayedData(data?.alerts || []);
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
    )

    const showFilterNotice = currentlyDisplayedData !== data?.alerts && searchString;
    const noAlertsToday = !data?.alerts?.length && loadingStatus === AlertListLoadingStatus.Loaded;

    return <>
        <div className={"search-bar-container" + (hasModal ? " hidden" : "")}>
            <div className="search-bar">
                <TopTabs selectedItem={TopTabItem.Alerts} />
                <GeolocationButton onNewLocation={onNewLocation}/>
                <input
                    type="text"
                    id="search-input"
                    placeholder="חיפוש לפי טקסט חופשי"
                    ref={searchInput}
                    onInput={onSearchInputChanged}
                />
                <div className="bottom-links">
                    <span className="credit">מתוכנת כשירות לציבור מאת <a href="https://ish.works/" target="_blank">איש.וורקס</a></span>
                    <span className="privacy"><a href="/legal.html" target="_blank">משפטים ופרטיות</a></span>
                </div>
            </div>
        </div>
        <div className={"filter-notice" + ((showFilterNotice && !hasModal) ? " shown" : " hidden")}>
            <span className="filter-notice-content">מתאימות לחיפוש: {currentlyDisplayedData.length} התראות מתוך {data?.alerts?.length ?? 0}</span>
        </div>
        <hr className={(hasModal ? "hidden" : "")} />
        <div className={"alerts-list-container" + (hasModal ? " hidden" : "")}>
                <AlertList
                    alerts={currentlyDisplayedData}
                    showDistance={showDistance}
                    noAlertsToday={noAlertsToday}
                    loadingStatus={loadingStatus}
                />
                {/* <LoadingOverlay shown={isLoading} /> */}
        </div>
    </>;
}

export interface LoadingOverlayProps {
    shown: boolean;
    textOverride?: string;
}

export const LoadingOverlay = React.memo(({shown, textOverride}: LoadingOverlayProps) =>
    <div className={"loading-overlay " + (shown ? "shown" : "hidden")}>
        <div className="loading-indicator"></div>
        <span className="loading-text">{textOverride || "בטעינה..."}</span>
    </div>
);