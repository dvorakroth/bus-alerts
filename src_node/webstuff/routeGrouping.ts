import pg from "pg";
import { Agency } from "../apiTypes.js";
import { GtfsDbApi } from "./gtfsDbApi.js";
import { ActualLine, actual_lines_Row } from "../dbTypes.js";

export type GroupedRoutes = {
    allAgencies: Record<string, Agency>;
    actualLinesList: ActualLine[];
    actualLinesDict: Record<string, ActualLine>;
    actualLinesByRouteId: Record<string, string>;
};

export async function getGroupedRoutes(
    gtfsDbPool: pg.Pool
): Promise<GroupedRoutes> {
    const allAgencies = await new GtfsDbApi(gtfsDbPool).getAllAgencies();
    const actualLinesList: ActualLine[] = [];
    const actualLinesDict: Record<string, ActualLine> = {};
    const actualLinesByRouteId: Record<string, string> = {};

    const res = await gtfsDbPool.query<actual_lines_Row>(
        `SELECT *
        FROM actual_lines
        ORDER BY route_short_name, agency_id, mot_license_id;`
    );

    for (const row of res.rows) {
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
