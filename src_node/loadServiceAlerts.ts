import { docopt } from "docopt";
import * as fs from "fs";
import * as ini from "ini";
import winston from "winston";
import got from "got";
import { DateTime } from "luxon";
import pg from "pg";
import path from 'path';
import url from 'url';
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import { loadIsraeliGtfsRt } from "./loaderUtils/loadServiceAlertsImpl.js";
import { tryParseFilenameDate } from "./loaderUtils/parseGtfsRtFilename.js";
import { nodePgConnectionStringKludge } from "./generalJunkyard.js";

const {transit_realtime} = gtfsRealtimeBindings;

const doc = `Load service alerts from MOT endpoint.

Usage:
    loadServiceAlerts.ts [-h] [-c <file>] [-f <pbfile>]

Options:
    -h, --help                       Show this help message and exit.
    -c <file>, --config <file>       Use the specified configuration file.
    -f <pbfile>, --file <pbfile>     Load from <pbfile> instead of MOT endpoint.
                                     If the filename contains six numbers separated from each other by non-number characters, it'll get treated as a yyyy mm dd hh mm ss date
`;

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

const logFormat = winston.format.printf(({level, message, timestamp}) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

winston.configure({
    level: IS_PRODUCTION ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        logFormat
    ),
    transports: [new winston.transports.Console()],
    exceptionHandlers: [new winston.transports.Console()]
});

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function main() {
    const options = docopt(doc);

    // Test logging and docopt with this one simple trick that nodejs doesn't want you to know!
    // winston.info(JSON.stringify(options));
    // if (options) {
    //     const a = null as any;
    //     console.log(a.jkl);
    // }

    const configPath = options["--config"] || path.join(__dirname, "config.ini");
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

    const gtfsDb = new pg.Client(nodePgConnectionStringKludge(gtfsDbUrl, IS_PRODUCTION));
    const alertsDb = new pg.Client(nodePgConnectionStringKludge(alertsDbUrl, IS_PRODUCTION));

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
    } catch (err: any) {
        await alertsDb.query("ROLLBACK");

        if (err.constructor === pg.DatabaseError) {
            // try to print some details about database errors, because their default toString doesnt lol
            winston.error(`DatabaseError: ${err.toString()}\n${JSON.stringify(err, void 0, 4)}`);
        } else {
            throw err;
        }
    } finally {
        await gtfsDb.end();
        await alertsDb.end();
    }
}

main();

