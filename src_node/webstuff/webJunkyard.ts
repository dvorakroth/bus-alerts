import express from "express";
import core from "express-serve-static-core";
import { AlertsDbApi } from "./alertsDbApi.js";
import { GtfsDbApi } from "./gtfsDbApi.js";

export type DbLocals = {
    alertsDbApi: AlertsDbApi
    gtfsDbApi: GtfsDbApi
};


// https://stackoverflow.com/a/51391081
// *sigh*
export function asyncHandler<
    P = core.ParamsDictionary,
    ResBody = any,
    ReqBody = any,
    ReqQuery = core.Query,
    Locals extends Record<string, any> = Record<string, any>
>(asyncFn: express.RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals>): express.RequestHandler {
    return (req, res, next) => {
        return Promise.resolve((asyncFn as any)(req, res, next)).catch(next);
    }
}

const COORD_REGEX = /^(?<lat>\d+(\.\d+)?)_(?<lon>\d+(\.\d+)?)$/g;
export function tryParsingQueryCoordinate(coordinate: string|undefined): null|[number, number] {
    if (!coordinate) return null;

    const match = coordinate.matchAll(COORD_REGEX).next().value;
    if (!match) return null;

    return [
        Math.round(parseFloat(match.groups["lat"]) * 1_000_000) / 1_000_000,
        Math.round(parseFloat(match.groups["lon"]) * 1_000_000) / 1_000_000
    ];
}