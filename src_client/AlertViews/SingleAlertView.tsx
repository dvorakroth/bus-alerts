import * as React from "react";
import * as ReactRouter from "react-router-dom";
import { FuriousSearchMatch } from "../../FuriousSearch/furiousindex";
import { areMatchesEqual, DistanceTag, MatchedString, RelevanceTag, RelevantLinesListProps, RelevantLinesOrAgencies, RelevantStopsList } from "./AlertSummary";
import { AgencyTag } from "../RandomComponents/AgencyTag";
import { ActivePeriod, ActiveTime, Agency, BoundingBox, ConsolidatedActivePeriod, DateOrDateRange, DepartureChange, JsDict, RouteChange, AlertsResponse, ServiceAlert, SimpleActivePeriod, StopForMap, USE_CASES } from "../data";
import { isoToLocal, make_sure_two_digits, short_datetime_hebrew, short_date_hebrew } from "../junkyard/date_utils";
import { RouteChangesMapView } from "../RandomComponents/RouteChangeMapView";
import { ALERT_SEARCH_KEY_INDICES } from "../search_worker_data";
import { LoadingOverlay } from "./AlertListPage";
import DirectionChooser from "../RandomComponents/DirectionChooser";

const DISMISS_BUTTON_TEXT = "< חזרה לכל ההתראות";
const DISCLAIMER_MOT_DESC = "טקסט כפי שנמסר:";

const ACTIVE_PERIOD_FROM = "מיום ";
const ACTIVE_PERIOD_TO   = "עד יום ";

interface SimpleActivePeriodViewProps {
    period: SimpleActivePeriod;
}

function SimpleActivePeriodsView({period}: SimpleActivePeriodViewProps) {
    const [startISO, endISO] = period.simple;
    return <li>
        {!startISO
            ? null
            : <span className="from">
                {ACTIVE_PERIOD_FROM}
                {short_datetime_hebrew(isoToLocal(startISO))}
            </span>
        }
        {!endISO
            ? null
            : <span className="to">
                {ACTIVE_PERIOD_TO}
                {short_datetime_hebrew(isoToLocal(endISO))}
            </span>
        }
    </li>;
}

const DURING_SINGLUAR_TEXT = "ביום ";
const DURING_PLURAL_TEXT   = "בימים ";
const UNTIL_TEXT = " עד ";

interface ConsolidatedDatesViewProps {
    dates: DateOrDateRange[];
}

function ConsolidatedDatesView({dates}: ConsolidatedDatesViewProps) {
    return <div className="daterange-container">
        <div className="daterange-during">
            {(dates.length === 1 && typeof(dates[0]) === "string")
                ? DURING_SINGLUAR_TEXT
                : DURING_PLURAL_TEXT}
        </div>
        <div className="daterange-group">
            {dates.map((dateOrDateRange, index, {length}) => 
                <span className="daterange" key={index}>
                    {typeof(dateOrDateRange) === "string"
                        ? short_date_hebrew(isoToLocal(dateOrDateRange))
                        : (
                            short_date_hebrew(isoToLocal(dateOrDateRange[0]))
                            + UNTIL_TEXT
                            + short_date_hebrew(isoToLocal(dateOrDateRange[1]))
                        )
                    }
                    {index < length - 1 ? ",\u00a0" : ""}
                </span>
            )}
        </div>
    </div>;
}

function formatSingleDayPeriod(dateOrDateRange: DateOrDateRange, time: ActiveTime) {
    return (
        (typeof(dateOrDateRange) === "string"
            ? DURING_SINGLUAR_TEXT
            : DURING_PLURAL_TEXT)
        + (typeof(dateOrDateRange) === "string"
            ? short_date_hebrew(isoToLocal(dateOrDateRange))
            : (
                short_date_hebrew(isoToLocal(dateOrDateRange[0]))
                + UNTIL_TEXT
                + short_date_hebrew(isoToLocal(dateOrDateRange[1]))
            ))
        + " "
        + FROM_TIME_TEXT + time[0]
        + TO_TIME_TEXT + time[1] 
        + (time[2] ? NEXT_DAY_TEXT : "")
    );
}

