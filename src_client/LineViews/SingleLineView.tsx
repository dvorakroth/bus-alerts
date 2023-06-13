import { DateTime } from 'luxon';
import * as React from 'react';
import * as ReactRouter from 'react-router-dom';
import { LoadingOverlay } from '../AlertViews/AlertListPage';
import { RouteChangeForMap, SingleLineChanges } from '../protocol';
import { AgencyTag } from '../RandomComponents/AgencyTag';
import DirectionChooser from '../RandomComponents/DirectionChooser';
import { RouteChangesMapView } from '../RandomComponents/RouteChangeMapView';

const DISMISS_BUTTON_TEXT = "< חזרה לכל הקווים";
const DISCLAIMER_MOT_DESC = "טקסט כפי שנמסר:";

interface ImplSingleLineViewProps {
    data: SingleLineChanges|null;
    isLoading: boolean;
    isModal: boolean;
    showDistance: boolean;
}

function ImplSingleLineView({data, isLoading, isModal, showDistance}: ImplSingleLineViewProps) {
    const navigate = ReactRouter.useNavigate();

    const [selectedDirectionIdx, setSelectedDirectionIdx] = React.useState<number|null>(null);
    const [selectedRouteChangeIdx, setSelectedRouteChangeIdx] = React.useState<number>(0);

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
            setSelectedRouteChangeIdx(0);
        },
        [setSelectedDirectionIdx, setSelectedRouteChangeIdx]
    );

    const onNewRouteChangeSelected = React.useCallback(
        (index) => {
            setSelectedRouteChangeIdx(index);
        },
        [setSelectedRouteChangeIdx]
    );

    const line = data?.line_details;

    const [route_changes_struct, firstDirectionIdxWithChanges] = React.useMemo(
        () => {
            if (!line) return [{}, null];

            let firstIdxWithChanges: number|null = null;

            return [{
                changes: line.dirs_flattened.reduce<Record<string, RouteChangeForMap[]>>(
                    (o, d, idx) => {
                        const periods = d.alert_periods;

                        if (periods?.length) {
                            o[idx] = periods;

                            if (firstIdxWithChanges === null) {
                                firstIdxWithChanges = idx;
                            }
                        } else {
                            o[idx] = [{
                                shape: d.shape,
                                deleted_stop_ids: [],
                                updated_stop_sequence: d.stop_seq.map((stop_id) => [stop_id, false]), 
                                has_no_changes: true
                            }];
                        }
                        return o;
                    },
                    {}
                )
            }, firstIdxWithChanges];
        },
        [line]
    );

    const directions_for_chooser = React.useMemo(
        () => line?.dirs_flattened?.map?.(
            (dir) => ({
                ...dir,
                has_alerts: !!(dir.alert_periods?.length || dir.other_alerts?.length)
            })
        ),
        [line]
    );

    const actualSelectedDirectionIdx = selectedDirectionIdx ?? firstDirectionIdxWithChanges ?? 0;
    
    // const route_changes = line?.dirs_flattened?.[actualSelectedDirectionIdx]?.route_changes;
    const alert_periods = line?.dirs_flattened?.[actualSelectedDirectionIdx]?.alert_periods;

    return <div className={"single-alert-view" + (isModal ? " modal" : "")}>
        <nav>
            <div className="nav-content">
                {isModal
                    ? <a className="back-to-list" href="/" role="link" onClick={onDismissModal}>{DISMISS_BUTTON_TEXT}</a>
                    : <ReactRouter.Link className="back-to-list" to={'/'}>{DISMISS_BUTTON_TEXT}</ReactRouter.Link>}
            </div>
        </nav>
        <div className={"single-alert-content-container" /* i'll... explain later */}
             style={isLoading ? {overflowY: 'hidden'} : {}}> 
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
                                          selectedIndex={actualSelectedDirectionIdx}
                                          onNewSelection={onNewDirectionSelected}
                                          hideCaption={true} />
                    </div>
                    { /* TODO: alert period selector, in the future */}
                    {
                        !alert_periods?.length ? null
                            : <AlertPeriodChooser alert_periods={alert_periods}
                                        selectedIdx={selectedRouteChangeIdx}
                                        onNewSelection={onNewRouteChangeSelected} />
                    }
                    {/* TODO: "no changes to route" overlay for map? or maybe hide map for alerts with no route changes? */}
                    <RouteChangesMapView route_changes={route_changes_struct}
                                            stops={data?.all_stops}
                                            selection={["changes", ""+actualSelectedDirectionIdx, selectedRouteChangeIdx]}
                                            map_bounding_box={data?.map_bounding_box}
                                            onSelectionMoveToBBox={true} />
                    
                    {/* <ul>
                        {line.dirs_flattened[actualSelectedDirectionIdx].testing_alert_intersections_bitmasks.map(({start, end, bitmask}) => (
                            end >= DateTime.now().toSeconds() ? <li>
                                {DateTime.fromSeconds(start).toISO()}<br/>
                                {DateTime.fromSeconds(end || 0).toISO()}<br/>
                                {bitmask.toString(2)}<br/>
                            </li> : null
                        ))}
                    </ul> */}
                </div>
            }
            <LoadingOverlay shown={isLoading} />
        </div>
    </div>
}

interface Props {
    isModal: boolean;
}

export default function FullPageSingleLineView({isModal}: Props) {
    const params = ReactRouter.useParams<"id">();
    const [data, setData] = React.useState<SingleLineChanges|null>(null);
    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    React.useEffect(() => {
        if (!data) {
            fetch("/api/single_line?id=" + encodeURIComponent(params.id ?? ""))
                .then(
                    (response) => response.json().then(
                        (data: SingleLineChanges) => {
                            setData(data);
                            setIsLoading(false);
                        },
                        (error) => {
                            console.error("Error while parsing reponse JSON: ", error);
                            setData(null);
                            setIsLoading(false);
                        }
                    ),
                    (error) => {
                        console.error("Error while fetching single line details: ", error);
                        setData(null);
                        setIsLoading(false);
                    }
                )
                ;
        }
    });

    return <ImplSingleLineView data={data} isLoading={isLoading} isModal={isModal} showDistance={false}/>;
}

interface AlertPeriodChooserProps {
    alert_periods: {start: number, end: number, bitmask: number}[];
    selectedIdx: number | null;
    onNewSelection: (idx: number, event: React.MouseEvent) => void;
}

function AlertPeriodChooser({alert_periods, selectedIdx, onNewSelection}: AlertPeriodChooserProps) {
    const cb = React.useCallback((idx, event) => {
        onNewSelection?.(idx, event);
        event.preventDefault();
        event.stopPropagation();
    }, [onNewSelection]);
    
    return <ul className="single-line-alert-list">
        {alert_periods.map(({start, end, bitmask}, idx) => (
            <li key={idx} className={(idx === selectedIdx ? "selected" : "")}>
                <a href="#" onClick={cb.bind(window, idx)}>
                    {DateTime.fromSeconds(start).toISO()}<br/>
                    {DateTime.fromSeconds(end || 0).toISO()}<br/>
                    {bitmask.toString(2)}<br/>
                </a>
            </li>
        ))}
    </ul>
}