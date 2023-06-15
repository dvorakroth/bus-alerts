import * as React from 'react';
import { AlertPeriodWithRouteChanges, TranslationObject } from '../protocol';
import { DateTime, DurationLike } from 'luxon';
import { JERUSALEM_TZ, short_date_hebrew, short_time_hebrew } from '../junkyard/date_utils';
import * as classnames from 'classnames';
import useResizeObserver from 'use-resize-observer';

type AlertAppearance = {
    alertIdx: number;
    alert: {id: string; header: TranslationObject};
    firstAppearance: number;
    totalLength: number;
};

interface AlertGantProps {
    periods: AlertPeriodWithRouteChanges[];
    alertMetadata: {id: string; header: TranslationObject}[];
    selectedChangePeriodIdx: number;
    onNewChangePeriodSelected: (idx: number) => void;
}

const PIXELS_PER_HOUR = 8;
const HOURLINE_INTERVAL = 6; // spacing between hourlines, in hours

export function AlertGant({periods, alertMetadata, selectedChangePeriodIdx}: AlertGantProps) {
    // TODO maybe remove the text on the alert items themselves?
    //      the text is so Bad that most of the time it just says
    //      something useless like "Tel Av..." or "Kiryat Ono, ..."
    const {ref: gantAreaRef, width: gantWidthPx} = useResizeObserver();
    const gantWidthSeconds = gantWidthPx === undefined
        ? undefined
        : gantWidthPx / PIXELS_PER_HOUR * 3600;
    
    const nowInJerusalem = DateTime.now().setZone(JERUSALEM_TZ);

    const defaultViewStart = nowInJerusalem
        .set({
            hour: nowInJerusalem.hour - (nowInJerusalem.hour % HOURLINE_INTERVAL),
            minute: 0,
            second: 0,
            millisecond: 0
        })
        .minus({ hours: HOURLINE_INTERVAL / 2 });
    const defaultViewEnd = gantWidthSeconds === undefined
        ? undefined
        : defaultViewStart.plus({ seconds: gantWidthSeconds });

    const minimumStartPosition = defaultViewStart.minus({ hours: 2 * 24 });
    const maximumEndPosition = defaultViewEnd?.plus({ hours: 10 * 24 });

    const [viewportStart, setViewportStart] = React.useState<DateTime>(defaultViewStart);
    const [viewportEnd, setViewportEnd] = React.useState<DateTime|undefined>(defaultViewEnd);

    React.useEffect(
        () => {
            if (gantWidthSeconds === undefined) return;

            if (!viewportEnd) setViewportEnd(defaultViewEnd)
            else setViewportEnd(viewportStart.plus({seconds: gantWidthSeconds}));
        }, [gantWidthSeconds]
    );

    const viewportStartUnixtime = viewportStart.toSeconds();
    const viewportEndUnixtime = viewportEnd?.toSeconds();

    const periodsInViewport = React.useMemo(
        () => viewportEndUnixtime === undefined
            ? undefined
            : [...filterPeriodsForViewport(
                periods,
                viewportStartUnixtime,
                viewportEndUnixtime
            )],
        [viewportStartUnixtime, viewportEndUnixtime, periods]
    );

    const [orderOfAppearance, setOrderOfAppearance] = React.useState<AlertAppearance[]|undefined>(undefined);

    React.useEffect(
        () => {
            if (!defaultViewEnd) return;

            const periodsInDefaultViewport = [...filterPeriodsForViewport(
                periods,
                defaultViewStart.toSeconds(),
                defaultViewEnd.toSeconds()
            )];
            const order = alertMetadata
                .map(
                    (alert, alertIdx) => ({
                        alertIdx,
                        alert,
                        firstAppearance: periodsInDefaultViewport.findIndex(
                            ({bitmask}) => (bitmask & (1 << alertIdx)) !== 0
                        ),
                        totalLength: countPeriodLength(
                            periodsInDefaultViewport,
                            ({bitmask}) => (bitmask & (1 << alertIdx)) !== 0
                        )
                    })
                )
                .map((e) => ({
                    ...e,
                    firstAppearance: e.firstAppearance < 0 ? Infinity : e.firstAppearance,
                }))
                .sort((a, b) => {
                    if (a.firstAppearance !== b.firstAppearance) {
                        return a.firstAppearance - b.firstAppearance;                        
                    }

                    if (a.totalLength !== b.totalLength) {
                        return b.totalLength - a.totalLength;
                    }

                    return a.alertIdx < b.alertIdx
                        ? -1
                        : a.alertIdx > b.alertIdx
                        ? 1
                        : 0;
                });
            
            setOrderOfAppearance(order);
        },
        [!defaultViewEnd, periods, alertMetadata]
    );

    const canMoveBack = viewportStartUnixtime > minimumStartPosition.toSeconds();
    const canMoveForward = maximumEndPosition && viewportEndUnixtime && viewportEndUnixtime < maximumEndPosition.toSeconds();

    const moveBack = React.useCallback(
        () => {
            if (!viewportEnd || !canMoveBack) return;

            setViewportStart(viewportStart.minus({ hours: HOURLINE_INTERVAL }))
            setViewportEnd(viewportEnd.minus({ hours: HOURLINE_INTERVAL }))
        }, [viewportStart, viewportEnd, setViewportStart, setViewportEnd, canMoveBack]
    );

    const moveForward = React.useCallback(
        () => {
            if (!viewportEnd || !canMoveForward) return;

            setViewportStart(viewportStart.plus({ hours: HOURLINE_INTERVAL }))
            setViewportEnd(viewportEnd.plus({ hours: HOURLINE_INTERVAL }))
        }, [viewportStart, viewportEnd, setViewportStart, setViewportEnd, canMoveForward]
    );

    const stillLoading = !orderOfAppearance || !periodsInViewport || !viewportEnd || viewportEndUnixtime === undefined;

    return <div className="alert-gant">
        {/* TODO actual images for the buttons */}
        <button className="move-viewport" onClick={moveBack} disabled={!canMoveBack}>&lt;</button>
        <div className="gant-area" ref={gantAreaRef}>
            <ul className="alert-gant-rows">
                {!stillLoading && orderOfAppearance?.map(
                    ({alertIdx, alert}) =>
                        <AlertGantRow
                            key={alert.id}
                            alertIdx={alertIdx}
                            alert={alert}
                            periodsInViewport={periodsInViewport}
                            viewportStart={viewportStartUnixtime}
                            viewportEnd={viewportEndUnixtime}
                        />
                )}
            </ul>
            <div className="alert-gant-hourlines">
                {!stillLoading && [...dateRange(findNextRoundHour(viewportStart, HOURLINE_INTERVAL, 0), viewportEnd, {hours: HOURLINE_INTERVAL})].map(
                    ({prevDate, date}) =>
                        <div 
                            className="hourline"
                            style={{
                                right: rightPercentageForUnixtime(date.toSeconds(), viewportStartUnixtime, viewportEndUnixtime)
                            }}
                        >
                            <span className="datelabel">
                                {
                                    !prevDate || prevDate.weekday !== date.weekday
                                        ? <>{short_date_hebrew(date)}<br/></>
                                        : null
                                }
                                {
                                    short_time_hebrew(date)
                                }
                            </span>
                        </div>
                )}
            </div>
            {!stillLoading && <NowHourline viewportStart={viewportStartUnixtime} viewportEnd={viewportEndUnixtime} />}
            {/* TODO clickable gant areas? */}
            {/* TODO links to the alerts' pages? */}
            {/* TODO jump to next alert? */}
            {/* TODO indicators telling you if there's more alerts in some direction? */}
            {/* TODO jump to today (back to default view) button? */}
        </div>
        <button className="move-viewport" onClick={moveForward} disabled={!canMoveForward}>&gt;</button>
    </div>
}

