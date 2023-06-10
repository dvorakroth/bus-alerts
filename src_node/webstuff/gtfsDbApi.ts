import pg from "pg";
import { AlertWithRelatedInDb } from "../dbTypes.js";
import { copySortAndUnique } from "../generalJunkyard.js";

export class GtfsDbApi {
    gtfsDbPool: pg.Pool;

    constructor(gtfsDbPool: pg.Pool) {
        this.gtfsDbPool = gtfsDbPool;
    }

    async getRelatedMetadataForAlerts(alerts: AlertWithRelatedInDb[]) {
        const agencyIds = [];
        const routeIds = [];
        const stopIds = [];

        for (const alert of alerts) {
            agencyIds.push(...alert.relevant_agencies);
            routeIds.push(...alert.relevant_route_ids);
            stopIds.push(...alert.added_stop_ids, ...alert.removed_stop_ids);
        }

        return await this.getRelatedMetadata(
            copySortAndUnique(agencyIds),
            copySortAndUnique(routeIds),
            copySortAndUnique(stopIds)
        );
    }

    async getRelatedMetadata(
        agencyIds: string[],
        routeIds: string[],
        stopIds: string[]
    ) {
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

        return {agencies, routes, stops};
    }
}

type Agency = {
    agency_id: string,
    agency_name: string
};

type Route = {
    route_id: string,
    route_short_name: string,
    agency_id: string
};

type Stop = {
    stop_id: string,
    stop_lon: string,
    stop_lat: string,
    stop_name: string,
    stop_code: string
};
