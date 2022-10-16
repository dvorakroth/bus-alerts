import * as React from 'react';
import * as ReactRouter from 'react-router-dom';
import { SingleLineResponse } from '../data';
import { AgencyTag } from '../RandomComponents/AgencyTag';

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

    const onDismissModal = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        navigate(-1);
    };

    const line = data?.line_details;
    
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
                !line && !isLoading
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
                <div className="single-alert-content">
                    <AgencyTag agency_id={line.agency.agency_id}
                               agency_name={line.agency.agency_name}
                               is_night_line={line.is_night_line} />
                    {/* <div className="destinations"> */}
                        <div className={"line-number line-number-verybig operator-" + line.agency.agency_id}>
                            {line.route_short_name}
                        </div>
                        {/* <h1>{line.headsign_1}</h1>
                        {
                            !line.headsign_2 ? null : <>
                                <span className="direction-separator">⬍</span>
                                <h1>{line.headsign_2}</h1>
                            </>
                        } */}
                    {/* </div> */}
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
                .then((response) => response.json())
                .then((data: SingleLineResponse) => {
                    setData(data);
                    setIsLoading(false);
                });
        }
    });

    return <ImplSingleLineView data={data} isLoading={isLoading} isModal={false} showDistance={false}/>;
}