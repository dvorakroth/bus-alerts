import { DateTime } from 'luxon';
import * as React from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { LoadingOverlay } from '../AlertViews/AlertListPage';
import { AlertPeriodWithRouteChanges, LineDetails, MapBoundingBox, RouteChangeMapData, SingleLineChanges, StopForMap } from '../protocol';
import { AgencyTag } from '../RandomComponents/AgencyTag';
import DirectionChooser from '../RandomComponents/DirectionChooser';
import { RouteChangesMapView } from '../RandomComponents/RouteChangeMapView';
import { AlertGantt } from './AlertGantt';
import { JERUSALEM_TZ, short_date_hebrew, short_datetime_hebrew, short_time_hebrew } from '../junkyard/date_utils';
import * as classNames from 'classnames';
import { DepartureChangesView } from '../RandomComponents/DepartureChangesView';
import { SingleLineViewSkeleton } from '../RandomComponents/Skeletons';

const DISMISS_BUTTON_TEXT = "< חזרה לכל הקווים";
const DISCLAIMER_MOT_DESC = "טקסט כפי שנמסר:";

const NEBULOUS_DISTANT_PAST   = DateTime.fromISO("2000-01-01T00:00:00.000Z").toSeconds();
const NEBULOUS_DISTANT_FUTURE = DateTime.fromISO("2150-01-01T00:00:00.000Z").toSeconds();

interface ImplSingleLineViewProps {
    data: SingleLineChanges|null;
    isLoading: boolean;
    isModal: boolean;
    hasModal: boolean;
    showDistance: boolean;
}

