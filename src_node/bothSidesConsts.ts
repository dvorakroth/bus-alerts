import { DateTime } from "luxon";

export const GANTT_DEFAULT_ZOOM_LEVEL = 0;

// spacing between hourlines, in hours, per zoom level
export const GANTT_HOURLINE_INTERVAL = [
    6,
    1
];

// the default view is the current time rounded to the hourline interval, minus this:
export const GANTT_DEFAULT_START_MINUS = [
    GANTT_HOURLINE_INTERVAL[0]! / 2,
    GANTT_HOURLINE_INTERVAL[1]! / 2
];

export const GANTT_PIXELS_PER_HOUR = [
    8,
    36
];

export function alertGanttMinMaxLimits(nowInJerusalem: DateTime, zoomLevel: number) {
    const hourlineInterval = GANTT_HOURLINE_INTERVAL[zoomLevel];
    const startMinus = GANTT_DEFAULT_START_MINUS[zoomLevel];

    if (hourlineInterval === undefined || startMinus === undefined) {
        throw new Error("invalid zoom level " + zoomLevel);
    }

    const defaultViewStart = computeDefaultViewStart(nowInJerusalem, zoomLevel);
    
    const defaultZoom0View = zoomLevel === 0
        ? defaultViewStart
        : computeDefaultViewStart(nowInJerusalem, 0);
    
    const minimumStartPosition = defaultZoom0View.minus({ hours: 2 * 24 });
    const maximumEndPosition = defaultZoom0View.plus({ days: 10 });

    return {
        minimumStartPosition, 
        maximumEndPosition,
        defaultViewStart
    };
}

function computeDefaultViewStart(nowInJerusalem: DateTime, zoomLevel: number) {
    const hourlineInterval = GANTT_HOURLINE_INTERVAL[zoomLevel];
    const startMinus = GANTT_DEFAULT_START_MINUS[zoomLevel];

    if (hourlineInterval === undefined || startMinus === undefined) {
        throw new Error("invalid zoom level " + zoomLevel);
    }

    return nowInJerusalem
        .set({
            hour: nowInJerusalem.hour - (nowInJerusalem.hour % hourlineInterval),
            minute: 0,
            second: 0,
            millisecond: 0
        })
        .minus({ hours: startMinus });
}
