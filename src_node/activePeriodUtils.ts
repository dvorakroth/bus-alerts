import { DateTime } from "luxon";
import { JERUSALEM_TZ, arraysDeepEqual, copySortAndUnique, parseUnixtimeIntoJerusalemTz } from "./junkyard.js";
import { PrettyActivePeriod } from "./dbTypes.js";

export function consolidateActivePeriods(activePeriods: [number|null, number|null][]) {
    const result: PrettyActivePeriod[] = [];

    // "yyyy-MM-dd" -> [["HH:mm", "HH:mm", doesEndNextDay], ...]
    const mightNeedConsolidation: {[key: string]: [string, string, boolean][]} = {};

    for (const [startUnixTime, endUnixTime] of activePeriods) {
        const startTime = parseUnixtimeIntoJerusalemTz(startUnixTime);
        const endTime   = parseUnixtimeIntoJerusalemTz(endUnixTime);

        if (!startTime || !endTime) {
            // an infinite range can't be consolidated
            result.push({
                simple: [startTime?.toISO() || null, endTime?.toISO() || null]
            });
            continue;
        }

        const startDay = startTime.set({
            hour: 0,
            minute: 0,
            second: 0
        });
        const endDay = endTime.set({
            hour: 0,
            minute: 0,
            second: 0
        });

        if (endDay.toSeconds() > startDay.plus({ days: 1 }).toSeconds()) {
            // a range stretching out over more than one calendar day can't be consolidated
            result.push({
                simple: [startTime.toISO(), endTime.toISO()]
            });
            continue;
        }

        // now we're in an interesting case: a period stretching over 1-2 calendar days
        const startDayKey = startDay.toFormat("yyyy-MM-dd");
        if (!mightNeedConsolidation.hasOwnProperty(startDayKey)) {
            mightNeedConsolidation[startDayKey] = [];
        }

        mightNeedConsolidation[startDayKey]?.push(
            [startTime.toFormat("HH:mm"), endTime.toFormat("HH:mm"), endDay.toSeconds() > startDay.toSeconds()]
        )
    }

    // now that we have a list of all the periods we might want to consolidate,
    // do the actual consolidation!

    // (group together any dates that have the same set of hours)

    // each item: {dates: ["yyyy-MM-dd", "yyyy-MM-dd", "yyyy-MM-dd", ...], times: [["HH:mm", "HH:mm", doesEndNextDay], ...]}
    const consolidatedGroups: {dates: string[], times: [string, string, boolean][]}[]= [];

    for (const [date, times] of Object.entries(mightNeedConsolidation)) {
        let found = false;

        for (const {dates: otherDates, times: otherTimes} of consolidatedGroups) {
            if (arraysDeepEqual(times, otherTimes)) {
                // found another consolidated group with these same times!
                found = true;
                otherDates.push(date);
                break;
            }
        }

        if (!found) {
            // no other dates with these same times encountered yet, so make a new group
            consolidatedGroups.push({
                dates: [date],
                times
            });
        }
    }

    // and finally, convert it to strings that will be easier for the client to handle
    
    for (const {dates, times} of consolidatedGroups) {
        // but WAIT there's MORE CONSOLIDATION TO DO!!! how fun!
        const consolidatedDates = consolidateDateList(dates);

        times.sort(
            (a, b) => {
                for (let i = 0; i < a.length && i < b.length; i++) {
                    // did you know? "false" < "true"
                    const aEl = ""+(a[i] ?? "");
                    const bEl = ""+(b[i] ?? "");

                    if (aEl === bEl) {
                        continue;
                    }

                    if (aEl < bEl) {
                        return -1;
                    } else if (aEl > bEl) {
                        return 1;
                    }
                }

                return 0;
            }
        );

        const uniqueTimes = times.filter(
            (value, idx, arr) => !idx || !arraysDeepEqual(value, arr[idx - 1]??[])
        );

        result.push({
            dates: consolidatedDates,
            times: uniqueTimes
        });
    }
    
    return result;
}

function consolidateDateList(dateList: string[]) {
    // consolidate consecutive days into nice readable solid ranges

    dateList = copySortAndUnique(dateList);

    const result: (string|[string, string])[] = [];
    let currentRangeStart: string|null = null;
    let currentRangeEnd: string|null = null;
    let currentRangeEndDatetime: DateTime|null = null;

    for (const date of dateList) {
        const currentDatetime = DateTime.fromFormat(date, "yyyy-MM-dd", {zone: JERUSALEM_TZ});

        if (currentRangeStart === null || currentRangeEnd === null || currentRangeEndDatetime === null) {
            currentRangeStart = date;
            currentRangeEnd = date;
            currentRangeEndDatetime = currentDatetime;
        } else if (currentDatetime.toSeconds() === currentRangeEndDatetime.plus({days: 1}).toSeconds()) {
            // we went forward by one day, so lengthen the current range
            currentRangeEnd = date;
            currentRangeEndDatetime = currentDatetime;
        } else {
            // we went forward by more than one day, so start a new range
            if (currentRangeStart === currentRangeEnd) {
                result.push(currentRangeStart);
            } else {
                result.push([currentRangeStart, currentRangeEnd]);
            }

            currentRangeStart = date;
            currentRangeEnd = date;
            currentRangeEndDatetime = currentDatetime;
        }
    }

    // clean up any leftovers
    if (currentRangeStart !== null && currentRangeEnd !== null) {
        if (currentRangeStart === currentRangeEnd) {
            result.push(currentRangeStart);
        } else {
            result.push([currentRangeStart, currentRangeEnd]);
        }
    }

    return result;
}