interface AlertGantRowProps {
    alertIdx: number;
    periodsInViewport: AlertPeriodWithRouteChanges[];
    alert: {id: string; header: TranslationObject};
    viewportStart: number;
    viewportEnd: number;
}

function AlertGantRow({
    alertIdx,
    periodsInViewport,
    alert,
    viewportStart,
    viewportEnd
}: AlertGantRowProps) {
    const activePeriods = React.useMemo(
        () => constructVisibleActivePeriods(periodsInViewport, alertIdx),
        [alertIdx, periodsInViewport]
    );

    return <li>
        {activePeriods.map(
            ({start, end}, idx) => 
                <div
                    key={idx}
                    className={classnames(
                        "alert-gant-item",
                        {"start-visible": start >= viewportStart},
                        {"end-visible": end <= viewportEnd}
                    )}
                    style={{
                        right: rightPercentageForUnixtime(start, viewportStart, viewportEnd),
                        width: widthPercentageForUnixtime(start, end, viewportStart, viewportEnd)
                    }}>
                    {alert.header.he ?? ""}
                </div>
        )}
    </li>;
}

interface NowHourlineProps {
    viewportStart: number;
    viewportEnd: number;
}

function NowHourline({viewportStart, viewportEnd}: NowHourlineProps) {
    const [now, setNow] = React.useState<DateTime>(DateTime.now().setZone(JERUSALEM_TZ));
    const nowIntervalRef = React.useRef<number|null>(null);

    React.useEffect(() => {
        if (nowIntervalRef.current === null) {
            nowIntervalRef.current = window.setInterval(
                () => { setNow(DateTime.now().setZone(JERUSALEM_TZ)); },
                1000 * 60
            );
        }

        return () => {
            if (nowIntervalRef.current !== null) {
                window.clearInterval(nowIntervalRef.current);
                nowIntervalRef.current = null;
            }
        };
    });

    const unixtime = now.toSeconds();

    if (unixtime < viewportStart || unixtime > viewportEnd) {
        return <></>
    }

    return <div 
        className="hourline hourline-now"
        style={{
            right: rightPercentageForUnixtime(unixtime, viewportStart, viewportEnd)
        }}
    >
        <span className="datelabel">
            עכשיו
        </span>
    </div>;
}