function ImplSingleLineView({data, isLoading, isModal, hasModal, showDistance}: ImplSingleLineViewProps) {
    const navigate = ReactRouterDOM.useNavigate();

    const [selectedDirectionIdx, setSelectedDirectionIdx] = React.useState<number>(0);
    const [selectedChangePeriodIdx, setSelectedChangePeriodIdx] = React.useState<number>(0);

    React.useEffect(
        () => {
            const firstDirectionIdxWithChanges = Math.max(
                data?.line_details?.dirs_flattened?.findIndex(
                    dir => dir.time_sensitive_alerts?.periods?.some(p => p.bitmask !== 0)
                ) ?? 0,
                0
            );


            const direction = data?.line_details?.dirs_flattened?.[firstDirectionIdxWithChanges];
            const nowPeriodIdx = Math.max(0, findNowPeriod(direction?.time_sensitive_alerts?.periods ?? []));

            setSelectedDirectionIdx(firstDirectionIdxWithChanges);
            setSelectedChangePeriodIdx(nowPeriodIdx);
        },
        [data]
    );

    const onDismissModal = React.useCallback(
        (event: React.MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();

            navigate(-1);
        },
        [navigate]
    );

    const onNewDirectionSelected = React.useCallback(
        (index) => {
            setSelectedDirectionIdx(index);

            // TODO maybe instead of always reverting to "now", i should instead find a period that
            //      closely matches whatever period was selected for the previously selected direction???
            const direction = data?.line_details?.dirs_flattened?.[index];
            const nowPeriodIdx = Math.max(0, findNowPeriod(direction?.time_sensitive_alerts?.periods ?? []));

            setSelectedChangePeriodIdx(nowPeriodIdx);
        },
        [data, setSelectedDirectionIdx, setSelectedChangePeriodIdx]
    );

    const onNewChangePeriodSelected = React.useCallback(
        (index) => {
            setSelectedChangePeriodIdx(index);
        },
        [setSelectedChangePeriodIdx]
    );

    const line = data?.line_details;

    const route_changes_for_map = React.useMemo(
        () => {
            if (!line) return {changes: {}};

            return {
                changes: line.dirs_flattened.reduce<Record<string, RouteChangeMapData[]>>(
                    (changesDict, dir, dirIdx) => {
                        const periods = dir?.time_sensitive_alerts?.periods;

                        if (periods?.length) {
                            changesDict[dirIdx] = periods;
                        } else {
                            changesDict[dirIdx] = [{
                                shape: dir.shape,
                                deleted_stop_ids: [],
                                updated_stop_sequence: dir.stop_seq.map((stop_id) => [stop_id, false]), 
                                has_no_route_changes: true,
                                map_bounding_box: boundingBoxForStops(dir.stop_seq, data.all_stops)
                            }];
                        }
                        return changesDict;
                    },
                    {}
                )
            };
        },
        [line]
    );

    const directions_for_chooser = React.useMemo(
        () => line?.dirs_flattened?.map?.(
            (dir) => ({
                ...dir,
                has_alerts: !!(dir.time_sensitive_alerts?.periods?.length/* || dir.other_alerts?.length*/)
            })
        ),
        [line]
    );

    const selectedDirection = line?.dirs_flattened?.[selectedDirectionIdx];
    const route_changes = selectedDirection?.time_sensitive_alerts;
    const selectedPeriod = route_changes?.periods?.[selectedChangePeriodIdx];

    return <div className={classNames("single-alert-view", {modal: isModal}, {hidden: hasModal})}>
        <nav>
            <div className="nav-content">
                {isModal
                    ? <a className="back-to-list" href="/lines" role="link" onClick={onDismissModal}>{DISMISS_BUTTON_TEXT}</a>
                    : <ReactRouterDOM.Link className="back-to-list" to={'/lines'}>{DISMISS_BUTTON_TEXT}</ReactRouterDOM.Link>}
            </div>
        </nav>
        <div className={"single-alert-content-container" /* i'll... explain later */}
             style={isLoading ? {overflowY: 'hidden'} : {}}> 
            {
                isLoading
                    ? <SingleLineViewSkeleton />
                    : null
            }
            {
                (!line && !isLoading)
                    ? <>
                        <div className="no-alerts-today">
                            <span>אולי היה כאן דף,</span>
                            <span>ואולי הלינק נשבר</span>
                            <span className="snarky-comment">(ולכו תדעו, אולי יש באג באתר? 🙃)</span>
                        </div>
                        <div className="list-end-gizmo"></div>
                    </>
                    : null
            }
            {!line ? null :
                <div className="single-line-content">
                    <div className="destinations">
                        <div className="line-and-agency">
                            <AgencyTag agency_id={line.agency.agency_id}
                                    agency_name={line.agency.agency_name}
                                    is_night_line={line.is_night_line}
                                    hideName={true} />
                            <div className={"line-number line-number-bigger operator-" + line.agency.agency_id}>
                                {line.route_short_name}
                            </div>
                        </div>
                        <DirectionChooser changes_for_line={directions_for_chooser ?? []}
                                          selectedIndex={selectedDirectionIdx}
                                          onNewSelection={onNewDirectionSelected}
                                          hideCaption={true} />
                    </div>
                    {
                        !route_changes ? null
                            : <AlertGantt periods={route_changes.periods}
                                alertMetadata={route_changes.alert_metadata}
                                selectedChangePeriodIdx={selectedChangePeriodIdx}
                                onNewChangePeriodSelected={onNewChangePeriodSelected} />
                    }
                    <h2>{mapTitleForPeriod(selectedPeriod)}</h2>
                    {/* TODO: "no changes to route" overlay for map? or maybe hide map for directions/alternatives with no route changes? */}
                    <RouteChangesMapView route_changes={route_changes_for_map}
                                            stops={data?.all_stops}
                                            selection={["changes", ""+selectedDirectionIdx, selectedChangePeriodIdx]}
                                            map_bounding_box={data?.map_bounding_box}
                                            onSelectionMoveToBBox={true} />
                    {
                        !selectedPeriod?.departure_changes ? null
                            : <DepartureChangesView departure_change={selectedPeriod.departure_changes} />
                    }
                    {
                        !selectedPeriod?.bitmask ? null
                            : <>
                                <h2>התראות פעילות:</h2>
                                <ul>
                                    {[...iterateOverBitmask(selectedPeriod.bitmask)].map(
                                        idx => {
                                            const alert = route_changes?.alert_metadata?.[idx];
                                            if (!alert) return null;

                                            return <li key={alert.id}>
                                                <LinkToAlert alertId={alert.id} currentLine={line}>
                                                    {alert.header.he}
                                                </LinkToAlert>
                                            </li>;
                                        }
                                    )}
                                </ul>
                            </>
                    }
                    {
                        !selectedDirection?.deleted_alerts?.length ? null
                            : <>
                                <h2>התראות שנמחקו:</h2>
                                <ul className="deleted">
                                    {selectedDirection.deleted_alerts.map(
                                        alert => <li key={alert.id}>
                                            <LinkToAlert alertId={alert.id} currentLine={line}>
                                                {alert.header.he}
                                            </LinkToAlert>
                                        </li>
                                    )}
                                </ul>
                            </>
                    }
                </div>
            }
            {/* <LoadingOverlay shown={isLoading} /> */}
        </div>
    </div>
}

interface LinkToAlertProps {
    alertId: string;
    className?: string;
    currentLine: LineDetails;

    children?: string | JSX.Element | JSX.Element[];
}

