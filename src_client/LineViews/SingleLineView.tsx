import * as React from 'react';
import * as ReactRouter from 'react-router-dom';
import { JsDict, AlertWithRouteChange, RouteChange, RouteChangeForMap, SingleLineResponse } from '../data';
import { AgencyTag } from '../RandomComponents/AgencyTag';
import DirectionChooser from '../RandomComponents/DirectionChooser';
import { RouteChangesMapView } from '../RandomComponents/RouteChangeMapView';

const DISMISS_BUTTON_TEXT = "< חזרה לכל הקווים";
const DISCLAIMER_MOT_DESC = "טקסט כפי שנמסר:";

interface ImplSingleLineViewProps {
    data: SingleLineResponse;
    isLoading: boolean;
    isModal: boolean;
    showDistance: boolean;
}

function ImplSingleLineView({data, isLoading, isModal, showDistance}: ImplSingleLineViewProps) {
    const navigate = ReactRouter.useNavigate();

    const [selectedDirectionIdx, setSelectedDirectionIdx] = React.useState(0);

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
        },
        [setSelectedDirectionIdx]
    );

    const line = data?.line_details;

    const route_changes_struct = React.useMemo(
        () => {
            if (!line) return null;

            return {
                changes: line.dirs_flattened.reduce<JsDict<RouteChangeForMap[]>>(
                    (o, d, idx) => {
                        const chgs = d.route_changes;

                        if (chgs?.length) {
                            o[idx] = d.route_changes;
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
            }
        },
        [line]
    )
    
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
                        { /* TODO: show a hazard.svg next to directions that have alerts */}
                        <DirectionChooser changes_for_line={line.dirs_flattened}
                                          selectedIndex={selectedDirectionIdx}
                                          onNewSelection={onNewDirectionSelected}
                                          hideCaption={true} />
                    </div>
                    { /* TODO: alert selector (or alert period selector, in the future) */}
                    {/* TODO: "no changes to route" overlay for map? or maybe hide map for alerts with no route changes? */}
                    <RouteChangesMapView route_changes={route_changes_struct}
                                            stops={data?.all_stops}
                                            selection={["changes", ""+selectedDirectionIdx, 0]}
                                            map_bounding_box={data?.map_bounding_box}
                                            onSelectionMoveToBBox={true} />
                </div>
            }
        </div>
    </div>
}

interface Props {
    isModal: boolean;
}

export default function FullPageSingleLineView({isModal}: Props) {
    const params = ReactRouter.useParams<"id">();
    const [data, setData] = React.useState<SingleLineResponse>(null);
    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    React.useEffect(() => {
        if (!data) {
            fetch("/api/single_line?id=" + encodeURIComponent(params.id))
                .then(
                    (response) => response.json().then(
                        (data: SingleLineResponse) => {
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