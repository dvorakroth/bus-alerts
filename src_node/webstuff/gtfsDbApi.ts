import pg from "pg";
import { AlertWithRelatedInDb } from "../dbTypes.js";
import { GTFS_CALENDAR_DOW, arrayToDict, arrayToDictDifferent, copySortAndUnique } from "../generalJunkyard.js";
import { DateTime } from "luxon";
import { Agency, RouteMetadata, StopForMap, StopMetadata } from "../apiTypes.js";

export class GtfsDbApi {
    gtfsDbPool: pg.Pool;
    timedOps: boolean;

    constructor(gtfsDbPool: pg.Pool, timedOps?: boolean) {
        this.gtfsDbPool = gtfsDbPool;
        this.timedOps = !!timedOps;
    }

    async getRelatedMetadataForAlerts(alerts: AlertWithRelatedInDb[]) {
        const agencyIds = [];
        const routeIds = [];
        const stopIds = [];

        if (this.timedOps) console.time("getRelatedMetadataForAlerts > for loop");
        for (const alert of alerts) {
            agencyIds.push(...alert.relevant_agencies);
            routeIds.push(...alert.relevant_route_ids);
            stopIds.push(...alert.added_stop_ids, ...alert.removed_stop_ids);
        }
        if (this.timedOps) console.timeEnd("getRelatedMetadataForAlerts > for loop");

        return await this.getRelatedMetadata(
            copySortAndUnique(agencyIds),
            copySortAndUnique(routeIds),
            copySortAndUnique(stopIds),
            true
        );
    }

    async getRelatedMetadata(
        agencyIds: string[],
        routeIds: string[],
        stopIds: string[],
        includePopularity?: boolean
    ) {
        if (this.timedOps) console.time("GtfsDbApi.getRelatedMetadata");
        const agencies: Record<string, Agency> = {};
        const routes: Record<string, Route> = {};
        const stops: Record<string, Stop> = {};

        if (agencyIds.length) {
            const res = await this.gtfsDbPool.query<Agency, [string[]]>(
                "SELECT agency_id, agency_name FROM agency WHERE agency_id = ANY($1::varchar[]);",
                [agencyIds]
            );

            for (const agency of res.rows) {
                agencies[agency.agency_id] = agency;
            }
        }

        if (routeIds.length) {
            const res = await this.gtfsDbPool.query<Route, [string[]]>(
                "SELECT route_id, route_short_name, agency_id FROM routes WHERE route_id = ANY($1::varchar[]);",
                [routeIds]
            );

            for (const route of res.rows) {
                routes[route.route_id] = route;
            }
        }

        if (stopIds.length) {
            const res = await this.gtfsDbPool.query<Stop, [string[]]>(
                "SELECT stop_id, stop_lon, stop_lat, stop_name, stop_code FROM stops WHERE stop_id = ANY($1::varchar[]);",
                [stopIds]
            );

            for (const stop of res.rows) {
                stops[stop.stop_id] = stop;
            }
        }

        return <AlertSupplementalMetadata>{agencies, routes, stops};
    }

    async getRouteMetadata(routeIds: string[]) {
        if (!routeIds.length) {
            return {};
        }

        const res = await this.gtfsDbPool.query<RouteMetadata, [string[]]>(
            `
                SELECT
                    routes.route_id,
                    routes.route_desc,
                    routes.agency_id,
                    route_short_name as line_number,
                    agency_name
                FROM routes
                INNER JOIN agency
                ON routes.agency_id = agency.agency_id
                WHERE route_id = ANY($1::varchar[]);
            `,
            [routeIds]
        );

        const result: Record<string, RouteMetadata> = {};

        for (const r of res.rows) {
            result[r.route_id] = r;
        }

        return result;
    }

    async getRepresentativeTripId(routeId: string, preferredDate: DateTime) {
        const preferredDateStr = preferredDate.toFormat("yyyy-MM-dd");

        const res = await this.gtfsDbPool.query<{trip_id: string}, [string, string, string, string]>(
            `
                SELECT trips.trip_id
                FROM trips
                INNER JOIN calendar on trips.service_id = calendar.service_id
                WHERE route_id=$1
                ORDER BY
                    daterange(start_date, end_date + 1) @> $2::DATE DESC,
                    start_date - $3::DATE <= 0 DESC,
                    ABS(start_date - $4::DATE) ASC,
                    ${GTFS_CALENDAR_DOW[preferredDate.weekday - 1]} DESC
                LIMIT 1;
            `,
            [
                routeId,
                preferredDateStr,
                preferredDateStr,
                preferredDateStr
            ],
        );

        return res.rows[0]?.trip_id ?? null;
    }

    async getStopSeq(tripId: string) {
        const res = await this.gtfsDbPool.query<{stop_id: string}, [string]>(
            // why does this query do a seemingly useless join? i don't know
            // i probably had a reason when i originally wrote it (making sure
            // the stop_ids actually exist? sleep deprivation? who knows)
            `
                SELECT stops.stop_id
                FROM stops
                INNER JOIN stoptimes ON stops.stop_id = stoptimes.stop_id
                WHERE stoptimes.trip_id = $1
                ORDER BY stop_sequence ASC;
            `,
            [tripId]
        );

        return res.rows.map(({stop_id}) => stop_id);
    }

