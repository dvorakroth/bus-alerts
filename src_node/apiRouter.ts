import express from "express";
import { DbLocals, asyncHandler } from "./webJunkyard.js";

export const apiRouter = express.Router();

// TODO actually implement the server lol
apiRouter.get("/hello", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const alertCount = (await res.locals.alertsDbApi.getAlerts()).length;
    res.send(`hello, world! there are currently ${alertCount} alerts in the database\n`);
}));

const COORD_REGEX = /^(?<x>\d+(\.\d+)?)_(?<y>\d+(\.\d+)?)$/g;
function tryParsingQueryCoordinate(coordinate: string|undefined): null|[number, number] {
    if (!coordinate) return null;

    const match = coordinate.matchAll(COORD_REGEX).next().value;
    if (!match) return null;

    return [
        Math.round(parseFloat(match.groups["x"]) * 1_000_000) / 1_000_000,
        Math.round(parseFloat(match.groups["y"]) * 1_000_000) / 1_000_000
    ];
}

apiRouter.get("/all_alerts", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    // TODO caching
    const coord = tryParsingQueryCoordinate(req.query["current_location"] as string);

    const alerts = await res.locals.alertsDbApi.getAlerts();

    // TODO
    res.json({
        coord,
        alerts
    });
}));
