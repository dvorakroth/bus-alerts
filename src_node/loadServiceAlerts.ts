import { docopt } from "docopt";
import * as fs from "fs";
import * as ini from "ini";
import * as winston from "winston";
import got from "got";
import { DateTime } from "luxon";
import pg from "pg";

import * as gtfsRealtimeBindings from "gtfs-realtime-bindings";
import { loadIsraeliGtfsRt } from "./loadServiceAlertsImpl.js";
import { JERUSALEM_TZ, TIME_FORMAT_ISO_NO_TZ } from "./junkyard.js";
const {transit_realtime} = gtfsRealtimeBindings;

const doc = `Load service alerts from MOT endpoint.

Usage:
    ts-node loadServiceAlerts.ts [-h] [-c <file>] [-f <pbfile>]

Options:
    -h, --help                       Show this help message and exit.
    -c <file>, --config <file>       Use the specified configuration file.
    -f <pbfile>, --file <pbfile>     Load from <pbfile> instead of MOT endpoint.
                                     If the filename contains six numbers separated from each other by non-number characters, it'll get treated as a yyyy mm dd hh mm ss date
`;

winston.configure({
    level: 'debug', // TODO change this to info when the script is run in prod
    transports: [
        new winston.transports.Console(),
        // TODO uh,,,, other stuff? idk ask elad lol
    ],
    exceptionHandlers: [
        new winston.transports.Console()
        // TODO same; ask elad
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
            winston.error(`received status code ${response.statusCode} ${response.statusMessage} from mot endpoint`);
            process.exit(1);
        }
        rawData = response.rawBody;
    }

    const feed = transit_realtime.FeedMessage.decode(
        new Uint8Array(rawData)
    );

    const gtfsDb = new pg.Client(gtfsDbUrl);
    const alertsDb = new pg.Client(alertsDbUrl);

    await gtfsDb.connect();
    try {
        await alertsDb.connect();
    } catch(err) {
        await gtfsDb.end();
        throw err;
    }

    try {
        await alertsDb.query("BEGIN");
        await loadIsraeliGtfsRt(gtfsDb, alertsDb, feed, TESTING_fake_today);
        await alertsDb.query("COMMIT");
    } catch (err) {
        await alertsDb.query("ROLLBACK");
        throw err;
    } finally {
        await gtfsDb.end();
        await alertsDb.end();
    }
}

main();

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
        winston.warn(`couldn't make a date out of numbers in filename: ${filename}\n${result.invalidExplanation}`);
        return null;
    } else {
        winston.info(`found date ${result.toFormat(TIME_FORMAT_ISO_NO_TZ)} in filename ${filename}`);
        return result;
    }
}
