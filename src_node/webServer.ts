import { docopt } from "docopt";
import winston from "winston";
import path from "path";
import url from "url";
import fs from "fs";
import * as ini from "ini";
import pg from "pg";
import express from "express";

const doc = `Service Alerts App Web Server.

Usage:
    webServer.ts [-c <file>]

Options:
    -c <file>, --config <file>       Use the specified configuration file.`;



  //////////////////////////////
 // set up logging and stuff //
//////////////////////////////
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
    transports: [
        new winston.transports.Console(),
        // TODO uh,,,, other stuff? idk ask elad lol
    ],
    exceptionHandlers: [
        new winston.transports.Console()
        // TODO same; ask elad
    ]
});



  ///////////////////////////////
 // read config.ini and stuff //
///////////////////////////////

// need to ts-ignore the __url line because i don't want to set my
// whole entire project as a node(-only?) project in case it messes
// up the client code lol
// @ts-ignore
const __url = import.meta.url;
const __dirname = path.dirname(url.fileURLToPath(__url));

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

const gtfsDbPool = new pg.Pool({
    connectionString: gtfsDbUrl
});
const alertsDbPool = new pg.Pool({
    connectionString: alertsDbUrl
});

// TODO create the "actual lines list"


  ////////////////////////////////////
 // actual webserver stuff finally //
////////////////////////////////////

const app = express();
app.use((req, res, next) => {
    res.locals['gtfsDbPool'] = gtfsDbPool;
    res.locals['alertsDbPool'] = alertsDbPool;
    next();
});

// TODO actually implement the server lol
app.get("/api/hello", (req, res) => {
    res.send("hello, world!");
});

app.listen(port, () => {
    winston.info(`Server up and listening on port ${port}`);
});
