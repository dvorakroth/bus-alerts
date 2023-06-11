import { AddStopChange } from "../dbTypes.js";

export function parseOldAramaicRoutechgs(routechgsText: string) {
    const results: {[routeId: string]: AddStopChange[]} = {};

    for (const command of routechgsText.split(";")) {
        if (!command) {
            continue;
        }

        const values = (function() {
            const obj: {[_: string]: string} = {};
            for (const x of command.split(",")) {
                const [k, v] = x.split("=");
                obj[k??""] = v??"";
            }
            return obj;
        })();

        const routeId = values["route_id"] ?? "";
        const added_stop_id = values["add_stop_id"] ?? "";
        const is_before = values.hasOwnProperty("before_stop_id");

        if (!results.hasOwnProperty(routeId)) {
            results[routeId] = [];
        }

        results[routeId]?.push({
            added_stop_id,
            relative_stop_id: is_before
                ? (values["before_stop_id"]??"")
                : (values["after_stop_id"]??""),
            is_before
        });
    }

    return results;
}

export const OAR_PREFIX_REGION = "region=";

export function parseOldAramaicRegion(regionText: string): [string, string][] {
    // note for future me: their coords are lat,lon = y,x
    // and this function returns strings, not floats (numbers), to avoid round errors lol
    if (regionText.endsWith(";")) {
        regionText = regionText.substring(0, regionText.length - 1);
    }

    if (regionText.startsWith(OAR_PREFIX_REGION)) {
        regionText = regionText.substring(OAR_PREFIX_REGION.length);
    }

    return regionText.split(":").map(p => p.split(",") as [string, string]);
}