function LinkToAlert({alertId, className, currentLine, children}: LinkToAlertProps) {
    // TODO i should probably find some kind of solution that keeps several
    //      background states alive or something, so i don't have to reload
    //      the SingleLineView (and thus reset its state!) whenever we
    //      dismiss/go back from the alert page? but that sounds like a pain
    //      in the ass so uh,,, maybe later
    
    const location = ReactRouterDOM.useLocation();
    const {backgroundLocation} = (location.state as {
        backgroundLocation?: ReactRouterDOM.Location
    }|undefined) ?? {};
    
    return <ReactRouterDOM.Link className={className}
            to={`/alert/${alertId}`}
            state={{
                backgroundLocation: backgroundLocation ?? location,
                alert: null,
                showDistance: false,
                matches: [],
                backToLine: {
                    line_number: currentLine.route_short_name,
                    agency_id: currentLine.agency.agency_id,
                    line_pk: currentLine.pk
                }
            }}>
        {children}
    </ReactRouterDOM.Link>;
}

function mapTitleForPeriod(selectedPeriod: AlertPeriodWithRouteChanges|undefined) {
    const {start: startUnixtime, end: endUnixtime} = selectedPeriod ?? {};

    const showPeriodStart = !!(startUnixtime && startUnixtime > NEBULOUS_DISTANT_PAST);
    const showPeriodEnd   = !!(endUnixtime   && endUnixtime < NEBULOUS_DISTANT_FUTURE);

    const start = showPeriodStart && DateTime.fromSeconds(startUnixtime, {zone: JERUSALEM_TZ});
    const end = showPeriodEnd && DateTime.fromSeconds(endUnixtime, {zone: JERUSALEM_TZ});

    return !selectedPeriod
        ? "מפת הקו:"
        : !start && !end
        ? "מפת הקו המעודכנת:"
        : start && !end
        ? "מפת הקו החל מיום " + short_datetime_hebrew(start) + ":"
        : !start && end
        ? "מפת הקו עד ליום " + short_datetime_hebrew(end) + ":"
        : start && end && start.toFormat("yyyy-MM-dd") === end.toFormat("yyyy-MM-dd")
        ? "מפת הקו ביום " + short_date_hebrew(start) + " בין " + short_time_hebrew(start) + " ל-" + short_time_hebrew(end) + ":"
        : start && end
        ? "מפת הקו בין יום " + short_datetime_hebrew(start) + " ליום " + short_datetime_hebrew(end) + ":"
        : null;
}

function *iterateOverBitmask(bitmask: number) {
    for(let i = 0; bitmask; i++, bitmask >>= 1) {
        if (bitmask & 1) {
            yield i;
        }
    }
}

function boundingBoxForStops(
    stopIds: Iterable<string>,
    stops_for_map: Record<string, StopForMap>
): MapBoundingBox {
    /**
     * get bounding box of affected stops, for setting the maps' bounding box
     */

    let min_lon = Infinity;
    let min_lat = Infinity;
    let max_lon = -Infinity;
    let max_lat = -Infinity;

    for (const stopId of stopIds) {
        const stop = stops_for_map[stopId];
        if (!stop) continue;

        if (min_lon > stop.stop_lon) {
            min_lon = stop.stop_lon;
        }
        if (min_lat > stop.stop_lat) {
            min_lat = stop.stop_lat;
        }
        if (max_lon < stop.stop_lon) {
            max_lon = stop.stop_lon;
        }
        if (max_lat < stop.stop_lat) {
            max_lat = stop.stop_lat;
        }
    }

    return {
        min_lon,
        min_lat,
        max_lon,
        max_lat
    };
}


interface Props {
    isModal: boolean;
    hasModal?: boolean;
}

export default function FullPageSingleLineView({isModal, hasModal}: Props) {
    const params = ReactRouterDOM.useParams<"id">();
    const [data, setData] = React.useState<SingleLineChanges|null>(null);
    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    React.useEffect(() => {
        if (!data) {
            fetch("/api/single_line?id=" + encodeURIComponent(params.id ?? ""))
                .then(
                    async (response) => {
                        let data = null;
                        try {
                            data = await response.json();
                        } catch(err) {
                            console.error("Error while parsing response JSON: ", err);
                        }

                        // await new Promise(r => setTimeout(r, 10000));

                        setData(data);
                        setIsLoading(false);
                    },
                    (error) => {
                        console.error("Error while fetching single line details: ", error);
                        setData(null);
                        setIsLoading(false);
                    }
                )
                ;
        }
    });

    return <ImplSingleLineView data={data} isLoading={isLoading} isModal={isModal} hasModal={!!hasModal} showDistance={false}/>;
}

function findNowPeriod(periods: AlertPeriodWithRouteChanges[]) {
    const now = DateTime.now().toSeconds();

    return periods.findIndex(
        ({start, end}) => start <= now && now <= end
    );
}