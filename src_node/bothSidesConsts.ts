import { DateTime } from "luxon";

// spacing between hourlines, in hours
export const GANTT_HOURLINE_INTERVAL = 6;

// the default view is the current time rounded to the hourline interval, minus this:
export const GANTT_DEFAULT_START_MINUS = GANTT_HOURLINE_INTERVAL / 2;

export function alertGanttMinMaxLimits(nowInJerusalem: DateTime) {
    const defaultViewStart = nowInJerusalem
        .set({
            hour: nowInJerusalem.hour - (nowInJerusalem.hour % GANTT_HOURLINE_INTERVAL),
            minute: 0,
            second: 0,
            millisecond: 0
        })
        .minus({ hours: GANTT_DEFAULT_START_MINUS });
    const minimumStartPosition = defaultViewStart.minus({ hours: 2 * 24 });
    const maximumEndPosition = defaultViewStart.plus({ days: 10 });

    return {
        minimumStartPosition, 
        maximumEndPosition,
        defaultViewStart
    };
}
