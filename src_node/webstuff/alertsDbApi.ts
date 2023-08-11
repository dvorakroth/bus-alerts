import pg from "pg";
import { AlertWithRelatedInDb } from "../dbTypes.js";

export class AlertsDbApi {
    alertsDbPool: pg.Pool;
    timedOps: boolean;

    constructor(alertsDbPool: pg.Pool, timedOps?: boolean) {
        this.alertsDbPool = alertsDbPool;
        this.timedOps = !!timedOps;
    }

    async getSingleAlert(id: string): Promise<AlertWithRelatedInDb|null> {
        if (this.timedOps) console.time("AlertsDbApi.getSingleAlert");
        const res = await this.alertsDbPool.query<AlertWithRelatedInDb, [string]>(
            `
                SELECT
                    id,
                    first_start_time,
                    last_end_time,
                    use_case,
                    original_selector,
                    header,
                    description,
                    active_periods,
                    schedule_changes,
                    is_national,
                    is_deleted,
                    relevant_agencies,
                    relevant_route_ids,
                    added_stop_ids,
                    removed_stop_ids,
                    is_expired
                FROM alerts_with_related
                WHERE NOT (is_deleted AND is_expired)
                AND id=$1;
            `,
            [id]
        );
        if (this.timedOps) console.timeEnd("AlertsDbApi.getSingleAlert");

        return res.rows[0] ?? null;
    }

    async getAlerts(): Promise<AlertWithRelatedInDb[]> {
        if (this.timedOps) console.time("AlertsDbApi.getAlerts");
        const res = await this.alertsDbPool.query<AlertWithRelatedInDb>(
            `
                SELECT
                    id,
                    first_start_time,
                    last_end_time,
                    use_case,
                    original_selector,
                    header,
                    description,
                    active_periods,
                    schedule_changes,
                    is_national,
                    is_deleted,
                    relevant_agencies,
                    relevant_route_ids,
                    added_stop_ids,
                    removed_stop_ids,
                    is_expired
                FROM alerts_with_related
                WHERE NOT (is_deleted AND is_expired);
            `
        );
        if (this.timedOps) console.timeEnd("AlertsDbApi.getAlerts");

        return res.rows;
    }

    async getSingleAlertRawData(alertId: string): Promise<Buffer|null> {
        const res = await this.alertsDbPool.query<{raw_data: Buffer}>(
            `SELECT raw_data FROM alert WHERE id=$1::varchar;`,
            [alertId]
        );

        return res.rows[0]?.raw_data ?? null;
    }
}
