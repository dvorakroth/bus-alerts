import { DateTime, DurationLike } from "luxon";

export function isoToLocal(dateString: string|null) {
    if (!dateString) {
        return null;
    } else {
        return DateTime.fromISO(dateString, {zone: JERUSALEM_TZ});
    }
}

export const DOW_SHORT = [
    null,
    'ב׳',
    'ג׳',
    'ד׳',
    'ה׳',
    'ו׳',
    'שבת',
    'א׳'
];

export function short_date_hebrew(date: DateTime|null) {
    if (!date) return null;
    
    // ד׳ 22.12
    // שבת 3.7
    // etc
    return DOW_SHORT[date.weekday] +
        " " +
        date.day + "." + date.month;
}

export const JERUSALEM_TZ = 'Asia/Jerusalem';

export function make_sure_two_digits(n: number) {
    if (0 <= n && n <= 9) {
        return "0" + n;
    } else {
        return "" + n;
    }
}
export function short_time_hebrew(date: DateTime) {
    return make_sure_two_digits(date.hour)
        + ":" 
        + make_sure_two_digits(date.minute);
}
export function short_datetime_hebrew(date: DateTime|null) {
    if (!date) return null;

    // 0שבת 3.7, בשעה 5:07

    return short_date_hebrew(date)
        + " "
        + "בשעה"
        + " " 
        + short_time_hebrew(date);
}

export function *dateRange(
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

export function findNextRoundHour(
    start: DateTime,
    modulo: number,
    moduloEquals = 0
) {
    modulo = Math.max(1, Math.min(24, Math.floor(modulo)));
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

export function findPreviousRoundHour(
    start: DateTime,
    modulo: number,
    moduloEquals = 0
) {
    modulo = Math.max(1, Math.min(24, Math.floor(modulo)));
    moduloEquals = Math.max(0, Math.min(modulo - 1, moduloEquals));

    let d = start.set({
        minute: 0,
        second: 0,
        millisecond: 0
    });

    while (d.hour % modulo !== moduloEquals) {
        d = d.minus({hours: 1});
    }

    return d;
}

export function findClosestRoundHour(
    start: DateTime,
    modulo: number,
    moduloEquals = 0
): [DateTime, boolean] {
    // sure, this could be done more efficiently, but where's the fun in that?

    const before = findPreviousRoundHour(start, modulo, moduloEquals);
    const after = findNextRoundHour(start, modulo, moduloEquals);

    const startUnixtime = start.toSeconds();
    const beforeDistance = Math.abs(startUnixtime - before.toSeconds());
    const afterDistance = Math.abs(startUnixtime - after.toSeconds());

    if (beforeDistance <= afterDistance) {
        return [before, true];
    } else {
        return [after, false];
    }
}
