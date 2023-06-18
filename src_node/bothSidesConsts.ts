import { DateTime } from "luxon";


export const GANT_HOURLINE_INTERVAL = 6; // spacing between hourlines, in hours

export function alertGantMinMaxLimits(nowInJerusalem: DateTime) {
    const defaultViewStart = nowInJerusalem
        .set({
            hour: nowInJerusalem.hour - (nowInJerusalem.hour % GANT_HOURLINE_INTERVAL),
            minute: 0,
            second: 0,
            millisecond: 0
        })
        .minus({ hours: GANT_HOURLINE_INTERVAL / 2 });
    const minimumStartPosition = defaultViewStart.minus({ hours: 2 * 24 });
    const maximumEndPosition = defaultViewStart.plus({ days: 10 });

    return {
        minimumStartPosition, 
        maximumEndPosition,
        defaultViewStart
    };
}
