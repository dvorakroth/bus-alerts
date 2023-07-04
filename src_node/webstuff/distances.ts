import proj4 from "proj4";
import { ActualLineWithAlertCount, AlertForApi, StopForMap } from "../apiTypes.js";
import { AlertUseCase, AlertWithRelatedInDb } from "../dbTypes.js";
import { AlertSupplementalMetadata, GtfsDbApi } from "./gtfsDbApi.js";
import { parseOldAramaicRegion } from "../loaderUtils/oldAramaic.js";
import { inPlaceSortAndUnique } from "../generalJunkyard.js";
import { GroupedRoutes } from "./routeGrouping.js";

// israeli coordinate system
proj4.defs("EPSG:2039","+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,0.3132,1.85274,-1.67299,-5.4262 +units=m +no_defs +type=crs");

const COORD_TRANSFORMER = proj4("EPSG:4326", "EPSG:2039");

type CoordXY = {x: number, y: number};

export async function calculateDistanceToAlert(
    alert: AlertForApi,
    alertRaw: AlertWithRelatedInDb,
    metadata: AlertSupplementalMetadata,
    currentLocation: CoordXY,
    gtfsDbApi: GtfsDbApi
) {
    const currentLocationTransformed = COORD_TRANSFORMER.forward(currentLocation);

    if (alert.use_case === AlertUseCase.Region && !alert.added_stops.length && !alert.removed_stops.length) {
        // in the weird case where they define a polygon with no stops,
        // use distance to that polygon

        const originalSelector = alertRaw.original_selector as {old_aramaic: string};
        const parsedRegion = parseOldAramaicRegion(originalSelector.old_aramaic).map(
            ([y, x]) => ({
                y: parseFloat(y),
                x: parseFloat(x)
            })
        );

        const transformedRegion = parsedRegion.map(point => COORD_TRANSFORMER.forward(point));
        const transformedRegionString =
            "("
            + transformedRegion.map(({x, y}) => `(${x},${y})`).join(",")
            + ")";
        
        const transformedLocationString = `(${currentLocationTransformed.x},${currentLocationTransformed.y})`;

        // clever li'l hack because i couldn't find a decent js library that could do this,
        // but apparently postgres can! event without postgis!
        const res = await gtfsDbApi.gtfsDbPool.query<{distance: number}, [string, string]>(
            "SELECT polygon $1 <-> point $2 AS distance;",
            [transformedRegionString, transformedLocationString]
        );

        return res.rows[0]?.distance ?? null;
    }

    const allStopIds = [
        ...alertRaw.added_stop_ids,
        ...alertRaw.removed_stop_ids
    ];
    inPlaceSortAndUnique(allStopIds);

    const allStopCoords = 
        allStopIds.length
        ? allStopIds.map(
                (stop_id) => {
                    const stop = metadata.stops[stop_id];
                    if (!stop) return null;
                    else return {x: stop.stop_lon, y: stop.stop_lat};
                }
            ).filter((s): s is CoordXY => s !== null)
        : await gtfsDbApi.getAllStopCoordsByRouteIds(alertRaw.relevant_route_ids);

    if (allStopCoords.length) {
        let minimumDistance = Infinity;

        for (const coord of allStopCoords) {
            const transformedCoord = COORD_TRANSFORMER.forward(coord);

            const distance = Math.sqrt(
                Math.pow(transformedCoord.x - currentLocationTransformed.x, 2)
                +
                Math.pow(transformedCoord.y - currentLocationTransformed.y, 2)
            );

            if (distance < minimumDistance) {
                minimumDistance = distance;
            }
        }

        return minimumDistance;
    }

    return null;
}

export async function calculateDistanceToLine(
    line: ActualLineWithAlertCount,
    currentLocation: CoordXY,
    allStops: Record<string, StopForMap>,
    groupedRoutes: GroupedRoutes
) {
    const currentLocationTransformed = COORD_TRANSFORMER.forward(currentLocation);

    const all_stopids_distinct = groupedRoutes.actualLinesDict[line.pk]?.all_stopids_distinct;
    if (!all_stopids_distinct) return null;

    const allStopCoords = all_stopids_distinct.map(
        stop_id => {
            const stop = allStops[stop_id];
            if (!stop) return null;
            else return {x: stop.stop_lon, y: stop.stop_lat};
        }
    ).filter((s): s is CoordXY => s !== null);

    if (allStopCoords.length) {
        let minimumDistance = Infinity;

        for (const coord of allStopCoords) {
            const transformedCoord = COORD_TRANSFORMER.forward(coord);

            const distance = Math.sqrt(
                Math.pow(transformedCoord.x - currentLocationTransformed.x, 2)
                +
                Math.pow(transformedCoord.y - currentLocationTransformed.y, 2)
            );

            if (distance < minimumDistance) {
                minimumDistance = distance;
            }
        }

        return minimumDistance;
    }

    return null;
}
