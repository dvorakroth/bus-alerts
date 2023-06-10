import express from "express";
import { DbLocals, asyncHandler } from "./webJunkyard.js";

export const apiRouter = express.Router();

// TODO actually implement the server lol
apiRouter.get("/hello", asyncHandler(async (req, res: express.Response<any, DbLocals>) => {
    const testQueryRes = await res.locals.alertsDbPool.query<{count: number}>(
        "SELECT COUNT(*) FROM alerts;"
    );

    res.send(`hello, world! there are currently ${testQueryRes.rows[0]?.count} alerts in the database\n`);
}));
