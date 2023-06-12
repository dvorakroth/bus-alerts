import express from "express";
import { DbLocals, asyncHandler, tryParsingQueryCoordinate } from "./webstuff/webJunkyard.js";
import NodeCache from "node-cache";
import { AlertWithRelatedInDb } from "./dbTypes.js";
import { AlertSupplementalMetadata } from "./webstuff/gtfsDbApi.js";
import { AlertForApi, RouteChangesResponse } from "./apiTypes.js";
import { calculateDistanceToAlert, enrichAlerts, sortAlerts } from "./webstuff/alerts.js";
import { StatusCodes } from "http-status-codes";
import { getRouteChanges } from "./webstuff/routeChgs.js";
import winston from "winston";

export const apiRouter = express.Router();

apiRouter.get("/all_alerts", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const coord = tryParsingQueryCoordinate(req.query["current_location"] as string|undefined);

    const alertsAndMetadata = coord
        ? await getAllAlertsWithLocation(coord, res.locals)
        : await getAllAlerts(res.locals);

    res.json({
        alerts: alertsAndMetadata.alerts
    });
}));

apiRouter.get("/get_route_changes", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const alertId = req.query["id"] as string;

    if (!alertId) {
        res.sendStatus(StatusCodes.BAD_REQUEST);
        return;
    }

    res.json(await getRouteChangesCached(alertId, res.locals));
}));

apiRouter.get("/single_alert", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const id = req.query["id"] as string|undefined;
    const coord = tryParsingQueryCoordinate(req.query["current_location"] as string|undefined);

    if (!id) {
        res.sendStatus(StatusCodes.BAD_REQUEST);
        return;
    }

    const alertsAndMetadata = coord
        ? await getSingleAlertWithLocation(id, coord, res.locals)
        : await getSingleAlert(id, res.locals);
    
    if (!alertsAndMetadata.alerts.length) {
        res.json({alerts: []});
        return;
    }

    if ("route_changes" in alertsAndMetadata) {
        // the reason i don't just yolo and send over the entire struct, is that i don't want
        // to include the metadata and the raw alerts
        res.json({
            alerts: alertsAndMetadata.alerts,
            route_changes: alertsAndMetadata.route_changes,
            stops_for_map: alertsAndMetadata.stops_for_map,
            map_bounding_box: alertsAndMetadata.map_bounding_box
        });
    } else {
        res.json({
            alerts: alertsAndMetadata.alerts
        });
    }
}))

// TODO implement the list o' lines api

// TODO implement the changes-per-line api

type AllAlertsResult = {
    rawAlertsById: Record<string, AlertWithRelatedInDb>,
    alerts: AlertForApi[],
    metadata: AlertSupplementalMetadata
};

type SingleAlertResult = AllAlertsResult | (AllAlertsResult & RouteChangesResponse);

const alertsCache = new NodeCache({ stdTTL: 600, checkperiod: 620, useClones: false });

async function getAllAlerts(db: DbLocals) {
    const cacheKey = "/allAlerts";

    let result = alertsCache.get<AllAlertsResult>(cacheKey);
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
    alertsCache.set(cacheKey, result);

    return result;
}

async function getSingleAlert(id: string, db: DbLocals) {
    const cacheKey = "/single_alert/" + id;

    let result = alertsCache.get<SingleAlertResult>(cacheKey);
    if (result) return result;

    const alertObjRaw = await db.alertsDbApi.getSingleAlert(id);
    const alertsRaw = alertObjRaw ? [alertObjRaw] : [];
    result = {
        ...await enrichAlerts(alertsRaw, db.gtfsDbApi),
        rawAlertsById: alertObjRaw ? {[id]: alertObjRaw} : {}
    };

    const routeChanges = await getRouteChangesCached(id, db);
    if (routeChanges) result = {...result, ...routeChanges};

    alertsCache.set(cacheKey, result);

    return result;
}

async function getAllAlertsWithLocation(coord: [number, number], db: DbLocals) {
    const cacheKey = "/allAlerts___" + JSON.stringify(coord);

    let result = alertsCache.get<AllAlertsResult>(cacheKey);
    if (result) return result;

    result = {
        ...await getAllAlerts(db)
    };

    await addDistanceToAlerts(result, coord, db);
    sortAlerts(result.alerts);
    alertsCache.set(cacheKey, result);

    return result;
}

async function getSingleAlertWithLocation(id: string, coord: [number, number], db: DbLocals) {
    const cacheKey = JSON.stringify(coord) + "___/single_alert/" + id;

    let result = alertsCache.get<SingleAlertResult>(cacheKey);
    if (result) return result;

    result = {
        ...await getSingleAlert(id, db)
    };

    await addDistanceToAlerts(result, coord, db);
    alertsCache.set(cacheKey, result);

    return result;
}

async function addDistanceToAlerts(result: AllAlertsResult, coord: [number, number], db: DbLocals) {
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
}

const distancesCache = new NodeCache({ stdTTL: 600, checkperiod: 620, useClones: false });

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

const routeChgsCache = new NodeCache({ stdTTL: 600, checkperiod: 620, useClones: false });

async function getRouteChangesCached(
    alertId: string,
    db: DbLocals
) {
    const cacheKey = `routeChanges_${alertId}`;

    let result = routeChgsCache.get<RouteChangesResponse|null>(cacheKey);
    if (result !== undefined) return result;

    result = await getRouteChanges(alertId, null, db.alertsDbApi, db.gtfsDbApi);
    winston.debug(`Done computing changes for alert ${alertId}`);
    routeChgsCache.set(cacheKey, result);

    return result;
}
