import { DateTime } from "luxon";
import { JERUSALEM_TZ } from "../loaderUtils/loaderJunkyard.js";
import { generateQuery__fetchAllRouteIdsAtStopsInDateranges } from "../loaderUtils/loadServiceAlertsImpl.js";

const activePeriodsISO = [
    // [null, "2020-01-01T00:00:00"],
    ["2020-01-01T04:20:00", "2020-01-04T06:00:00"],
    // ["2021-02-01T04:20:00", null]
];

const activePeriods = activePeriodsISO.map(
    ([start, end]) => [
        start ? DateTime.fromISO(start, {zone: JERUSALEM_TZ}).toSeconds() : 0,
        end   ? DateTime.fromISO(end,   {zone: JERUSALEM_TZ}).toSeconds() : 0
    ] as [number|null, number|null]
);

const {queryText, queryValues} = generateQuery__fetchAllRouteIdsAtStopsInDateranges(
    ["1", "2", "3"],
    activePeriods
);

console.log("Active periods:");
for (const [start, end] of activePeriodsISO) {
    console.log(`\tFrom ${start} to ${end}`);
}

console.log("\nGenerated query:");
console.log(queryText);
console.log("\nValue list:");
console.log(JSON.stringify(queryValues));

console.log(`Number of values: ${queryValues.length}`);

const queryParams = [...queryText.matchAll(/\$(\d+)/g)].map(m => m[1]);

console.log(`Number of $params in query: ${queryParams.length}`);

let isOk = true;
for (let i = 0; i < queryParams.length; i++) {
    if (parseInt(queryParams[i] ?? "-1") !== i + 1) {
        console.log(`The list of params is NOT OK: ${JSON.stringify(queryParams)}`);
        isOk = false;
        break;
    }
}

if (isOk) {
    console.log("The list of params is OK");
}
