import * as React from 'react';
import { AlertPeriodWithRouteChanges, TranslationObject } from '../protocol';
import { DateTime, DurationLike } from 'luxon';
import { JERUSALEM_TZ } from '../junkyard/date_utils';
import * as classnames from 'classnames';

interface AlertGantProps {
    periods: AlertPeriodWithRouteChanges[];
    alertMetadata: {id: string; header: TranslationObject}[];
    selectedChangePeriodIdx: number;
}

export function AlertGant({periods, alertMetadata, selectedChangePeriodIdx}: AlertGantProps) {
    const defaultViewStart = DateTime.now().setZone(JERUSALEM_TZ);
    const defaultViewEnd = defaultViewStart.plus({ hours: 24 * 2 }) // + 24h, not +1d, in case there's DST weirdness lol

    const [viewportStart, setViewportStart] = React.useState<DateTime>(defaultViewStart);
    const [viewportEnd, setViewportEnd] = React.useState<DateTime>(defaultViewEnd);

    const viewportStartUnixtime = viewportStart.toSeconds();
    const viewportEndUnixtime = viewportEnd.toSeconds();

    const periodsInViewport = React.useMemo(
        () => [...filterPeriodsForViewport(periods, viewportStartUnixtime, viewportEndUnixtime)],
        [viewportStart.toSeconds(), viewportEnd.toSeconds(), periods]
    );

    const orderOfAppearance = React.useMemo(
        () => {
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
            setViewportStart(viewportStart.minus({ hours: 3 }))
            setViewportEnd(viewportEnd.minus({ hours: 3 }))
        }, [viewportStart, viewportEnd, setViewportStart, setViewportEnd]
    );

    const moveForward = React.useCallback(
        () => {
            setViewportStart(viewportStart.plus({ hours: 3 }))
            setViewportEnd(viewportEnd.plus({ hours: 3 }))
        }, [viewportStart, viewportEnd, setViewportStart, setViewportEnd]
    );

    return <div className="alert-gant">
        {/* TODO actual images for the buttons */}
        <button className="move-viewport" onClick={moveBack}>&lt;</button>
        <div className="gant-area">
            <ul className="alert-gant-rows">
                {orderOfAppearance.map(
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
                {/* TODO make the lines start at specific hours, not just viewportStart */}
                {[...dateRange(viewportStart, viewportEnd, {hours: 6})].map(
                    date =>
                        <div 
                            className="hourline"
                            style={{
                                right: (100 * (Math.max(date.toSeconds(), viewportStartUnixtime) - viewportStartUnixtime) / (viewportEndUnixtime - viewportStartUnixtime)) + "%",
                            }}
                        >
                            <span className="datelabel">
                                {/* TODO actual text */}
                                יום ז'
                                <br/>
                                17:00
                            </span>
                        </div>
                )}
            </div>
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
                        right: (100 * (Math.max(start, viewportStart) - viewportStart) / (viewportEnd - viewportStart)) + "%",
                        width: (100 * (Math.min(end, viewportEnd) - Math.max(start, viewportStart)) / (viewportEnd - viewportStart)) + "%"
                    }}>
                    {alert.header.he ?? ""}
                </div>
        )}
    </li>;
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

function *dateRange(
    start: DateTime,
    endInclusive: DateTime,
    increment: DurationLike
) {
    let d = start;
    do {
        yield d;
        d = d.plus(increment);
    } while(d.toSeconds() <= endInclusive.toSeconds());
}
