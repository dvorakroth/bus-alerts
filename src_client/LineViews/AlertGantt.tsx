import * as React from 'react';
import { AlertMinimal, AlertPeriodWithRouteChanges, USE_CASES } from '../protocol';
import { DateTime } from 'luxon';
import { JERUSALEM_TZ, dateRange, findClosestRoundHour, findNextRoundHour, findPreviousRoundHour, short_date_hebrew, short_time_hebrew } from '../junkyard/date_utils';
import * as classnames from 'classnames';
import useResizeObserver from 'use-resize-observer';
import { GANTT_DEFAULT_START_MINUS, GANTT_DEFAULT_ZOOM_LEVEL, GANTT_HOURLINE_INTERVAL, GANTT_PIXELS_PER_HOUR, alertGanttMinMaxLimits } from '../bothSides';

type AlertAppearance = {
    alertIdx: number;
    alert: AlertMinimal;
    firstAppearance: number;
    totalLength: number;
};

interface AlertGanttProps {
    periods: AlertPeriodWithRouteChanges[];
    alertMetadata: AlertMinimal[];
    selectedChangePeriodIdx: number;
    onNewChangePeriodSelected: (idx: number) => void;
}

export function AlertGantt({
    periods,
    alertMetadata,
    selectedChangePeriodIdx,
    onNewChangePeriodSelected
}: AlertGanttProps) {
    // TODO maybe remove the text on the alert items themselves?
    //      the text is so Bad that most of the time it just says
    //      something useless like "Tel Av..." or "Kiryat Ono, ..."

    const [zoomLevel, setZoomLevel] = React.useState(GANTT_DEFAULT_ZOOM_LEVEL);
    const hourlineInterval = GANTT_HOURLINE_INTERVAL[zoomLevel];
    const startMinus = GANTT_DEFAULT_START_MINUS[zoomLevel];
    const pixelsPerHour = GANTT_PIXELS_PER_HOUR[zoomLevel];

    if (hourlineInterval === undefined || startMinus === undefined || pixelsPerHour === undefined) {
        throw new Error("invalid zoom level " + zoomLevel);
    }

    const {ref: ganttAreaRef, width: ganttWidthPx} = useResizeObserver();
    const ganttWidthSeconds = ganttWidthPx === undefined
        ? undefined
        : ganttWidthPx / pixelsPerHour * 3600;
    
    const nowInJerusalem = DateTime.now().setZone(JERUSALEM_TZ);

    const {
        defaultViewStart, minimumStartPosition, maximumEndPosition
    } = alertGanttMinMaxLimits(nowInJerusalem, zoomLevel);
    const defaultViewEnd = ganttWidthSeconds === undefined
        ? undefined
        : defaultViewStart.plus({ seconds: ganttWidthSeconds });

    const [viewportStart, setViewportStart] = React.useState<DateTime>(defaultViewStart);
    const [viewportEnd, setViewportEnd] = React.useState<DateTime|undefined>(defaultViewEnd);

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

    const [prevGanttWidthSeconds, setPrevGanttWidthSeconds] = React.useState<number|undefined>(ganttWidthSeconds);
    if (ganttWidthSeconds !== prevGanttWidthSeconds) {
        setPrevGanttWidthSeconds(ganttWidthSeconds);

        if (ganttWidthSeconds !== undefined) {
            if (!viewportEnd || viewportEndUnixtime === undefined) {
                setViewportEnd(defaultViewEnd)
            } else {
                let pointToKeepInView: number|null = null;

                const selectedPeriod = periodsInViewport?.find(p => p.originalIndex === selectedChangePeriodIdx);
                const nowUnixtime = nowInJerusalem.toSeconds();
                if (selectedPeriod) {
                    // if the currently selected period was in view, keep it in view

                    const startIsInView = selectedPeriod.start >= viewportStartUnixtime;
                    const endIsInView = selectedPeriod.end <= viewportEndUnixtime;

                    if (startIsInView && !endIsInView) {
                        pointToKeepInView = selectedPeriod.start;
                    } else if (!startIsInView && endIsInView) {
                        pointToKeepInView = selectedPeriod.end;
                    } else if (startIsInView && endIsInView) {
                        // if a period was fully in view, the now-hourline might be inside of it
                        if (selectedPeriod.start <= nowUnixtime && nowUnixtime <= selectedPeriod.end) {
                            pointToKeepInView = nowUnixtime;
                        } else {
                            pointToKeepInView = Math.round((selectedPeriod.start + selectedPeriod.end) / 2);
                        }
                    } else {
                        // the period is in view, but both its bounds are out of view,
                        // so we should just.... do nothing lol; let the next two rules decide
                    }
                }
                
                if (pointToKeepInView === null) {
                    if (viewportStartUnixtime <= nowUnixtime && nowUnixtime <= viewportEndUnixtime) {
                        // keep the now-hourline visible if it was visible before
                        pointToKeepInView = nowUnixtime;
                    } else {
                        // otherwise, just keep the center of the previous view
                        pointToKeepInView = Math.round(
                            (viewportStartUnixtime + viewportEndUnixtime) / 2
                        );
                    }
                }
                

                let [aimingForStart, isBefore] = findClosestRoundHour(
                    DateTime.fromSeconds(
                        pointToKeepInView - Math.round(ganttWidthSeconds / 2),
                        {zone: JERUSALEM_TZ}
                    ),
                    hourlineInterval
                );
                if (isBefore) {
                    aimingForStart = aimingForStart.plus({ hours: startMinus });
                } else {
                    aimingForStart = aimingForStart.minus({ hours: startMinus });
                }

                let aimingForEnd = aimingForStart.plus({
                    seconds: ganttWidthSeconds
                });

                // let aimingForStart = viewportStart;
                // let aimingForEnd = viewportStart.plus({seconds: ganttWidthSeconds});

                if (aimingForEnd.toSeconds() > maximumEndPosition.toSeconds()) {
                    aimingForEnd = maximumEndPosition;
                    aimingForStart = maximumEndPosition.minus({seconds: ganttWidthSeconds});
                }

                if (aimingForStart.toSeconds() < minimumStartPosition.toSeconds()) {
                    aimingForStart = minimumStartPosition;
                    aimingForEnd = minimumStartPosition.plus({seconds: ganttWidthSeconds});
                }

                setViewportStart(aimingForStart);
                setViewportEnd(aimingForEnd);
            }
        }
    }

    const orderOfAppearance = React.useMemo(
        () => {
            if (!defaultViewEnd) return;

            const periodsInDefaultViewport = [...filterPeriodsForViewport(
                periods,
                defaultViewStart.toSeconds(),
                defaultViewEnd.toSeconds()
            )];

            const allPossibleViewablePeriods = [...filterPeriodsForViewport(
                periods,
                minimumStartPosition.toSeconds(),
                maximumEndPosition.toSeconds()
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
                        ),
                        doesAppearAtAll: allPossibleViewablePeriods.findIndex(
                            ({bitmask}) => (bitmask & (1 << alertIdx)) !== 0
                        ) >= 0
                    })
                )
                .filter(e => e.doesAppearAtAll)
                .map(e => ({
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
            
            return order;
        },
        [!defaultViewEnd, periods, alertMetadata]
    );

    React.useEffect(
        () => {
            if (
                !defaultViewEnd
                || !periodsInViewport
                || !ganttWidthSeconds
            ) {
                return;
            }

            if (periodsInViewport.find(p => p.originalIndex === selectedChangePeriodIdx)) {
                return;
            }

            const selectedPeriod = periods[selectedChangePeriodIdx];
            if (!selectedPeriod) return;

            if (
                selectedPeriod.end >= defaultViewStart.toSeconds()
                &&
                selectedPeriod.start <= defaultViewEnd.toSeconds()
            ) {
                setViewportStart(defaultViewStart);
                setViewportEnd(defaultViewEnd);
            } else {
                const [aimingForStart, aimingForEnd] = viewForPeriod(
                    selectedPeriod,
                    minimumStartPosition,
                    maximumEndPosition,
                    ganttWidthSeconds,
                    hourlineInterval,
                    startMinus
                );

                setViewportStart(aimingForStart);
                setViewportEnd(aimingForEnd);
            }
        },
        [selectedChangePeriodIdx, periods, alertMetadata]
    );

    const hasAlertsBefore = periods.filter(
        p => minimumStartPosition.toSeconds() < p.end &&  p.end <= viewportStartUnixtime
        && p.bitmask !== 0
    ).length !== 0;

    const hasAlertsAfter = viewportEndUnixtime && periods.filter(
        p => maximumEndPosition.toSeconds() > p.start && p.start >= viewportEndUnixtime
        && p.bitmask !== 0
    ).length !== 0;

    const canMoveBack = viewportStartUnixtime > minimumStartPosition.toSeconds();
    const canMoveForward = viewportEndUnixtime && viewportEndUnixtime < maximumEndPosition.toSeconds();

    const moveBack = React.useCallback(
        () => {
            if (!viewportEnd || !canMoveBack) return;

            setViewportStart(viewportStart.minus({ hours: hourlineInterval }))
            setViewportEnd(viewportEnd.minus({ hours: hourlineInterval }))
        }, [hourlineInterval, viewportStart, viewportEnd, setViewportStart, setViewportEnd, canMoveBack]
    );

    const moveForward = React.useCallback(
        () => {
            if (!viewportEnd || !canMoveForward) return;

            setViewportStart(viewportStart.plus({ hours: hourlineInterval }))
            setViewportEnd(viewportEnd.plus({ hours: hourlineInterval }))
        }, [hourlineInterval, viewportStart, viewportEnd, setViewportStart, setViewportEnd, canMoveForward]
    );

    const scrollToViewPeriod = React.useCallback(
        (period: AlertPeriodWithRouteChanges, atEnd = false) => {
            if (!ganttWidthSeconds) return;

            const [aimingForStart, aimingForEnd] = viewForPeriod(
                period,
                minimumStartPosition,
                maximumEndPosition,
                ganttWidthSeconds,
                hourlineInterval,
                startMinus,
                atEnd
            );

            setViewportStart(aimingForStart);
            setViewportEnd(aimingForEnd);
        }, [
            setViewportStart,
            setViewportEnd,
            minimumStartPosition,
            maximumEndPosition,
            ganttWidthSeconds
        ]
    )

    const goToPreviousAlert = React.useCallback(
        () => {
            if (!hasAlertsBefore) return;

            for (let i = periods.length; i >= 0; i--) {
                // find the last alertful period that ends before the
                // current **VIEW** starts (not currently-selected period!)

                // this is because the "there's more -->" buttons appear
                // whenever there's something OUT OF VIEW, unrelated to what
                // the currently-selected period is

                const period = periods[i];
                if (!period) continue;
                if (period.end > viewportStartUnixtime) continue;

                if (period?.bitmask !== 0) {
                    // onNewChangePeriodSelected(i);
                    scrollToViewPeriod(period);
                    return;
                }
            }
        }, [hasAlertsBefore, viewportStartUnixtime, scrollToViewPeriod]
    );

    const goToNextAlert = React.useCallback(
        () => {
            if (!hasAlertsAfter) return;
            if (!viewportEndUnixtime) return;

            for (let i = 0; i < periods.length; i++) {
                // find the first alertful period that starts after the
                // current **VIEW** ends (not currently-selected period!)

                // this is because the "there's more -->" buttons appear
                // whenever there's something OUT OF VIEW, unrelated to what
                // the currently-selected period is

                const period = periods[i];
                if (!period) continue;
                if (period.start < viewportEndUnixtime) continue;

                if (period?.bitmask !== 0) {
                    // onNewChangePeriodSelected(i);
                    scrollToViewPeriod(period, true);
                    return;
                }
            }
        }, [hasAlertsAfter, viewportEndUnixtime, scrollToViewPeriod]
    );

    const clickableAreaOnClick = React.useCallback(
        ({currentTarget}: React.MouseEvent) => {
            const idxStr = currentTarget.getAttribute("data-idx");
            if (!idxStr) return;

            const idx = parseInt(idxStr);
            if (isNaN(idx)) return;

            onNewChangePeriodSelected(idx);
        },
        [onNewChangePeriodSelected]
    );

    const toggleZoom = React.useCallback(
        () => {
            // TODO uhhh,,, something about the positioning i guess?
            //      i think this should follow either the center of the view,
            //      (i.e. keep the center centered), or keep the currently
            //      selected period in the view? idk

            // TODO if zooming out takes the viewportStart past the minimum,
            //      then set the view bounds to the minimum
            setZoomLevel(1 - zoomLevel);
        }, [setZoomLevel, zoomLevel]
    );

    const stillLoading = !orderOfAppearance || !periodsInViewport || !viewportEnd || viewportEndUnixtime === undefined;

    return <div className="alert-gantt-container">
        <div className="alert-gantt">
            <button className="move-viewport back" onClick={moveBack} disabled={!canMoveBack} aria-label="אחורה"></button>
            <div className="gantt-area" ref={ganttAreaRef}>
                <ul className="alert-gantt-rows">
                    {!stillLoading && orderOfAppearance?.map(
                        ({alertIdx, alert}) =>
                            <AlertGanttRow
                                key={alert.id}
                                alertIdx={alertIdx}
                                alert={alert}
                                periodsInViewport={periodsInViewport}
                                viewportStart={viewportStartUnixtime}
                                viewportEnd={viewportEndUnixtime}
                            />
                    )}
                </ul>
                <div className="alert-gantt-hourlines">
                    {!stillLoading && [...dateRange(findNextRoundHour(viewportStart, hourlineInterval, 0), viewportEnd, {hours: hourlineInterval})].map(
                        ({prevDate, date}, idx) =>
                            <div 
                                className="hourline"
                                style={{
                                    right: rightPercentageForUnixtime(date.toSeconds(), viewportStartUnixtime, viewportEndUnixtime)
                                }}
                                key={idx}
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
                <div className="alert-gantt-clickable-areas">
                    {!stillLoading && periodsInViewport.map(
                        ({start, end, originalIndex}) => <button
                            className={classnames(
                                "period",
                                {"start-invisible": start < viewportStartUnixtime},
                                {"end-invisible": end > viewportEndUnixtime},
                                {"selected": originalIndex === selectedChangePeriodIdx}
                            )}
                            key={originalIndex}
                            data-idx={originalIndex}
                            onClick={clickableAreaOnClick}
                            style={{
                                right: `calc(${rightPercentageForUnixtime(start, viewportStartUnixtime, viewportEndUnixtime)} - 1px)`,
                                width: `calc(2px + ${widthPercentageForUnixtime(start, end, viewportStartUnixtime, viewportEndUnixtime)})`
                                }}
                        ></button>
                    )}
                </div>
                {/* TODO jump to today (back to default view) button? */}
            </div>
            <button className="move-viewport forwards" onClick={moveForward} disabled={!canMoveForward} aria-label="קדימה"></button>
        </div>
        <div className="hints-container">
            {!hasAlertsBefore ? null
                : <button className="hint-more-before" onClick={goToPreviousAlert}>→ יש עוד</button>
            }
            {!hasAlertsAfter ? null
                : <button className="hint-more-after" onClick={goToNextAlert}>יש עוד ←</button>
            }
        </div>
        <button onClick={toggleZoom}>Zoom in/out lol</button> {/* TODO lol */}
    </div>
}

interface AlertGanttRowProps {
    alertIdx: number;
    periodsInViewport: AlertPeriodWithRouteChanges[];
    alert: AlertMinimal;
    viewportStart: number;
    viewportEnd: number;
}

function AlertGanttRow({
    alertIdx,
    periodsInViewport,
    alert,
    viewportStart,
    viewportEnd
}: AlertGanttRowProps) {
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
                        "alert-gantt-item",
                        {"start-invisible": start < viewportStart},
                        {"end-invisible": end > viewportEnd},
                        {"less-important": alert.use_case === USE_CASES.SCHEDULE_CHANGES}
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
    let i = 0;

    for (const period of periods) {
        if (period.start < viewportEnd && viewportStart < period.end) {
            yield {
                ...period,
                originalIndex: i
            };
        }
        i++;
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

function viewForPeriod(
    period: AlertPeriodWithRouteChanges,
    minimumStartPosition: DateTime,
    maximumEndPosition: DateTime,
    ganttWidthSeconds: number,
    hourlineInterval: number,
    startMinus: number,
    viewAtEnd = false
): [DateTime, DateTime] {
    let aimingForStart, aimingForEnd;

    if (!viewAtEnd) {
        aimingForStart = findPreviousRoundHour(
            DateTime.fromSeconds(period.start, {zone: JERUSALEM_TZ}),
            hourlineInterval
        ).minus({hours: startMinus});
        aimingForEnd = aimingForStart.plus({seconds: ganttWidthSeconds});
    } else {
        const bestStart = Math.min(
            period.end + (
                hourlineInterval + startMinus
            ) * 3600,
            period.start + ganttWidthSeconds/* - (
                (hourlineInterval + startMinus) * 3600
            )*/
        ) - ganttWidthSeconds;

        aimingForStart = findPreviousRoundHour(
            DateTime.fromSeconds(bestStart, {zone: JERUSALEM_TZ}),
            hourlineInterval
        ).minus({hours: startMinus});
        aimingForEnd = aimingForStart.plus({seconds: ganttWidthSeconds})
    }

    if (aimingForStart.toSeconds() < minimumStartPosition.toSeconds()) {
        aimingForStart = minimumStartPosition;
        aimingForEnd = aimingForStart.plus({seconds: ganttWidthSeconds})
    }

    if (aimingForEnd.toSeconds() > maximumEndPosition.toSeconds()) {
        aimingForEnd = maximumEndPosition;
        aimingForStart = aimingForEnd.minus({seconds: ganttWidthSeconds});
    }

    return [aimingForStart, aimingForEnd];
}
