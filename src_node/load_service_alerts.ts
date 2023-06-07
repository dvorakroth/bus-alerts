import { docopt } from "docopt";
import * as fs from "fs";
import * as ini from "ini";
import * as winston from "winston";
import got from "got";
import pg from "pg";

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

function loadIsraeliGtfsRt(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    feed: transit_realtime.FeedMessage,
    TESTING_fake_today: DateTime|null
) {
    // TODO lol
}