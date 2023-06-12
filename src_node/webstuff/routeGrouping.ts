import fs from "fs";
import pg from "pg";
import { Agency } from "../apiTypes.js";
import { GtfsDbApi } from "./gtfsDbApi.js";
import { ActualLine, tmp__actual_lines_Row } from "../dbTypes.js";

export type GroupedRoutes = {
    allAgencies: Record<string, Agency>;
    actualLinesList: ActualLine[];
    actualLinesDict: Record<string, ActualLine>;
    actualLinesByRouteId: Record<string, string>;
};

export async function groupRoutes(
    routeGroupingScriptPath: string,
    gtfsDbPool: pg.Pool
): Promise<GroupedRoutes> {
    const allAgencies = await new GtfsDbApi(gtfsDbPool).getAllAgencies();
    const actualLinesList: ActualLine[] = [];
    const actualLinesDict: Record<string, ActualLine> = {};
    const actualLinesByRouteId: Record<string, string> = {};

    // this feels so dirty lmao
    const sqlScript = fs.readFileSync(routeGroupingScriptPath, {encoding: "utf-8"});
    
    let conn: pg.PoolClient|null = null;
    let rows: tmp__actual_lines_Row[]|null = null;

    try {
        conn = await gtfsDbPool.connect();

        await conn.query(sqlScript); // like bestie WHAT
        const res = await conn.query<tmp__actual_lines_Row>(
            `SELECT *
            FROM tmp__actual_lines
            ORDER BY route_short_name, agency_id, mot_license_id;`
        );

        rows = res.rows;
    } finally {
        if (conn) conn.release(true);
    }

    for (const row of rows) {
        const actualLine = <ActualLine>{
            ...row,
            headsign_1: row.headsign_1?.replace("_", " - ") ?? null,
            headsign_2: row.headsign_2?.replace("_", " - ") ?? null,

            pk: row.route_short_name + "_" + row.mot_license_id,
            main_cities: [],
            secondary_cities: []
        };

        const allAltCities = new Set<string>();

        let isFirstAlt = true;

        for (const alt of actualLine.all_directions_grouped) {
            for (const dir of alt.directions) {
                dir.headsign = dir.headsign?.replace("_", " - ") ?? null;

                // wheeee so much nesting
                if (isFirstAlt) {
                    for (const city of dir.city_list) {
                        if (!actualLine.main_cities.includes(city)) {
                            actualLine.main_cities.push(city);
                        }
                    }
                } else {
                    for (const city of dir.city_list) {
                        allAltCities.add(city);
                    }
                }

                actualLinesByRouteId[dir.route_id] = actualLine.pk;
            }

            isFirstAlt = false;
        }

        for (const city of actualLine.main_cities) {
            allAltCities.delete(city);
        }

        actualLine.secondary_cities = [...allAltCities].sort();

        actualLinesList.push(actualLine);
        actualLinesDict[actualLine.pk] = actualLine;
    }

    return {
        allAgencies,
        actualLinesByRouteId,
        actualLinesDict,
        actualLinesList
    };
}
