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
