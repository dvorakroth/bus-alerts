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
    const [viewportStart, setViewportStart] = React.useState<DateTime>(DateTime.now().setZone(JERUSALEM_TZ));
    const [viewportEnd, setViewportEnd] = React.useState<DateTime>(viewportStart.plus({hours: 24 * 2})); // + 24h, not +1d, in case there's DST weirdness lol

    const viewportStartUnixtime = viewportStart.toSeconds();
    const viewportEndUnixtime = viewportEnd.toSeconds();

    const periodsInViewport = React.useMemo(
        () => periods.filter(
            ({start, end}) =>
                (viewportStartUnixtime <= start && start < viewportEndUnixtime)
                || (viewportStartUnixtime < end && end <= viewportEndUnixtime)
        ),
        [viewportStart.toSeconds(), viewportEnd.toSeconds(), periods]
    );

    const orderOfAppearance = React.useMemo(
        () => alertMetadata
            .map(
                (alert, alertIdx) => ({
                    alertIdx,
                    alert,
                    firstAppearance: periodsInViewport.findIndex(
                        ({bitmask}) => (bitmask & (1 << alertIdx)) !== 0
                    )
                })
            )
            .map((e) => ({
                ...e,
                firstAppearance: e.firstAppearance < 0 ? Infinity : e.firstAppearance
            }))
            .sort((a, b) => a.firstAppearance - b.firstAppearance),
        [periodsInViewport, alertMetadata]
    );

    return <div className="alert-gant">
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

    return <div className="alert-gant-row">
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
