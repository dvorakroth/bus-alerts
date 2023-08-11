import { docopt } from "docopt";
import winston from "winston";
import path from "path";
import url from "url";
import fs from "fs";
import * as ini from "ini";
import pg from "pg";
import express from "express";
import morgan from "morgan";
import { apiRouter } from "./apiRouter.js";
import { DbLocals, LinesLocals } from "./webstuff/webJunkyard.js";
import { AlertsDbApi } from "./webstuff/alertsDbApi.js";
import { GtfsDbApi } from "./webstuff/gtfsDbApi.js";
import { DateTime } from "luxon";
import { GracefulShutdownManager } from "@moebius/http-graceful-shutdown";
import { groupRoutes } from "./webstuff/routeGrouping.js";
import { JERUSALEM_TZ, nodePgConnectionStringKludge } from "./generalJunkyard.js";

const doc = `Service Alerts App Web Server.

Usage:
    webServer.ts [-c <file>]

Options:
    -c <file>, --config <file>       Use the specified configuration file.`;



  //////////////////////////////
 // set up logging and stuff //
//////////////////////////////
const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

const logFormat = winston.format.printf(({level, message, timestamp, stack}) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
});

winston.configure({
    level: IS_PRODUCTION ? 'http' : 'debug',
    format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.timestamp(),
        logFormat
    ),
    transports: [new winston.transports.Console()],
    exceptionHandlers: [new winston.transports.Console()]
});



  ///////////////////////////////
 // read config.ini and stuff //
///////////////////////////////

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const commandlineOptions = docopt(doc);

// Test logging and docopt with this one simple trick that nodejs doesn't want you to know!
// winston.info(JSON.stringify(options));
// if (options) {
//     const a = null as any;
//     console.log(a.jkl);
// }

const configPath = commandlineOptions["--config"] || path.join(__dirname, "config.ini");
const config = ini.parse(fs.readFileSync(configPath, "utf-8"));
const gtfsDbUrl = config["psql"]["dsn"];
const alertsDbUrl = config["psql"]["alerts_db"];

// const host = config["service_alerts"]["web_host"];
const port = config["service_alerts"]["web_port"];


  /////////////////////////
 // db connection pools //
/////////////////////////

const gtfsDbPool = new pg.Pool(nodePgConnectionStringKludge(gtfsDbUrl, IS_PRODUCTION));
const alertsDbPool = new pg.Pool(nodePgConnectionStringKludge(alertsDbUrl, IS_PRODUCTION));

pg.types.setTypeParser(
    pg.types.builtins.TIMESTAMPTZ,
    (isoStr) => DateTime.fromSQL(isoStr).setZone(JERUSALEM_TZ)
);

const gtfsDbApi = new GtfsDbApi(gtfsDbPool/*, !IS_PRODUCTION*/);
const alertsDbApi = new AlertsDbApi(alertsDbPool, !IS_PRODUCTION);


  ////////////////////////////////////
 // create the "actual lines" list //
////////////////////////////////////
winston.info("Grouping routes into Actual Lines");
const groupedRoutes = await groupRoutes(
    path.join(__dirname, "../scripts/route_grouping_query.sql"),
    gtfsDbPool
);
winston.info("Done grouping routes");


  ////////////////////////////////////
 // actual webserver stuff finally //
////////////////////////////////////

const app = express();

// disable etag headers because this is an api service??
// TODO ideally i should probably find a way to integrate this with the
//      caches that i use internally in apiRouter.ts, but, uh,,, later;
app.disable("etag");

// log all requests
const morganMiddleware = morgan(
    ':method :url :status :res[content-length] bytes - :response-time ms - :referrer - :user-agent',
    {
        stream: {
            write: (message) => winston.http(message.trim())
        }
    }
);
app.use(morganMiddleware);

// parse post data when we get any
app.use(express.urlencoded({ extended: false }));

// give all requests access to the db apis
app.use((req, res: express.Response<any, DbLocals&LinesLocals>, next) => {
    res.locals.alertsDbApi = alertsDbApi;
    res.locals.gtfsDbApi = gtfsDbApi;
    res.locals.groupedRoutes = groupedRoutes;

    next();
});

// actually server the api
app.use("/api", apiRouter);

if (!IS_PRODUCTION) {
    // if we're not in production, also serve the compiled client code
    app.use(express.static(path.join(__dirname, '../dist')));
    app.use((req, res) => {
        res.send(fs.readFileSync(
            path.join(__dirname, "../dist/index.html"),
            {encoding: "utf8"}
        ));
    })
}

// error handler because the default express error handler is kinda shit
const errHandler: express.ErrorRequestHandler = (err, req, res, next) => {
    winston.error(err);

    if (err.constructor === pg.DatabaseError) {
        // try to print some details about database errors, because their default toString doesnt lol
        winston.error(`More DatabaseError data:\n${JSON.stringify(err, void 0, 4)}`);
    }

    if (IS_PRODUCTION) {
        res.status(500).send('Something broke!');
    } else {
        res.status(500).send(err?.toString() + '\n');
    }
}
app.use(errHandler); // errHandler is a const because typescript yells at me if i inline it

// actually start up the server
const server = app.listen(port, () => {
    winston.info(`Server up and listening on port ${port}`);
});

const shutdownManager = new GracefulShutdownManager(server);

process.on('SIGINT', shutDownGracefully);
process.on('SIGTERM', shutDownGracefully);

async function shutDownGracefully() {
    winston.info("Trying to shut server down gracefully...");

    try {
        await new Promise<void>(resolve => shutdownManager.terminate(resolve));
    } catch (err) {
        winston.error(err);
    }

    try {
        await gtfsDbPool.end();
    } catch (err) {
        winston.error(err);
    }

    try {
        await alertsDbPool.end();
    } catch (err) {
        winston.error(err);
    }

    process.exit(0);
}
