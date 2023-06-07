import { docopt } from "docopt";
import * as fs from "fs";
import * as ini from "ini";
import * as winston from "winston";
import got from "got";
import pg from "pg";
import Long from "long";
import { DateTime } from "luxon";
import { transit_realtime } from "gtfs-realtime-bindings";

const doc = `Load service alerts from MOT endpoint.

Usage:
    load_service_alerts.py [-h] [-c <file>] [-f <pbfile>]

Options:
    -h, --help                       Show this help message and exit.
    -c <file>, --config <file>       Use the specified configuration file.
    -f <pbfile>, --file <pbfile>     Load from <pbfile> instead of MOT endpoint.
                                     If the filename contains six numbers separated from each other by non-number characters, it'll get treated as a yyyy mm dd hh mm ss date
`;

const LOGGER = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console(),
        // TODO uh,,,, other stuff? idk ask elad lol
    ]
});

async function main() {
    const options = docopt(doc);

    const configPath = options["--config"] || "config.ini";
    const pbFilename = options["--file"] || null;

    const config = ini.parse(fs.readFileSync(configPath, 'utf-8'));

    const gtfsDbUrl = config["psql"]["dsn"];
    const alertsDbUrl = config["psql"]["alerts_db"];

    const motEndpoint = config["service_alerts"]["mot_endpoint"];

    let rawData: Buffer|null = null;
    let TESTING_fake_today: DateTime|null = null;

    if (pbFilename) {
        rawData = fs.readFileSync(pbFilename);
        TESTING_fake_today = tryParseFilenameDate(pbFilename);
    } else {
        const response = await got.get(motEndpoint)
        if (response.statusCode !== 200) {
            LOGGER.error(`received status code ${response.statusCode} ${response.statusMessage} from mot endpoint`);
            process.exit(1);
        }
        rawData = response.rawBody;
    }

    const feed = transit_realtime.FeedMessage.decode(
        new Uint8Array(rawData)
    );

    const gtfsDb = new pg.Client(gtfsDbUrl);
    const alertsDb = new pg.Client(alertsDbUrl);

    try {
        await alertsDb.query("BEGIN");
        loadIsraeliGtfsRt(gtfsDb, alertsDb, feed, TESTING_fake_today);
        await alertsDb.query("COMMIT");
    } catch (err) {
        await alertsDb.query("ROLLBACK");
        throw err;
    }
}

main();

const JERUSALEM_TZ = "Asia/Jerusalem";

const FILENAME_DATE_REGEX = /(?<year>\d+)\D(?<month>\d+)\D(?<day>\d+)\D(?<hour>\d+)\D(?<minute>\d+)\D(?<second>\d+)/g;
function tryParseFilenameDate(filename: string): DateTime|null {
    const match = FILENAME_DATE_REGEX.exec(filename);
    if (!match) {
        return null;
    }

    const result = DateTime.fromObject(
        // the regex is ~*~perfectly engineered~*~ for the named groups to match lol
        match.groups as any,
        { zone: JERUSALEM_TZ }
    );

    if (!result.isValid) {
        LOGGER.warn(`couldn't make a date out of numbers in filename: ${filename}\n${result.invalidExplanation}`);
        return null;
    } else {
        LOGGER.info(`found date ${result.toISO()} in filename ${filename}`);
        return result;
    }
}

const CITY_LIST_PREFIX = "ההודעה רלוונטית לישובים: ";

function loadIsraeliGtfsRt(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    feed: transit_realtime.FeedMessage,
    TESTING_fake_today: DateTime|null
) {
    for (const entity of feed.entity) {
        loadSingleEntity(gtfsDb, alertsDb, entity, TESTING_fake_today);
    }

    LOGGER.info(`Added/updated ${feed.entity.length} alerts`)
    markAlertsDeletedIfNotInList(alertsDb, feed.entity.map(({id}) => id), TESTING_fake_today);
}

function loadSingleEntity(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    entity: transit_realtime.IFeedEntity,
    TESTING_fake_today: DateTime|null
) {
    const id = entity.id;
    const alert = entity.alert||{};

    let firstStartTime: number|null = null;
    let lastEndTime: number|null = null;
    const activePeriods: [number|null, number|null][] = [];

    for (const period of alert?.activePeriod||[]) {
        const start = forceToNumberOrNull(period.start);
        const end = forceToNumberOrNull(period.end);
        activePeriods.push([start, end]);

        if (start) {
            if (firstStartTime === null || firstStartTime > start) {
                firstStartTime = start;
            }
        } else {
            firstStartTime = 0;
        }

        if (end) {
            if (lastEndTime === null || lastEndTime < end) {
                lastEndTime = end;
            }
        } else {
            // no end time = forever (more realistically, until alert is deleted)
            lastEndTime = 7258118400 // 2200-01-01 00:00 UTC
        }
    }

    const consolidatedActivePeriods = consolidateActivePeriods(activePeriods);
    const url = gtfsRtTranslationsToObject(alert.url?.translation || []);
    const header = gtfsRtTranslationsToObject(alert.headerText?.translation || []);
    const description = gtfsRtTranslationsToObject(alert.descriptionText?.translation || []);

    // TODO
}

