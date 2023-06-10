import express from "express";
import { DbLocals, asyncHandler, tryParsingQueryCoordinate } from "./webstuff/webJunkyard.js";
import NodeCache from "node-cache";
import winston from "winston";
import { AlertWithRelatedInDb } from "./dbTypes.js";

export const apiRouter = express.Router();

const cache = new NodeCache({ stdTTL: 600, checkperiod: 620 });

// TODO actually implement the server lol
apiRouter.get("/hello", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    let alertCount = cache.get<number>("/hello");

    if (alertCount === undefined) {
        winston.debug("/hello cache miss");
        alertCount = (await res.locals.alertsDbApi.getAlerts()).length;
        cache.set("/hello", alertCount);
    }

    res.send(`hello, world! there are currently ${alertCount} alerts in the database\n`);
}));

apiRouter.get("/all_alerts", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const coord = tryParsingQueryCoordinate(req.query["current_location"] as string);
    const cacheKey = "/all_alerts" + (
        coord
            ? ("____" + JSON.stringify(coord))
            : ""
    );

    let alerts = cache.get<AlertWithRelatedInDb[]>(cacheKey);
    if (alerts === undefined) {
        alerts = await res.locals.alertsDbApi.getAlerts();
        // TODO use cached /all_alerts if we missed an /all_alerts____coord cache lookup
        // TODO enrich
        // TODO add distance

        cache.set(cacheKey, alerts);
    }

    res.json({
        coord,
        alerts
    });
}));