import { DateTime } from "luxon";

export function isoToLocal(dateString: string) {
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

export function short_date_hebrew(date: DateTime) {
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
export function short_datetime_hebrew(date: DateTime) {
    // 0שבת 3.7, בשעה 5:07

    return short_date_hebrew(date)
        + " "
        + "בשעה"
        + " " 
        + short_time_hebrew(date);
}