function forceToNumberOrNull(value: number|Long|null|undefined) {
    // if you're still using my shitty typescript code in the year 2255
    // (when the 2^53-1 unix epoch problem becomes relevant)
    // then, uh,,,,,,,,,, i hope my generation didn't destroy the planet *too* much lol
    if (typeof value === "number") {
        return value;
    } else if (!value) {
        return null;
    } else {
        return value.toNumber();
    }
}

function markAlertsDeletedIfNotInList(
    alertsDb: pg.Client,
    ids: string[],
    TESTING_fake_today: DateTime|null
) {
    // TODO
}

type PrettyActivePeriod = 
    {simple: [string|null, string|null]}
    | {dates: string[], times: [string, string, boolean]};

function consolidateActivePeriods(activePeriods: [number|null, number|null][]) {
    const result: PrettyActivePeriod[] = [];

    // "yyyy_mm_dd" -> [[starttime, endtime, doesEndNextDay], ...]
    const mightNeedConsolidation: {[key: string]: [[number, number], [number, number], boolean][]} = {};

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
        const startDayKey = `${startDay.year}_${startDay.month}_${startDay.day}`;
        if (!mightNeedConsolidation.hasOwnProperty(startDayKey)) {
            mightNeedConsolidation[startDayKey] = [];
        }

        mightNeedConsolidation[startDayKey]?.push(
            [[startTime.hour, startTime.minute], [endTime.hour, endTime.minute], endDay.toSeconds() > startDay.toSeconds()]
        )
    }

    // now that we have a list of all the periods we might want to consolidate,
    // do the actual consolidation!

    // each item: {dates: [[y, m, d], [y, m, d], [y, m, d], ...], times: [[[h, m], [h, m], doesEndNextDay], ...]}
    const consolidatedGroups: {dates: [number, number, number][], times: [[number, number], [number, number], boolean][]}[]= [];

    for (const [dateKey, times] of Object.entries(mightNeedConsolidation)) {
        let found = false;
        const date = dateKey.split("_").map(x => parseInt(x)) as [number, number, number];

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

    // TODO
}

type ArrayOrValue = ArrayOrValue[]|boolean|string|number|null|undefined;

function arraysDeepEqual(a: ArrayOrValue[], b: ArrayOrValue[]): boolean {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length && i < b.length; i++) {
        const aEl = a[i];
        const bEl = b[i];

        if (typeof aEl !== typeof bEl) {
            return false;
        }

        if (aEl === undefined || bEl === undefined
            || aEl === null || bEl === null
            || typeof aEl === "number" || typeof bEl === "number"
            || typeof aEl === "string" || typeof bEl === "string"
            || typeof aEl === "boolean" || typeof bEl === "boolean") {
            if (aEl !== bEl) {
                return false;
            } else {
                continue;
            }
        }

        if (!arraysDeepEqual(a, b)) {
            return false;
        }
    }

    return true;
}

function parseUnixtimeIntoJerusalemTz(unixtime: number|null): DateTime|null {
    if (!unixtime) {
        // both 0 and null
        return null;
    } else {
        return DateTime.fromSeconds(unixtime, {zone: JERUSALEM_TZ});
    }
}

type TranslationObject = {
    he?: string;
    en?: string;
    ar?: string;
    oar?: string;
};

function gtfsRtTranslationsToObject(
    translations: transit_realtime.TranslatedString.ITranslation[]
): TranslationObject {
    const result: any = {};

    for (const {language, text} of translations) {
        if (!language) continue;
        result[language] = text;
    }

    return result;
}

const ALLOWED_UNICODE_REPLACEMENTS = {
    ["\\u2013"]: "\u2013",
    ["\\u2019"]: "\u2019"
} as {[key: string]: string};

function replaceUnicodeFails(s: string) {
    // *sigh*

    let i = 0;

    while (i < s.length) {
        i = s.indexOf("\\u", i);

        if (i < 0 || (i + 6) > s.length) {
            break;
        }

        const escSeq = s.substring(i, i + 6);
        const replacement = ALLOWED_UNICODE_REPLACEMENTS[escSeq];

        if (replacement) {
            s = s.substring(0, i) + replacement + s.substring(i + 6);
            i += replacement.length;
        } else {
            i += escSeq.length;
        }
    }

    return s;
}
