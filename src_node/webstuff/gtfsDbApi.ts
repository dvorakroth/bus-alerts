import pg from "pg";

export class GtfsDbApi {
    gtfsDbPool: pg.Pool;

    constructor(gtfsDbPool: pg.Pool) {
        this.gtfsDbPool = gtfsDbPool;
    }

    // TODO
}
