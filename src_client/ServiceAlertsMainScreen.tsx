// import Fuse from "../Fuse/src";
import * as React from "react";
import { FuriousIndex } from "../FuriousSearch/furiousindex";
import AlertsList, { ServiceAlertOrSearchResult } from "./AlertsList";
import { ServerResponse, ServiceAlert } from "./data";
import { SEARCH_KEYS, SEARCH_THRESHOLD, SORT_COMPARE_FUNC } from "./search_worker_data";

const GEOLOCATION_STATUS = {
    OFF: 0,
    DENIED: 1,
    UNAVAILABLE: 2,
    TIMEOUT: 3,
    HAS_LOCATION: 4,
    TRYING: 5
};

const LOCATION_LABEL_PREFIX = "🧭 מיקום: ";

const LOCATION_LABEL_STATUS_TEXT = {
    [GEOLOCATION_STATUS.OFF]: "כבוי",
    [GEOLOCATION_STATUS.DENIED]: "אין הרשאה", // eeeeehhhhhh not sure about having this at all u know?
                                                // cause this isn't very descriptive or even useful to 
                                                // the end user to know????? idk i'll have to test and see
    [GEOLOCATION_STATUS.UNAVAILABLE]: "לא זמין",
    [GEOLOCATION_STATUS.TIMEOUT]: "לא זמין",
    [GEOLOCATION_STATUS.HAS_LOCATION]: "מופעל",
    [GEOLOCATION_STATUS.TRYING]: "..."
};

const LOCATION_LABEL_CLASSES = {
    [GEOLOCATION_STATUS.OFF]: "is-off",
    [GEOLOCATION_STATUS.DENIED]: "is-denied",
    [GEOLOCATION_STATUS.UNAVAILABLE]: "is-unavailable",
    [GEOLOCATION_STATUS.TIMEOUT]: "is-unavailable",
    [GEOLOCATION_STATUS.HAS_LOCATION]: "is-on",
    [GEOLOCATION_STATUS.TRYING]: "is-loading"
};

interface GeolocationButtonProps {
    onNewLocation: (newLocation: GeolocationPosition) => void;
}

interface GeolocationButtonState {
    geolocation_status: number;
}

class GeolocationButton extends React.Component<GeolocationButtonProps, GeolocationButtonState> {
    constructor(props: GeolocationButtonProps) {
        super(props);

        this.state = {
            geolocation_status: GEOLOCATION_STATUS.OFF
        };
    }

    onClick = () => {
        if (!navigator || !navigator.geolocation) {
            return;
        }

        if (this.state.geolocation_status === GEOLOCATION_STATUS.HAS_LOCATION) {
            // if we already have a location, disable it

            this.setState({
                geolocation_status: GEOLOCATION_STATUS.OFF
            });

            if (this.props.onNewLocation) {
                this.props.onNewLocation(null);
            }

            return;
        }

        this.setState({
            geolocation_status: GEOLOCATION_STATUS.TRYING
        });

        navigator.geolocation.getCurrentPosition(
            (position) => {
                // success callback
                this.setState({
                    geolocation_status: GEOLOCATION_STATUS.HAS_LOCATION
                });
                if (this.props.onNewLocation) {
                    this.props.onNewLocation(position);
                }
            },

            (error) => {
                // error callback
                let new_status = GEOLOCATION_STATUS.UNAVAILABLE;

                switch(error.code) {
                    case GeolocationPositionError.PERMISSION_DENIED:
                        new_status = GEOLOCATION_STATUS.DENIED;
                        break;
                    case GeolocationPositionError.TIMEOUT:
                        new_status = GEOLOCATION_STATUS.TIMEOUT;
                        break;
                }

                this.setState({
                    geolocation_status: new_status
                });
                if (this.props.onNewLocation) {
                    this.props.onNewLocation(null);
                }
            },

            {enableHighAccuracy: true}
        );
    }

    render() {
        return <button
                id="search-by-location"
                className={LOCATION_LABEL_CLASSES[this.state.geolocation_status]}
                onClick={this.onClick}
            >
            {LOCATION_LABEL_PREFIX + LOCATION_LABEL_STATUS_TEXT[this.state.geolocation_status]}
        </button>;
    }
}

interface ServiceAlertsMainScreenProps {
    hasModal: boolean;
};

export default function ServiceAlertsMainScreen({hasModal}: ServiceAlertsMainScreenProps) {
    const [isLoading, setIsLoading] = React.useState<boolean>(true);
    const [data, setData] = React.useState<ServerResponse>(null);
    const [showDistance, setShowDistance] = React.useState<boolean>(false);
    const [currentLocation, setCurrentLocation] = React.useState<[number, number]>(null);
    const [searchString, setSearchString] = React.useState<string>(null);
    const [currentlyDisplayedData, setCurrentlyDisplayedData] = React.useState<ServiceAlertOrSearchResult[]>([]);

    // const searchWorker = React.useRef<Worker>(null);
    const searchIndex = React.useRef<FuriousIndex<ServiceAlert>>(null);
    const searchInput = React.useRef<HTMLInputElement>(null);
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

            if (!isLoading) {
                setIsLoading(true);
            }

            const currentLocationStr = currentLocation
                ? currentLocation[0].toFixed(6) + '_' + currentLocation[1].toFixed(6)
                : "";

            fetch(
                '/api/all_alerts?current_location=' + encodeURIComponent(currentLocationStr)
            ).then(response => response.json()).then((data: ServerResponse) => {
                if (currentRefresh.current !== id) {
                    console.info('ignoring request #' + id + ' (waiting for #' + currentRefresh.current + ')');
                    return;
                }

                // searchWorker.current.postMessage({
                //     msg: "newdata",
                //     alerts: data?.alerts
                // });
                searchIndex.current = new FuriousIndex<ServiceAlert>(data.alerts, SEARCH_KEYS, SORT_COMPARE_FUNC);
                setData(data);
                setIsLoading(false);
                setShowDistance(!!currentLocationStr);
            });
        },
        [currentLocation]
    );

    const onNewLocation = React.useCallback(
        (newLocation: GeolocationPosition) => {
            console.log("new location received: ", newLocation);

            let _newLocation: [number, number] = null;

            if (newLocation) {
                _newLocation = [newLocation.coords.latitude, newLocation.coords.longitude];
            }

            setCurrentLocation(_newLocation);
        },
        [setCurrentLocation]
    );

    const onSearchInputChanged = React.useCallback(
        () => {
            setSearchString(searchInput.current.value);
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
    const noAlertsToday = !data?.alerts.length && !isLoading;

    return <>
        <div className={"search-bar" + (hasModal ? " hidden" : "")}>
            <GeolocationButton onNewLocation={onNewLocation}/>
            <input
                type="text"
                id="search-input"
                placeholder="חיפוש לפי קו, תחנה, ו/או מפעילה"
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
        <div className={"filter-notice" + ((showFilterNotice && !hasModal) ? " shown" : " hidden")}>
            <span>מתאימות לחיפוש: {currentlyDisplayedData.length} התראות מתוך {data?.alerts.length}</span>
        </div>
        <hr className={(hasModal ? "hidden" : "")} />
        <div className={"alerts-list-container" + (hasModal ? " hidden" : "")}>
                <AlertsList
                    alerts={currentlyDisplayedData}
                    showDistance={showDistance}
                    noAlertsToday={noAlertsToday}
                />
                <LoadingOverlay shown={isLoading} />
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