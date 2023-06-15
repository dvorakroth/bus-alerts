import * as React from 'react';
import { AlertPeriodWithRouteChanges, TranslationObject } from '../protocol';
import { DateTime, DurationLike } from 'luxon';
import { JERUSALEM_TZ, short_date_hebrew, short_time_hebrew } from '../junkyard/date_utils';
import * as classnames from 'classnames';
import useResizeObserver from 'use-resize-observer';

interface AlertGantProps {
    periods: AlertPeriodWithRouteChanges[];
    alertMetadata: {id: string; header: TranslationObject}[];
    selectedChangePeriodIdx: number;
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
    
    console.log("gant width", gantWidthSeconds);

    const nowInJerusalem = DateTime.now().setZone(JERUSALEM_TZ);

    const defaultViewStart = nowInJerusalem
        .set({
            hour: nowInJerusalem.hour - (nowInJerusalem.hour % HOURLINE_INTERVAL),
            minute: 0,
            second: 0,
            millisecond: 0
        })
        .minus({ hours: 3 });
    const defaultViewEnd = gantWidthSeconds === undefined
        ? undefined
        : defaultViewStart.plus({ seconds: gantWidthSeconds });

    // TODO minimum/maximum scroll position, by first/last alerts in data

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

    const orderOfAppearance = React.useMemo(
        () => {
            if (!defaultViewEnd) return undefined;

            const periodsInDefaultViewport = [...filterPeriodsForViewport(
                periods,
                defaultViewStart.toSeconds(),
                defaultViewEnd.toSeconds()
            )];
            return alertMetadata
                .map(
                    (alert, alertIdx) => ({
                        alertIdx,
                        alert,
                        firstAppearance: periodsInDefaultViewport.findIndex(
                            ({bitmask}) => (bitmask & (1 << alertIdx)) !== 0
                        ),
                        alertLength: countIndices(
                            periodsInDefaultViewport,
                            ({bitmask}) => (bitmask & (1 << alertIdx)) !== 0
                        )
                    })
                )
                .map((e) => ({
                    ...e,
                    // alertLength: (e.lastAppearance >= 0 && e.firstAppearance >= 0)
                    //     ? e.lastAppearance - e.firstAppearance
                    //     : -1,
                    firstAppearance: e.firstAppearance < 0 ? Infinity : e.firstAppearance,
                }))
                .sort((a, b) => {
                    if (a.alertLength !== b.alertLength) {
                        return b.alertLength - a.alertLength;
                    }
                    
                    if (a.firstAppearance !== b.firstAppearance) {
                        return a.firstAppearance - b.firstAppearance;                        
                    }

                    return a.alertIdx < b.alertIdx
                        ? -1
                        : a.alertIdx > b.alertIdx
                        ? 1
                        : 0;
                })
            },
        [periods, defaultViewStart, defaultViewEnd, alertMetadata]
    );

    const moveBack = React.useCallback(
        () => {
            if (!viewportEnd) return;
            // TODO limit
            setViewportStart(viewportStart.minus({ hours: 6 }))
            setViewportEnd(viewportEnd.minus({ hours: 6 }))
        }, [viewportStart, viewportEnd, setViewportStart, setViewportEnd]
    );

    const moveForward = React.useCallback(
        () => {
            if (!viewportEnd) return;
            // TODO limit
            setViewportStart(viewportStart.plus({ hours: 6 }))
            setViewportEnd(viewportEnd.plus({ hours: 6 }))
        }, [viewportStart, viewportEnd, setViewportStart, setViewportEnd]
    );

    const stillLoading = !orderOfAppearance || !periodsInViewport || !viewportEnd || viewportEndUnixtime === undefined;

    return <div className="alert-gant">
        {/* TODO actual images for the buttons */}
        <button className="move-viewport" onClick={moveBack}>&lt;</button>
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
        </div>
        <button className="move-viewport" onClick={moveForward}>&gt;</button>
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
        if (
            (viewportStart <= period.start && period.start < viewportEnd)
            || (viewportStart < period.end && period.end <= viewportEnd)
        ) {
            yield period;
        }
    }
}

function countIndices<T>(
    arr: T[],
    predicate: (t: T) => boolean
) {
    let sum = 0;

    for (let i = 0; i < arr.length; i++) {
        if (predicate(arr[i] as T)) {
            sum++;
        }
    }

    return sum;
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
