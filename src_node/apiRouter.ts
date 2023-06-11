import express from "express";
import { DbLocals, asyncHandler, tryParsingQueryCoordinate } from "./webstuff/webJunkyard.js";
import NodeCache from "node-cache";
import winston from "winston";
import { AlertWithRelatedInDb } from "./dbTypes.js";
import { AlertSupplementalMetadata } from "./webstuff/gtfsDbApi.js";
import { AlertForApi } from "./apiTypes.js";
import { calculateDistanceToAlert, enrichAlerts, sortAlerts } from "./webstuff/alerts.js";
import { StatusCodes } from "http-status-codes";

export const apiRouter = express.Router();

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

apiRouter.get("/get_route_changes", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const alertId = req.query["id"] as string;

    if (!alertId) {
        res.sendStatus(StatusCodes.BAD_REQUEST);
        return;
    }

    res.json(await getRouteChangesCached(alertId, res.locals));
}));

type AllAlertsResult = {
    rawAlertsById: Record<string, AlertWithRelatedInDb>,
    alerts: AlertForApi[],
    metadata: AlertSupplementalMetadata
};

const allAlertsCache = new NodeCache({ stdTTL: 600, checkperiod: 620 });

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

        const alertRaw = result.rawAlertsById[alert.id];
        if (!alertRaw) continue;

        const distance = await distanceToAlertCached(
            alert,
            alertRaw,
            result.metadata,
            coord,
            db
        );

        if (distance !== null) {
            result.alerts[i] = {
                ...alert,
                distance
            };
        }
    }

    sortAlerts(result.alerts);

    allAlertsCache.set(cacheKey, result);

    return result;
}

const distancesCache = new NodeCache({ stdTTL: 600, checkperiod: 620 });

async function distanceToAlertCached(
    alert: AlertForApi,
    alertRaw: AlertWithRelatedInDb,
    metadata: AlertSupplementalMetadata,
    coord: [number, number],
    db: DbLocals
) {
    const cacheKey = `alert_${alert.id}_____${JSON.stringify(coord)}`;

    let result = distancesCache.get<number|null>(cacheKey);
    if (result !== undefined) return result;

    const [coordY, coordX] = coord; // ??

    result = await calculateDistanceToAlert(
        alert,
        alertRaw,
        metadata,
        {x: coordX, y: coordY},
        db.gtfsDbApi
    );

    distancesCache.set(cacheKey, result);

    return result;
}

const routeChgsCache = new NodeCache({ stdTTL: 600, checkperiod: 620 });

async function getRouteChangesCached(
    alertId: string,
    db: DbLocals
) {
    const cacheKey = `routeChanges_${alert.id}`;

    let result = routeChgsCache.get<RouteChangesResponse|null>(cacheKey);
    if (result !== undefined) return result;

    result = await getRouteChanges(alertId, null, db.alertsDbApi, db.gtfsDbApi);
    routeChgsCache.set(cacheKey, result);

    return result;
}
