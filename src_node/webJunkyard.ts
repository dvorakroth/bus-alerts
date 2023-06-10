import pg from "pg";
import express from "express";
import core from "express-serve-static-core";

export type DbLocals = {
    gtfsDbPool: pg.Pool,
    alertsDbPool: pg.Pool
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
