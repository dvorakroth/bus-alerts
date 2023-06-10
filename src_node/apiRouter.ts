import express from "express";
import { DbLocals, asyncHandler, tryParsingQueryCoordinate } from "./webstuff/webJunkyard.js";
import NodeCache from "node-cache";
import winston from "winston";
import { AlertWithRelatedInDb } from "./dbTypes.js";
import { AlertSupplementalMetadata } from "./webstuff/gtfsDbApi.js";
import { AlertForApi } from "./apiTypes.js";
import { enrichAlerts } from "./webstuff/alerts.js";

export const apiRouter = express.Router();

const allAlertsCache = new NodeCache({ stdTTL: 600, checkperiod: 620 });

// TODO actually implement the server lol
apiRouter.get("/hello", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    let alertCount = allAlertsCache.get<number>("/hello");

    if (alertCount === undefined) {
        winston.debug("/hello cache miss");
        alertCount = (await res.locals.alertsDbApi.getAlerts()).length;
        allAlertsCache.set("/hello", alertCount);
    }

    res.send(`hello, world! there are currently ${alertCount} alerts in the database\n`);
}));

apiRouter.get("/all_alerts", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const coord = tryParsingQueryCoordinate(req.query["current_location"] as string);

    if (coord) {
        res.json({
            alerts: (await getAllAlertsWithLocation(
                res.locals,
                coord
            )).alerts
        });
    } else {
        res.json({
            alerts: (await getAllAlerts(
                res.locals
            )).alerts
        });
    }
}));

type AllAlertsResult = {
    rawAlertsById: Record<string, AlertWithRelatedInDb>,
    alerts: AlertForApi[],
    metadata: AlertSupplementalMetadata
};

async function getAllAlerts(db: DbLocals) {
    const cacheKey = "/allAlerts";

    let result = allAlertsCache.get<AllAlertsResult>(cacheKey);
    if (result) return result;

    const alertsRaw = await db.alertsDbApi.getAlerts();
    result = {
        ...await enrichAlerts(alertsRaw, db.gtfsDbApi),
        rawAlertsById: alertsRaw.reduce<Record<string, AlertWithRelatedInDb>>(
            (r, alert) => {
                r[alert.id] = alert;
                return r;
            },
            {}
        )
    };
    allAlertsCache.set(cacheKey, result);

    return result;
}

async function getAllAlertsWithLocation(db: DbLocals, coord: [number, number]) {
    const cacheKey = "/allAlerts___" + JSON.stringify(coord);

    let result = allAlertsCache.get<AllAlertsResult>(cacheKey);
    if (result) return result;

    result = {
        ...await getAllAlerts(db)
    };

    // copy the array of alerts, and copy each alert in the array
    // so that we don't set any distances on the original objects!
    result.alerts = [...result.alerts];
    for (let i = 0; i < result.alerts.length; i++) {
        const alert = result.alerts[i];
        if (!alert) continue;

        const distance = 0; // TODO lol
        result.alerts[i] = {
            ...alert,
            distance
        };
    }

    allAlertsCache.set(cacheKey, result);

    return result;
}