    async getTripHeadsign(tripId: string) {
        const res = await this.gtfsDbPool.query<{trip_headsign: string}, [string]>(
            `
                SELECT
                    trip_headsign
                FROM trips
                WHERE trip_id = $1;
            `,
            [tripId]
        );

        return res.rows[0]?.trip_headsign ?? "";
    }

    async getStopDesc(stopIds: string[]) {
        if (!stopIds.length) {
            return {};
        }

        const res = await this.gtfsDbPool.query<{stop_id: string, stop_desc: string}, [string[]]>(
            `
                SELECT
                    stop_id,
                    stop_desc
                FROM stops
                WHERE stop_id = ANY($1::varchar[]);
            `,
            [stopIds]
        );

        return arrayToDictDifferent(
            res.rows,
            r => r.stop_id,
            r => r.stop_desc
        );
    }

    async getStopsForMap(stopIds: string[]) {
        if (!stopIds.length) {
            return {};
        }

        const res = await this.gtfsDbPool.query<StopForMap, [string[]]>(
            `
                SELECT
                    stop_id,
                    stop_lon,
                    stop_lat
                FROM stops
                WHERE stop_id = ANY($1::varchar[]);
            `,
            [stopIds]
        );

        return arrayToDict(res.rows, r => r.stop_id);
    }

    async getStopMetadata(stopIds: string[]) {
        if (!stopIds.length) {
            return {};
        }

        const res = await this.gtfsDbPool.query<StopMetadata, [string[]]>(
            `
            SELECT
                stop_id,
                stop_lon,
                stop_lat,
                stop_name,
                stop_code
            FROM stops
            WHERE stop_id = ANY($1::varchar[]);
            `,
            [stopIds]
        );

        return arrayToDict(res.rows, r => r.stop_id);
    }

    async getAllStopCoordsByRouteIds(routeIds: string[]) {
        if (!routeIds.length) {
            return [];
        }

        const res = await this.gtfsDbPool.query<{y: number, x: number}, [string[]]>(
            `
                SELECT DISTINCT stop_lat AS y, stop_lon AS x
                FROM stops
                INNER JOIN stoptimes ON stops.stop_id = stoptimes.stop_id
                INNER JOIN trips ON stoptimes.trip_id = trips.trip_id
                WHERE trips.route_id = ANY($1::varchar[]);
            `,
            [routeIds]
        );

        return res.rows;
    }

    async getShapePoints(tripId: string) {
        /**
         * Finds a trip's shape, and returns an array [[lon, lat], [lon, lat], ...]
         */

        const res = await this.gtfsDbPool.query<{shape_pt_lon: number, shape_pt_lat: number}, [string]>(
            `
                SELECT
                    shape_pt_lon,
                    shape_pt_lat
                FROM shapes
                WHERE shapes.shape_id=(SELECT trips.shape_id FROM trips WHERE trip_id=$1)
                ORDER BY shape_pt_sequence ASC;
            `,
            [tripId]
        );

        if (!res.rows.length) return null;

        return res.rows.map<[number, number]>(
            ({shape_pt_lon, shape_pt_lat}) => [shape_pt_lon, shape_pt_lat]
        );
    }

    async getAllAgencies() {
        const res = await this.gtfsDbPool.query<Agency>(
            "SELECT agency_id, agency_name FROM agency;"
        );

        return arrayToDict(res.rows, r => r.agency_id);
    }

    async getStopsSortedByPopularity(stopIds: string[]) {
        if (this.timedOps) console.time("GtfsDbApi.getStopsSortedByPopularity");
        const res = await this.gtfsDbPool.query<{stop_code: string, stop_name: string}, [string[]]>(
            `
                SELECT
                    stop_code,
                    (ARRAY_AGG(stop_name))[1] AS stop_name
                FROM stops
                LEFT OUTER JOIN stoptimes
                ON stoptimes.stop_id = stops.stop_id
                WHERE stops.stop_id = ANY($1::varchar[])
                GROUP BY stop_code
                ORDER BY COUNT(DISTINCT trip_id) DESC;
            `,
            [stopIds]
        );

        const result = res.rows.map<[string, string]>(
            ({stop_code, stop_name}) => [stop_code, stop_name]
        );

        if (this.timedOps) console.timeEnd("GtfsDbApi.getStopsSortedByPopularity");
        return result;
    }
    }
}

type Route = {
    route_id: string,
    route_short_name: string,
    agency_id: string
};

type Stop = {
    stop_id: string,
    stop_lon: number,
    stop_lat: number,
    stop_name: string,
    stop_code: string
};

export type AlertSupplementalMetadata = {
    agencies: Record<string, Agency>,
    routes: Record<string, Route>,
    stops: Record<string, Stop>
};