function constructVisibleActivePeriods(
    periodsInViewport: AlertPeriodWithRouteChanges[],
    alertIdx: number
) {
    const result: {start: number, end: number}[] = [];

    let previousPeriod = null;

    for (const period of periodsInViewport) {
        const isActive = (period.bitmask & (1 << alertIdx)) !== 0;
        if (!isActive) {
            previousPeriod = null;
            continue;
        }

        if (previousPeriod) {
            previousPeriod.end = period.end;
        } else {
            previousPeriod = {
                start: period.start,
                end: period.end
            };
            result.push(previousPeriod);
        }
    }

    return result;
}

function *filterPeriodsForViewport(
    periods: AlertPeriodWithRouteChanges[],
    viewportStart: number,
    viewportEnd: number
) {
    for (const period of periods) {
        if (period.start < viewportEnd && viewportStart < period.end) {
            yield period;
        }
    }
}

function countPeriodLength(
    arr: AlertPeriodWithRouteChanges[],
    predicate: (t: AlertPeriodWithRouteChanges) => boolean
) {
    let sumLength = 0;

    for (let i = 0; i < arr.length; i++) {
        const period = arr[i];
        if (!period) continue;

        if (predicate(period)) {
            sumLength += (period.end - period.start);
        }
    }

    return sumLength;
}

function *range(
    start: number,
    endExclusive: number,
    increment: number = 1
) {
    for (let i = start; i < endExclusive; i++) {
        yield i;
    }
}

function rightPercentageForUnixtime(
    unixtime: number,
    viewportStart: number,
    viewportEnd: number
) { 
    return (
        100 * 
            (Math.max(unixtime, viewportStart) - viewportStart)
            /
            (viewportEnd - viewportStart)
    ) + "%";
}

function widthPercentageForUnixtime(
    unixtimeStart: number,
    unixtimeEnd: number,
    viewportStart: number,
    viewportEnd: number
) {
    return (
        100 * 
            (Math.min(unixtimeEnd, viewportEnd) - Math.max(unixtimeStart, viewportStart))
            /
            (viewportEnd - viewportStart)
    ) + "%";
}

function findNextRoundHour(
    start: DateTime,
    modulo: number,
    moduloEquals = 0
) {
    modulo = Math.max(1, Math.floor(modulo));
    moduloEquals = Math.max(0, Math.min(modulo - 1, moduloEquals));

    let d = start.set({
        second: 0,
        millisecond: 0
    });

    if (d.minute !== 0) {
        d = d.plus({
            minutes: 60 - d.minute
        });
    }

    while (d.hour % modulo !== moduloEquals) {
        d = d.plus({hours: 1});
    }

    return d;
}

function *dateRange(
    start: DateTime,
    endInclusive: DateTime,
    increment: DurationLike
) {
    let prevDate = null;
    let date = start;
    do {
        yield {prevDate, date};
        prevDate = date;
        date = date.plus(increment);
    } while(date.toSeconds() <= endInclusive.toSeconds());
}