const FROM_TIME_TEXT = "משעה ";
const TO_TIME_TEXT   = " עד שעה ";
const NEXT_DAY_TEXT  = " למחרת";

function ConsolidatedTimeRange({active_time}: {active_time: ActiveTime}) {
    return <>
        <span className="from">{FROM_TIME_TEXT + active_time[0] + '\u00a0'}</span>
        <span className="to">
            {
                TO_TIME_TEXT + active_time[1] 
                + (active_time[2] ? NEXT_DAY_TEXT : "")
            }
        </span>
    </>;
}

interface ConsolidatedActivePeriodViewProps {
    period: ConsolidatedActivePeriod
}

function ConsolidatedActivePeriodView({period}: ConsolidatedActivePeriodViewProps) {
    if (
        period.dates.length === 1 
        && period.times.length === 1 
    ) {
        return <li>{formatSingleDayPeriod(period.dates[0], period.times[0])}</li>
    } else {
        return <li>
            <ConsolidatedDatesView dates={period.dates}/>
            <ul className="active-hours">
                {period.times.map((active_time, index) =>
                    <li key={index}><ConsolidatedTimeRange active_time={active_time}/></li>
                )}
            </ul>
        </li>
    }
}

interface ActivePeriodsViewProps {
    active_periods: ActivePeriod[];
}

function ActivePeriodsView({active_periods}: ActivePeriodsViewProps) {
    return <>
        <h2>תוקף:</h2>
        <ul className="active-periods">
            {active_periods?.map(
                (period, index) => 
                    (period as any).simple 
                        ? <SimpleActivePeriodsView 
                            period={period as SimpleActivePeriod}
                            key={index}/>
                        : <ConsolidatedActivePeriodView 
                            period={period as ConsolidatedActivePeriod}
                            key={index}/>
            )}
        </ul>
    </>
}

interface LineChooserLineNumberProps {
    agency_id: string;
    line_number: string;
    isSelected: boolean;
    onLineClick: (agency_id: string, line_number: string, event: React.MouseEvent) => void;
    matches?: FuriousSearchMatch;
}

const LineChooserLineNumber = React.memo(
    (
        {
            agency_id,
            line_number,
            isSelected,
            onLineClick,
            matches
        }: LineChooserLineNumberProps
    ) => {
        const onClick = (event: React.MouseEvent) => onLineClick(agency_id, line_number, event);
        
        return <li className={(isSelected ? " is-selected": "")}>
            <div className={"line-number operator-" + agency_id}
                onClick={onClick}
                role="radio"
                aria-checked={isSelected ? "true" : "false"}>
                <MatchedString s={line_number}
                               matches={matches} />
            </div>
        </li>;
    },
    (oldProps, newProps) => (
        oldProps.agency_id === newProps.agency_id
        && oldProps.line_number === newProps.line_number
        && oldProps.isSelected === newProps.isSelected
        && oldProps.onLineClick === newProps.onLineClick
        && areMatchesEqual(oldProps.matches, newProps.matches)
    )
);

interface LineChooserProps {
    relevant_lines: JsDict<string[]>;
    relevant_agencies: Agency[];
    onNewSelection: (agency_id: string, line_number: string, event: React.MouseEvent) => void;
    agencyNameMatches?: FuriousSearchMatch[];
    lineNumberMatches?: FuriousSearchMatch[];
    title?: string;
}

const CHOOSE_LINE_MAP_LABEL = "בחרו קו להצגת השינויים במפה:"; // TODO phrasing
const CHOOSE_LINE_NONMAP_LABEL = "בחרו קו להצגת השינויים:"; // TODO phrasing???

