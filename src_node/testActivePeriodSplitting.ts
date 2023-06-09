import { DateTime } from "luxon";
import { JERUSALEM_TZ } from "./junkyard.js";
import { splitActivePeriodToSubperiods } from "./activePeriodUtils.js";

const testDataISO = [
    ["2020-01-01T04:20:00", "2020-01-01T13:37:00"],

    ["2020-01-01T04:20:00", null],
    [null, "2020-01-01T13:37:00"],
    ["2020-01-01T00:00:00", null],
    [null, "2020-01-01T00:00:00"],
    [null, null],

    ["2020-01-01T04:20:00", "2020-01-02T06:09:00"],
    ["2020-01-01T04:20:00", "2020-01-03T06:09:00"],
    ["2020-01-01T04:20:00", "2020-01-04T06:00:00"],

    ["2020-01-01T00:00:00", "2020-01-02T00:00:00"],
    ["2020-01-01T00:00:00", "2020-01-03T00:00:00"],

    ["2020-01-01T00:00:00", "2020-01-01T06:09:00"],
    ["2020-01-01T00:00:00", "2020-01-02T06:09:00"],

    ["2020-01-01T04:20:00", "2020-01-02T00:00:00"],
    ["2020-01-01T04:20:00", "2020-01-03T00:00:00"],
    ["2020-01-01T04:20:00", "2020-01-04T00:00:00"]
] as const;

const testData = testDataISO.map(
    ([start, end]) => [
        start ? DateTime.fromISO(start, {zone: JERUSALEM_TZ}).toSeconds() : null,
        end   ? DateTime.fromISO(end,   {zone: JERUSALEM_TZ}).toSeconds() : null
    ] as const
);

const splitData = testData.map(
    ([start, end]) => splitActivePeriodToSubperiods(start, end)
);

const splitDataISO = splitData.map(
    splitArr => splitArr.map(
        pair => pair?.map(d => d?.toFormat("yyyy-MM-dd'T'HH:mm:ss") ?? null) ?? null
    )
);

for (let i = 0; i < testDataISO.length && i < splitDataISO.length; i++) {
    console.log(`Period ${testDataISO[i]?.[0]} through ${testDataISO[i]?.[1]}`);
    for (let j = 0; j < (splitDataISO[i]?.length ?? 0); j++) {
        const part = splitDataISO[i]?.[j] ?? null;
        console.log(`\t${JSON.stringify(part)}`);
    }
}
