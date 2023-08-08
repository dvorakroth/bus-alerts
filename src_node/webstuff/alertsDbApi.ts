import pg from "pg";
import { AlertWithRelatedInDb } from "../dbTypes.js";

export class AlertsDbApi {
    alertsDbPool: pg.Pool;

    constructor(alertsDbPool: pg.Pool) {
        this.alertsDbPool = alertsDbPool;
    }

    async getSingleAlert(id: string): Promise<AlertWithRelatedInDb|null> {
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

        return res.rows[0] ?? null;
    }

    async getAlerts(): Promise<AlertWithRelatedInDb[]> {
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