function LineChooser(
    {
        relevant_lines,
        relevant_agencies,
        onNewSelection,
        agencyNameMatches,
        lineNumberMatches,
        title
    }: LineChooserProps
) {
    // hmm did i ever really need this check? hmmmmmm whatever not gonna loop thru lol
    // if (!relevant_lines?.length) {
    //     return null;
    // }
    
    // relevant_lines = TEST_ROUTES;
    // relevant_agencies = TEST_AGENCIES;

    // we trust the server (which, conveniently enough, i'm also the gardener of)
    // to give us an already-sorted list of agencies, and already-sorted lists
    // of line_numbers

    const firstAgencyId = relevant_agencies[0]?.agency_id;
    const firstLineNumber = relevant_lines[firstAgencyId]?.[0];
    const [selection, setSelection] = React.useState<[string, string]>([firstAgencyId, firstLineNumber]);

    const onLineClick = React.useCallback(
        (agency_id: string, line_number: string, event: React.MouseEvent) => {
            onNewSelection(agency_id, line_number, event);
            setSelection([agency_id, line_number]);
        },
        [onNewSelection]
    );

    let lineGlobalIdx = 0;

    return <div role="radiogroup" aria-labelledby="choose-line-label">
            { title ? <h2 id="choose-line-label">{title}</h2> : null }
            {relevant_agencies.map(({agency_name, agency_id}, agencyIdx) =>
                <React.Fragment key={agency_id}>
                    <AgencyTag agency_name={agency_name}
                               agency_id={agency_id}
                               matches={agencyNameMatches?.[agencyIdx]} />
                    <ul className={"relevant-lines" + (onNewSelection ? " interactive" : "")} key={agency_id}>
                        {relevant_lines[agency_id].map((line_number) => {
                            lineGlobalIdx += 1;

                            return <LineChooserLineNumber agency_id={agency_id}
                                                   line_number={line_number}
                                                   isSelected={selection[0] === agency_id && selection[1] === line_number}
                                                   onLineClick={onLineClick}
                                                   key={line_number}
                                                   matches={lineNumberMatches?.[lineGlobalIdx - 1]} />;
                        })}
                    </ul>
                </React.Fragment>
            )}
        </div>;
}

interface LineChooserAndMapProps extends RelevantLinesListProps {
    route_changes: JsDict<JsDict<RouteChange[]>>;
    stops_for_map: JsDict<StopForMap>;
    map_bounding_box: BoundingBox;
}

function LineChooserAndMap(
    {
        relevant_agencies,
        relevant_lines,
        route_changes,
        stops_for_map,
        map_bounding_box,
        agencyNameMatches,
        lineNumberMatches
    }: LineChooserAndMapProps
) {
    const getChangesForLine = React.useCallback(
        (agency_id: string, line_number: string) => (
            route_changes 
                ? route_changes[agency_id]?.[line_number]
                : []
        ),
        [route_changes]
    )

    const getInnerComponent = React.useCallback(
        (agency_id: string, line_number: string, direction_index: number) => (
            <RouteChangesMapView route_changes={route_changes}
                                 stops={stops_for_map}
                                 selection={[agency_id, line_number, direction_index]}
                                 map_bounding_box={map_bounding_box} />
        ),
        [route_changes, stops_for_map, map_bounding_box]
    );

    return <LineAndDirectionChooser relevant_agencies={relevant_agencies}
                                    relevant_lines={relevant_lines}
                                    agencyNameMatches={agencyNameMatches}
                                    lineNumberMatches={lineNumberMatches}
                                    getChangesForLine={getChangesForLine}
                                    innerComponent={getInnerComponent}
                                    title={CHOOSE_LINE_MAP_LABEL} />;
}

interface LineChooserAndDepChgsProps extends RelevantLinesListProps {
    departure_changes: JsDict<JsDict<DepartureChange[]>>;
}

