import express from "express";
import { DbLocals, LinesLocals, asyncHandler, tryParsingQueryCoordinate } from "./webstuff/webJunkyard.js";
import NodeCache from "node-cache";
import { AlertWithRelatedInDb } from "./dbTypes.js";
import { AlertSupplementalMetadata } from "./webstuff/gtfsDbApi.js";
import { ActualLineWithAlertCount, AlertForApi, AllLinesResponse, RouteChangesResponse, SingleLineChanges, StopForMap } from "./apiTypes.js";
import { AllAlertsResult, enrichAlerts, sortAlerts } from "./webstuff/alerts.js";
import { StatusCodes } from "http-status-codes";
import { getRouteChanges } from "./webstuff/routeChgs.js";
import winston from "winston";
import { getAllLines, getSingleLine, sortLinesWithAlerts } from "./webstuff/alertsByLine.js";
import { asyncMap } from "./generalJunkyard.js";
import { calculateDistanceToAlert, calculateDistanceToLine } from "./webstuff/distances.js";
import gtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime } = gtfsRealtimeBindings;

export const apiRouter = express.Router();

apiRouter.use("/all_alerts", asyncHandler(async (req, res: express.Response<any, DbLocals>, next) => {
    if (req.method !== "GET" && req.method !== "POST") {
        next();
        return;
    }

    const coord = tryParsingQueryCoordinate(req.body["current_location"] as string|undefined);

    const alertsAndMetadata = coord
        ? await getAllAlertsWithLocationCached(coord, res.locals)
        : await getAllAlertsCached(res.locals);

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
    // const coord = tryParsingQueryCoordinate(req.query["current_location"] as string|undefined);

    if (!id) {
        res.sendStatus(StatusCodes.BAD_REQUEST);
        return;
    }

    const alertsAndMetadata = /*coord
        ? await getSingleAlertWithLocation(id, coord, res.locals)
        :*/ await getSingleAlertCached(id, res.locals);
    
    if (!alertsAndMetadata.alerts.length) {
        res.json({alerts: []});
        return;
    }

    // the reason i don't just yolo and send over the entire struct, is that i don't want
    // to include the metadata and the raw alerts
    const result: any = {
        alerts: alertsAndMetadata.alerts
    };

    if ("route_changes" in alertsAndMetadata) {
        result.route_changes = alertsAndMetadata.route_changes;
        result.stops_for_map = alertsAndMetadata.stops_for_map;
        result.map_bounding_box = alertsAndMetadata.map_bounding_box;
    }

    if ("polygon" in alertsAndMetadata && alertsAndMetadata.polygon) {
        result.polygon = alertsAndMetadata.polygon;
    }
    
    res.json(result);
}));

apiRouter.get("/json/alert/:alertId", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const alertId = req.params["alertId"] as string|undefined;
    if (!alertId) {
        res.sendStatus(StatusCodes.BAD_REQUEST);
        return;
    }

    const alertRawData = await res.locals.alertsDbApi.getSingleAlertRawData(alertId);
    if (!alertRawData) {
        res.sendStatus(StatusCodes.NOT_FOUND);
        return;
    }

    const feedMessage = transit_realtime.FeedEntity.decode(alertRawData);

    // not using res.json() here because i want it pretty printed for my own
    // perverse enjoyment
    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify(feedMessage, null, 4));
}))

apiRouter.use("/all_lines", asyncHandler(async (req, res: express.Response<any, DbLocals&LinesLocals>, next) => {
    if (req.method !== "GET" && req.method !== "POST") {
        next();
        return;
    }
    
    const coord = tryParsingQueryCoordinate(req.body["current_location"] as string|undefined);

    const allLines = coord
        ? await getAllLinesCachedWithLocation(coord, res.locals)
        : await getAllLinesCached(res.locals);

    res.json(allLines);
}))

apiRouter.get("/single_line", asyncHandler(async (req, res: express.Response<any, DbLocals&LinesLocals>) => {
    const id = req.query["id"] as string|undefined;

    if (!id) {
        res.sendStatus(StatusCodes.BAD_REQUEST);
        return;
    }

    const lineChanges = await getSingleLineCached(id, res.locals);

    res.json(lineChanges);
}));

type SingleAlertResult = AllAlertsResult | (AllAlertsResult & RouteChangesResponse);

const alertsCache = new NodeCache({ stdTTL: 600, checkperiod: 620, useClones: false });

async function getAllAlertsCached(db: DbLocals) {
    const cacheKey = "/allAlerts";

    let result = alertsCache.get<AllAlertsResult>(cacheKey);
    if (result) return result;

    const alertsRaw = await db.alertsDbApi.getAlerts();
    result = await enrichAlerts(alertsRaw, db.gtfsDbApi);
    alertsCache.set(cacheKey, result);

    return result;
}

