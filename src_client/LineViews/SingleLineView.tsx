import { DateTime } from 'luxon';
import * as React from 'react';
import * as ReactRouter from 'react-router-dom';
import { LoadingOverlay } from '../AlertViews/AlertListPage';
import { AlertPeriodWithRouteChanges, RouteChangeForMap, SingleLineChanges } from '../protocol';
import { AgencyTag } from '../RandomComponents/AgencyTag';
import DirectionChooser from '../RandomComponents/DirectionChooser';
import { RouteChangesMapView } from '../RandomComponents/RouteChangeMapView';
import { AlertGant } from './AlertGant';
import { JERUSALEM_TZ, short_datetime_hebrew } from '../junkyard/date_utils';

const DISMISS_BUTTON_TEXT = "< חזרה לכל הקווים";
const DISCLAIMER_MOT_DESC = "טקסט כפי שנמסר:";

const NEBULOUS_DISTANT_PAST   = DateTime.fromISO("2000-01-01T00:00:00.000Z").toSeconds();
const NEBULOUS_DISTANT_FUTURE = DateTime.fromISO("2150-01-01T00:00:00.000Z").toSeconds();

interface ImplSingleLineViewProps {
    data: SingleLineChanges|null;
    isLoading: boolean;
    isModal: boolean;
    showDistance: boolean;
}

function ImplSingleLineView({data, isLoading, isModal, showDistance}: ImplSingleLineViewProps) {
    const navigate = ReactRouter.useNavigate();

    const [selectedDirectionIdx, setSelectedDirectionIdx] = React.useState<number>(0);
    const [selectedChangePeriodIdx, setSelectedChangePeriodIdx] = React.useState<number>(0);

    React.useEffect(
        () => {
            const firstDirectionIdxWithChanges = Math.max(
                data?.line_details?.dirs_flattened?.findIndex(
                    dir => dir.route_change_alerts?.periods?.some(p => p.bitmask !== 0)
                ) ?? 0,
                0
            );


            const direction = data?.line_details?.dirs_flattened?.[firstDirectionIdxWithChanges];
            const nowPeriodIdx = Math.max(0, findNowPeriod(direction?.route_change_alerts?.periods ?? []));

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
            const nowPeriodIdx = Math.max(0, findNowPeriod(direction?.route_change_alerts?.periods ?? []));

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
                changes: line.dirs_flattened.reduce<Record<string, RouteChangeForMap[]>>(
                    (changesDict, dir, dirIdx) => {
                        const periods = dir?.route_change_alerts?.periods;

                        if (periods?.length) {
                            changesDict[dirIdx] = periods;
                        } else {
                            changesDict[dirIdx] = [{
                                shape: dir.shape,
                                deleted_stop_ids: [],
                                updated_stop_sequence: dir.stop_seq.map((stop_id) => [stop_id, false]), 
                                has_no_changes: true
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
                has_alerts: !!(dir.route_change_alerts?.periods?.length || dir.other_alerts?.length)
            })
        ),
        [line]
    );

    const route_changes = line?.dirs_flattened?.[selectedDirectionIdx]?.route_change_alerts;

    const selectedPeriod = route_changes?.periods?.[selectedChangePeriodIdx];
    const showPeriodStart = selectedPeriod?.start && selectedPeriod?.start > NEBULOUS_DISTANT_PAST;
    const showPeriodEnd   = selectedPeriod?.end   && selectedPeriod?.end < NEBULOUS_DISTANT_FUTURE;

    const startFormattedDate = showPeriodStart && short_datetime_hebrew(DateTime.fromSeconds(selectedPeriod?.start, {zone: JERUSALEM_TZ}));
    const endFormattedDate = showPeriodEnd && short_datetime_hebrew(DateTime.fromSeconds(selectedPeriod?.end, {zone: JERUSALEM_TZ}));

    return <div className={"single-alert-view" + (isModal ? " modal" : "")}>
        <nav>
            <div className="nav-content">
                {isModal
                    ? <a className="back-to-list" href="/lines" role="link" onClick={onDismissModal}>{DISMISS_BUTTON_TEXT}</a>
                    : <ReactRouter.Link className="back-to-list" to={'/lines'}>{DISMISS_BUTTON_TEXT}</ReactRouter.Link>}
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
                                          selectedIndex={selectedDirectionIdx}
                                          onNewSelection={onNewDirectionSelected}
                                          hideCaption={true} />
                    </div>
                    {
                        !route_changes ? null
                            : <AlertGant periods={route_changes.periods}
                                alertMetadata={route_changes.alertMetadata}
                                selectedChangePeriodIdx={selectedChangePeriodIdx}
                                onNewChangePeriodSelected={onNewChangePeriodSelected} />
                    }
                    <h2>
                        {/* TODO when the start and end is on the same day, don't print the date twice, just "on day DD.MM, between HH:MM and HH:MM"?? */}
                        {!selectedPeriod
                            ? "מפת הקו:"
                            : !showPeriodStart && !showPeriodEnd
                            ? "מפת הקו המעודכנת:"
                            : showPeriodStart && !showPeriodEnd
                            ? "מפת הקו החל מיום " + startFormattedDate + ":"
                            : !showPeriodStart && showPeriodEnd
                            ? "מפת הקו עד ליום " + endFormattedDate + ":"
                            : showPeriodStart && showPeriodEnd
                            ? "מפת הקו בין יום " + startFormattedDate + " ליום " + endFormattedDate + ":"
                            : null
                        }
                    </h2>
                    {/* TODO: "no changes to route" overlay for map? or maybe hide map for directions/alternatives with no route changes? */}
                    <RouteChangesMapView route_changes={route_changes_for_map}
                                            stops={data?.all_stops}
                                            selection={["changes", ""+selectedDirectionIdx, selectedChangePeriodIdx]}
                                            map_bounding_box={data?.map_bounding_box}
                                            onSelectionMoveToBBox={true} />
                    {/* TODO list of alerts (both with and without route changes) in the selected period, with links */}
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

function findNowPeriod(periods: AlertPeriodWithRouteChanges[]) {
    const now = DateTime.now().toSeconds();

    return periods.findIndex(
        ({start, end}) => start <= now && now <= end
    );
}