function LineChooserAndDepChgs(
    {
        relevant_agencies,
        relevant_lines,
        agencyNameMatches,
        lineNumberMatches,
        departure_changes,
    }: LineChooserAndDepChgsProps
) {
    const getChangesForLine = React.useCallback(
        (agency_id: string, line_number: string) => (
            departure_changes 
                ? departure_changes[agency_id]?.[line_number]
                : []
        ),
        [departure_changes]
    )

    const getInnerComponent = React.useCallback(
        (agency_id: string, line_number: string, direction_index: number) => (
            <DepartureChangesView departure_change={departure_changes[agency_id]?.[line_number]?.[direction_index]} />
        ),
        [departure_changes]
    );

    return <LineAndDirectionChooser relevant_agencies={relevant_agencies}
                                    relevant_lines={relevant_lines}
                                    agencyNameMatches={agencyNameMatches}
                                    lineNumberMatches={lineNumberMatches}
                                    getChangesForLine={getChangesForLine}
                                    innerComponent={getInnerComponent}
                                    title={CHOOSE_LINE_NONMAP_LABEL} />;
}

interface LineAndDirectionChooserProps extends RelevantLinesListProps {
    getChangesForLine: (agency_id: string, line_number: string) => {to_text: string, alt_name?: string, dir_name?: string}[];
    innerComponent: (agency_id: string, line_number: string, direction_index: number) => JSX.Element;
    title?: string;
}

function LineAndDirectionChooser(
    {
        relevant_agencies,
        relevant_lines,
        agencyNameMatches,
        lineNumberMatches,
        getChangesForLine,
        innerComponent,
        title
    }: LineAndDirectionChooserProps
) {
    const firstAgencyId = relevant_agencies[0]?.agency_id;
    const firstLineNumber = relevant_lines[firstAgencyId]?.[0];
    const [lineSelection, setLineSelection] = React.useState<[string, string]>([firstAgencyId, firstLineNumber]);
    const [directionSelection, setDirectionSelection] = React.useState<number>(0);

    const onNewLineSelection = React.useCallback(
        (agency_id, line_number) => {
            if (agency_id !== lineSelection[0] || line_number !== lineSelection[1]) {
                setLineSelection([agency_id, line_number]);
                setDirectionSelection(0);
            }
        },
        [lineSelection, setLineSelection, setDirectionSelection] // am i doing this right
    );

    const onNewDirectionSelection = React.useCallback(
        (direction_index) => {
            if (direction_index !== directionSelection) setDirectionSelection(direction_index);
        },
        [directionSelection, setDirectionSelection] // am i doing this right
    );


    return <>
        <LineChooser relevant_lines={relevant_lines}
                     relevant_agencies={relevant_agencies}
                     onNewSelection={onNewLineSelection}
                     agencyNameMatches={agencyNameMatches}
                     lineNumberMatches={lineNumberMatches}
                     title={title} />
        <DirectionChooser changes_for_line={getChangesForLine(...lineSelection)}
                          onNewSelection={onNewDirectionSelection}
                          selectedIndex={directionSelection} />
        {innerComponent(...lineSelection, directionSelection)}
    </>
}

function groupDepartureTimesByHour(times: string[]): JSX.Element {
    const result: JSX.Element[] = [];

    let currentHour: string = null;
    let currentHourEls: JSX.Element[] = [];

    for (let i = 0; i < times.length + 1; i++) { // <-- cursed lol
        let t = times[i];
        const firstColon = t ? t.indexOf(':') : null;
        const hour = t?.substring?.(0, firstColon >= 0 ? firstColon : t.length);

        if (hour !== currentHour) {
            if (currentHourEls.length) {
                const currentHourNumber = parseInt(currentHour);
                const isTomorrow = currentHourNumber >= 24;
        
                result.push(
                    <li key={currentHour}>
                        <ul className="departure-times">
                            {isTomorrow ? <li>(למחרת)</li> : null}
                            {currentHourEls}
                        </ul>
                    </li>
                );
            }

            currentHour = hour;
            currentHourEls = [];
        }

        if (!t) {
            break;
        }

        const currentHourNumber = parseInt(currentHour);

        if (currentHourNumber >= 24) {
            if (firstColon >= 0) {
                t = make_sure_two_digits(currentHourNumber - 24) + t.substring(firstColon);
            }
        }

        currentHourEls.push(
            <li key={t}>{t}</li>
        );
    }

    return <>{result}</>;
}

