import { DateTime } from "luxon";
import { JERUSALEM_TZ, arraysDeepEqual, parseUnixtimeIntoJerusalemTz } from "./loaderJunkyard.js";
import { PrettyActivePeriod } from "../dbTypes.js";
import { copySortAndUnique } from "../generalJunkyard.js";

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

type DateTimePair = [DateTime|null, DateTime|null];

export function splitActivePeriodToSubperiods(
    startUnixtime: number|null,
    endUnixtime: number|null
): (DateTimePair|null)[] {
    /**
     * Given two unix times for an alert's active_period, returns
     * that period split up into 3 parts:
     *     start_remainder: a period of less than 24 hours, that ends midnight
     *     middle_part: a period of several days, midnight-to-midnight
     *     end_remainder: a period of less than 24 hours, that starts midnight
     * 
     * Each of these parts can be None, or a sub-list with two datetimes in Asia/Jerusalem.
     * Either of the two dates in the list could also be None.
     *
     * A part that is None should be ignored;
     * A start time that is None is basically negative infinity;
     * An end time that is None is, conversely, infinity;
     * If all parts are None, that means no time bounds were given;
     *         
     * This is done so we can search for services+stoptimes that are active at
     * a certain active_period because gtfs services are hard
     */

    let startLocal = startUnixtime
        ? DateTime.fromSeconds(startUnixtime, {zone: JERUSALEM_TZ})
        : null;
    let endLocal = endUnixtime
        ? DateTime.fromSeconds(endUnixtime, {zone: JERUSALEM_TZ})
        : null;

    const startsMidnight = startLocal && startLocal.toFormat("HH:mm") === "00:00";
    const endsMidnight   = endLocal   &&   endLocal.toFormat("HH:mm") === "00:00";

    // easy case: all within a single day
    if (startLocal && endLocal && startLocal.toFormat("yyyy-MM-dd") === endLocal.toFormat("yyyy-MM-dd")) {
        return [[startLocal, endLocal], null, null]; // do i really need those nulls??? who knows!!
    }

    let startRemainder:DateTimePair|null = null;
    let middlePart:DateTimePair|null = null;
    let endRemainder:DateTimePair|null = null;

    if (startLocal && !startsMidnight) {
        const midnightAfterStartDay = startLocal
            .set({
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            })
            .plus({days: 1});
        startRemainder = [startLocal, midnightAfterStartDay];
        startLocal = midnightAfterStartDay;
    }

    if (endLocal && !endsMidnight) {
        const midnightBeforeEndDay = endLocal
            .set({
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            });
        endRemainder = [midnightBeforeEndDay, endLocal];
        endLocal = midnightBeforeEndDay;
    }

    if (startLocal?.toSeconds() !== endLocal?.toSeconds()) {
        middlePart = [startLocal, endLocal];
    }

    return [startRemainder, middlePart, endRemainder];
}