async function getSingleAlertCached(id: string, db: DbLocals) {
    const cacheKey = "/single_alert/" + id;

    let result = alertsCache.get<SingleAlertResult>(cacheKey);
    if (result) return result;

    const alertObjRaw = await db.alertsDbApi.getSingleAlert(id);
    const alertsRaw = alertObjRaw ? [alertObjRaw] : [];
    result = await enrichAlerts(alertsRaw, db.gtfsDbApi);

    const routeChanges = await getRouteChangesCached(id, db);
    if (routeChanges) result = {...result, ...routeChanges};

    alertsCache.set(cacheKey, result);

    return result;
}

async function getAllAlertsWithLocationCached(coord: [number, number], db: DbLocals) {
    const cacheKey = "/allAlerts___" + JSON.stringify(coord);

    let result = alertsCache.get<AllAlertsResult>(cacheKey);
    if (result) return result;

    result = {
        ...await getAllAlertsCached(db)
    };

    await addDistanceToAlerts(result, coord, db);
    sortAlerts(result.alerts);
    alertsCache.set(cacheKey, result);

    return result;
}

// async function getSingleAlertWithLocation(id: string, coord: [number, number], db: DbLocals) {
//     const cacheKey = JSON.stringify(coord) + "___/single_alert/" + id;

//     let result = alertsCache.get<SingleAlertResult>(cacheKey);
//     if (result) return result;

//     result = {
//         ...await getSingleAlert(id, db)
//     };

//     await addDistanceToAlerts(result, coord, db);
//     alertsCache.set(cacheKey, result);

//     return result;
// }

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

async function distanceToLineCached(
    line: ActualLineWithAlertCount,
    coord: [number, number],
    allStops: Record<string, StopForMap>,
    linesLocals: LinesLocals
) {
    const cacheKey = `line_${line.pk}____${JSON.stringify(coord)}`;

    let result = distancesCache.get<number|null>(cacheKey);
    if (result !== undefined) return result;

    const [coordY, coordX] = coord;

    result = await calculateDistanceToLine(
        line,
        {x: coordX, y: coordY},
        allStops,
        linesLocals.groupedRoutes
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

const linesCache = new NodeCache({ stdTTL: 600, checkperiod: 620, useClones: false });

async function getAllLinesCached(dbAndLines: DbLocals&LinesLocals) {
    const cacheKey = "/all_lines";

    let result = linesCache.get<AllLinesResponse>(cacheKey);
    if (result) return result;

    result = await getAllLines(dbAndLines.alertsDbApi, dbAndLines.groupedRoutes);
    linesCache.set(cacheKey, result);

    return result;
}

async function getAllLinesCachedWithLocation(
    coord: [number, number],
    dbAndLines: DbLocals&LinesLocals
) {
    const cacheKey = JSON.stringify(coord) + "___/all_lines";

    let result = linesCache.get<AllLinesResponse>(cacheKey);
    if (result) return result;

    result = {
        ...await getAllLinesCached(dbAndLines),
        uses_location: true
    };

    // should i cache this? idk, maybe
    const allStops = await dbAndLines.gtfsDbApi.getStopsForMap(
        result.lines_with_alert.flatMap(
            line => dbAndLines.groupedRoutes.actualLinesDict[line.pk]?.all_stopids_distinct ?? []
        )
    );

    const linePkToDistance: Record<string, number> = {};

    result.lines_with_alert = await asyncMap(
        result.lines_with_alert,
        async line => {
            const distance = await distanceToLineCached(line, coord, allStops, dbAndLines);

            if (distance !== null) {
                linePkToDistance[line.pk] = distance;
                return { ...line, distance };
            } else {
                return line;
            }
        }
    );

    // add the distances we just calculated to all_lines, at least for
    // the lines that we calculated distances for
    result.all_lines = result.all_lines.map(
        line => {
            const distance = linePkToDistance[line.pk];

            if (distance !== undefined) {
                return { ...line, distance };
            } else {
                return line;
            }
        }
    );


    // this is commented out because i decided it's simply overkill to
    // allow users to request the server/the db to do this;
    // it would, in effect, mean calculating the distance from the user
    // to EVERY SINGLE STOP IN THE GTFS and that's uh,,, too much lol

    // result.all_lines = await asyncMap(
    //     result.all_lines,
    //     async line => ({
    //         ...line,
    //         distance: await distanceToLineCached(line, coord, dbAndLines)
    //     })
    // );

    // re-sort the list, because the sort cares about the distances
    sortLinesWithAlerts(result.lines_with_alert, dbAndLines.groupedRoutes);

    linesCache.set(cacheKey, result);

    return result;
}

async function getSingleLineCached(id: string, dbAndLines: DbLocals&LinesLocals) {
    const cacheKey = "/single_line_" + id;

    let result = linesCache.get<SingleLineChanges|null>(cacheKey);
    if (result !== undefined) return result;

    if (dbAndLines.alertsDbApi.timedOps) console.time("getSingleLine");
    result = await getSingleLine(
        id,
        dbAndLines.groupedRoutes,
        dbAndLines.alertsDbApi,
        dbAndLines.gtfsDbApi
    );
    if (dbAndLines.alertsDbApi.timedOps) console.timeEnd("getSingleLine");

    linesCache.set(cacheKey, result);

    return result;
}