interface DepartureChangesViewProps {
    departure_change: DepartureChange;
}

function DepartureChangesView({departure_change: {added_hours, removed_hours}}: DepartureChangesViewProps) {
    // added_hours = removed_hours; // TESTING
    
    return <>
        {added_hours?.length ? <h2>נוספו:</h2> : null}
        <ul className="departure-time-groups departure-time-groups-added">
            {groupDepartureTimesByHour(added_hours)}
        </ul>

        {removed_hours?.length ? <h2>בוטלו:</h2> : null}
        <ul className="departure-time-groups departure-time-groups-removed">
            {groupDepartureTimesByHour(removed_hours)}
        </ul>
    </>;
}

interface SingleAlertViewProps {
    data?: AlertsResponse;
    isLoading: boolean;
    isModal: boolean;
    showDistance: boolean;
    matches?: FuriousSearchMatch[][]
}

function shouldShowMapForAlert(alert: ServiceAlert) {
    return alert?.use_case === USE_CASES.STOPS_CANCELLED ||
           alert?.use_case === USE_CASES.ROUTE_CHANGES_FLEX ||
           alert?.use_case === USE_CASES.ROUTE_CHANGES_SIMPLE;
}

function shouldShowDepartureChangesForAlert(alert: ServiceAlert) {
    return alert?.use_case === USE_CASES.SCHEDULE_CHANGES;
}

// this component is only used to display an existing-in-memory ServiceAlert
// to load that ServiceAlert from navigation state (in a modal), use ModalServiceAlert
// to load that ServiceAlert from server (in a permalink), use FullPageSingleAlert
function SingleAlertView(
    {
        data,
        isModal,
        isLoading,
        showDistance,
        matches
    }: SingleAlertViewProps
) {
    const navigate = ReactRouter.useNavigate();

    function onDismissModal(event: React.MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        navigate(-1);
    }

    const alert = data?.alerts?.[0];

    const {
        first_start_time,
        first_relevant_date,
        active_periods,
        header,
        description,

        is_deleted,
        is_expired,

        relevant_agencies,
        relevant_lines,
        added_stops,
        removed_stops,

        distance,
        departure_changes
    } = alert || {};

    const should_show_map = shouldShowMapForAlert(alert);
    const should_show_departure_chgs = shouldShowDepartureChangesForAlert(alert);

    return <div className={"single-alert-view" + (isModal ? " modal" : "")}>
        <nav>
            <div className="nav-content">
                {isModal
                    ? <a className="back-to-list" href="/alerts" role="link" onClick={onDismissModal}>{DISMISS_BUTTON_TEXT}</a>
                    : <ReactRouter.Link className="back-to-list" to={'/alerts'}>{DISMISS_BUTTON_TEXT}</ReactRouter.Link>}
            </div>
        </nav>
        <div className={"single-alert-content-container" /* i'll... explain later */}
             style={isLoading ? {overflowY: 'hidden'} : {}}> 
            {
                data && data.alerts && !data.alerts.length && !isLoading
                    ? <>
                        <div className="no-alerts-today">
                            <span>אולי היתה כאן התראה,</span>
                            <span>ואולי הלינק נשבר</span>
                            <span className="snarky-comment">(ולכו תדעו, אולי יש באג באתר? 🙃)</span>
                        </div>
                        <div className="list-end-gizmo"></div>
                    </>
                    : null
            }
            {!data?.alerts?.length ? null :
                <div className="single-alert-content line-number-big">
                        <RelevanceTag is_deleted={is_deleted} is_expired={is_expired} first_start_time={first_start_time} first_relevant_date={first_relevant_date} />
                        {showDistance
                            ? <DistanceTag distance={distance}/>
                            : null}
                        <h1><MatchedString s={header.he} matches={matches?.[ALERT_SEARCH_KEY_INDICES.HEADER_HE]?.[0]} /></h1>
                        <ActivePeriodsView active_periods={active_periods.consolidated}/>
                        {
                            should_show_map
                                ? <LineChooserAndMap relevant_agencies={relevant_agencies}
                                                     relevant_lines={relevant_lines}
                                                     route_changes={data.route_changes}
                                                     stops_for_map={data.stops_for_map}
                                                     map_bounding_box={data.map_bounding_box}
                                                     agencyNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.AGENCY_NAME]}
                                                     lineNumberMatches={matches?.[ALERT_SEARCH_KEY_INDICES.LINE_NUMBER]} />
                                : 
                                    should_show_departure_chgs
                                        ? <LineChooserAndDepChgs relevant_agencies={relevant_agencies}
                                                                 relevant_lines={relevant_lines}
                                                                 agencyNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.AGENCY_NAME]}
                                                                 lineNumberMatches={matches?.[ALERT_SEARCH_KEY_INDICES.LINE_NUMBER]}
                                                                 departure_changes={departure_changes} />
                                        : <RelevantLinesOrAgencies relevant_agencies={relevant_agencies}
                                                                   relevant_lines={relevant_lines}
                                                                   agencyNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.AGENCY_NAME]}
                                                                   lineNumberMatches={matches?.[ALERT_SEARCH_KEY_INDICES.LINE_NUMBER]} />
                        }
                        
                        <RelevantStopsList relevant_stops={removed_stops}
                                           isRemoved={true}
                                           stopNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.REMOVED_STOP_NAME]}
                                           stopCodeMatches={matches?.[ALERT_SEARCH_KEY_INDICES.REMOVED_STOP_CODE]} />
                        <RelevantStopsList relevant_stops={added_stops}
                                           isRemoved={false}
                                           stopNameMatches={matches?.[ALERT_SEARCH_KEY_INDICES.ADDED_STOP_NAME]}
                                           stopCodeMatches={matches?.[ALERT_SEARCH_KEY_INDICES.ADDED_STOP_CODE]}  />

                        <h2>{DISCLAIMER_MOT_DESC}</h2>
                        <pre><MatchedString s={description.he} matches={matches?.[ALERT_SEARCH_KEY_INDICES.DESCRIPTION_HE]?.[0]} /></pre>
                </div>
            }
            <LoadingOverlay shown={isLoading} />
        </div>
    </div>
}

