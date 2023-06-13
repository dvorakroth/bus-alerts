import { DateTime } from "luxon";

export function copySortAndUnique<T = number|string>(arr: T[]) {
    return [...arr]
        .sort()
        .filter((item, idx, arr) => !idx || item !== arr[idx - 1]);
}

export function inPlaceSortAndUnique<T = number|string>(arr: T[]): T[] {
    arr.sort();

    let i = 1; // not 0! because we'll never delete the 0th element
    while (i < arr.length) {
        if (arr[i - 1] === arr[i]) {
            arr.splice(i, 1);
        } else {
            i += 1;
        }
    }

    return arr;
}

export function inPlaceSortAndUniqueCustom<T>(
    arr: T[],
    comparator: (a: T, b: T) => number,
    isEqual: undefined|((a: T, b: T) => boolean) = undefined
) {
    const _isEqual = isEqual
        ? isEqual
        : (a: T, b: T) => (comparator(a, b) === 0);
    
    arr.sort(comparator);

    let i = 1; // not 0! because we'll never delete the 0th element
    while (i < arr.length) {
        if (_isEqual(arr[i - 1] as T, arr[i] as T)) {
            arr.splice(i, 1);
        } else {
            i += 1;
        }
    }

    return arr;
}

const IS_DIGIT_REGEX = /^\d+$/g;
export function isDigit(s: string) {
    return !!s.match(IS_DIGIT_REGEX);
}

export function compareTuple<S, T>(
    a: [S, T],
    b: [S, T]
): number {
    if (a[0] !== b[0]) {
        return (a[0] < b[0]) ? -1 : 1;
    }

    if (a[1] === b[1]) {
        return 0;
    }

    return (a[1] < b[1]) ? -1 : 1;
}

export function compareNple(
    a: readonly any[],
    b: readonly any[]
): number {
    for(let i = 0; i < a.length && i < b.length; i++) {
        const aEl = a[i];
        const bEl = b[i];

        if (aEl === bEl) continue;
        
        if (aEl < bEl) return -1;
        if (aEl > bEl) return 1;
    }

    return 0;
}

export function lineNumberForSorting(lineNumber: string): [number, string] {
    for (const s of lineNumber.split(/\s+/)) {
        if (isDigit(s)) {
            return [parseInt(s), lineNumber];
        }
    }

    return [-1, lineNumber];
}

export const JERUSALEM_TZ = "Asia/Jerusalem";

export function parseUnixtimeIntoJerusalemTz(unixtime: number|null): DateTime|null {
    if (!unixtime) {
        // both 0 and null
        return null;
    } else {
        return DateTime.fromSeconds(unixtime, {zone: JERUSALEM_TZ});
    }
}

export const GTFS_CALENDAR_DOW = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

// cursed and bad and stupid and of course this is what the mot gives us
const STOP_DESC_CITY_PATTERN = /עיר: (.*) רציף:/g;

export function extractCityFromStopDesc(stopDesc: string) {
    const firstMatch = stopDesc.matchAll(STOP_DESC_CITY_PATTERN).next().value;
    if (!firstMatch) {
        return "";
    } else {
        return firstMatch[1] as string;
    }
}

export function *zip<S, T>(a: Iterable<S>, b: Iterable<T>): IterableIterator<[S, T]> {
    const aIterator = a[Symbol.iterator]();
    const bIterator = b[Symbol.iterator]();

    do {
        const aNext = aIterator.next();
        const bNext = bIterator.next();

        if (aNext.done || bNext.done) {
            return;
        }

        yield [aNext.value, bNext.value];
    } while(true);
}

export function *chainIterables<S>(...iterables: Iterable<S>[]) {
    for (const iterable of iterables) {
        for (const item of iterable) {
            yield item;
        }
    }
}

export function minimumDate(dateList: Iterable<DateTime>) {
    let minimum: DateTime|null = null;

    for (const d of dateList) {
        if (minimum === null || minimum.toSeconds() > d.toSeconds()) {
            minimum = d;
        }
    }

    return minimum;
}

export function arrayToDict<T>(
    arr: T[],
    keyCallback: (t: T) => string
) {
    return arr.reduce<Record<string, T>>(
        (r, item) => {
            r[keyCallback(item)] = item;
            return r;
        },
        {}
    );
}

export function arrayToDictDifferent<T, V>(
    arr: T[],
    keyCallback: (t: T) => string,
    valueCallback: (t: T) => V
) {
    return arr.reduce<Record<string, V>>(
        (r, item) => {
            r[keyCallback(item)] = valueCallback(item);
            return r;
        },
        {}
    );
}
