import { DateTime } from "luxon";
import winston from "winston";
import { JERUSALEM_TZ, TIME_FORMAT_ISO_NO_TZ } from "./junkyard.js";

const FILENAME_DATE_REGEX = /(?<year>\d+)\D(?<month>\d+)\D(?<day>\d+)\D(?<hour>\d+)\D(?<minute>\d+)/g;
export function tryParseFilenameDate(filename: string): DateTime|null {
    const match = FILENAME_DATE_REGEX.exec(filename);
    if (!match) {
        winston.debug(`no numbers found in filename: ${filename}`);
        return null;
    }

    const result = DateTime.fromObject(
        // the regex is ~*~perfectly engineered~*~ for the named groups to match lol
        match.groups as any,
        { zone: JERUSALEM_TZ }
    );

    if (!result.isValid) {
        winston.warn(`couldn't make a date out of numbers in filename: ${filename}\n${result.invalidExplanation}`);
        return null;
    } else {
        winston.info(`found date ${result.toFormat(TIME_FORMAT_ISO_NO_TZ)} in filename ${filename}`);
        return result;
    }
}