export function FullPageSingleAlert() {
    const params = ReactRouter.useParams<"id">();
    const [data, setData] = React.useState<AlertsResponse>(null);
    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    React.useEffect(() => {
        if (!data) {
            fetch("/api/single_alert?id=" + encodeURIComponent(params.id))
                .then((response) => response.json())
                .then((data: AlertsResponse) => {
                    setData(data);
                    setIsLoading(false);
                });
        }
    });

    return <SingleAlertView data={data} isLoading={isLoading} isModal={false} showDistance={false}/>;
}

export function ModalSingleAlert() {
    const location = ReactRouter.useLocation();
    const locationState = location.state as {
        alert?: ServiceAlert,
        showDistance?: boolean,
        matches: FuriousSearchMatch[][]
    };

    if (!locationState?.alert) {
        console.error("error: modal alert with no alert data in reactrouter state");
        return null;
    }

    const alert = locationState.alert;

    const hasRouteChanges = 
        alert.use_case === USE_CASES.STOPS_CANCELLED
        || alert.use_case === USE_CASES.ROUTE_CHANGES_FLEX
        || alert.use_case === USE_CASES.ROUTE_CHANGES_SIMPLE;

    const [isLoading, setIsLoading] = React.useState<boolean>(hasRouteChanges);
    const [data, setData] = React.useState<AlertsResponse>(null);

    React.useEffect(() => {
        if (hasRouteChanges && !data) {
            fetch("/api/get_route_changes?id=" + encodeURIComponent(alert.id))
                .then((response) => response.json())
                .then((data: AlertsResponse) => {
                    setData(data);
                    setIsLoading(false);
                });
        }
    });

    return <SingleAlertView data={{alerts: [locationState.alert], ...(data || {})}}
                            isLoading={isLoading}
                            isModal={true}
                            showDistance={locationState?.showDistance}
                            matches={locationState?.matches} />;
}