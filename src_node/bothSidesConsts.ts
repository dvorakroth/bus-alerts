import { DateTime } from "luxon";

// spacing between hourlines, in hours
export const GANT_HOURLINE_INTERVAL = 6;

// the default view is the current time rounded to the hourline interval, minus this:
export const GANT_DEFAULT_START_MINUS = GANT_HOURLINE_INTERVAL / 2;

export function alertGantMinMaxLimits(nowInJerusalem: DateTime) {
    const defaultViewStart = nowInJerusalem
        .set({
            hour: nowInJerusalem.hour - (nowInJerusalem.hour % GANT_HOURLINE_INTERVAL),
            minute: 0,
            second: 0,
            millisecond: 0
        })
        .minus({ hours: GANT_DEFAULT_START_MINUS });
    const minimumStartPosition = defaultViewStart.minus({ hours: 2 * 24 });
    const maximumEndPosition = defaultViewStart.plus({ days: 10 });

    return {
        minimumStartPosition, 
        maximumEndPosition,
        defaultViewStart
    };
}
