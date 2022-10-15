class AlertDbApi:
    def __init__(self, alertconn):
        self.alertconn = alertconn
    
    def get_single_alert(self, id):
        try:
            with self.alertconn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        id,
                        first_start_time,
                        last_end_time,
                        use_case,
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
                    AND id=%s;
                    """,
                    [id]
                )

                return [
                    {
                        column.name: value
                        for column, value in zip(cursor.description, values)
                    }
                    for values in cursor.fetchall()
                ]
        finally:
            self.alertconn.rollback()
    
    def get_alerts(self):
        try:
            with self.alertconn.cursor() as cursor:
                cursor.execute("""
                    SELECT
                        id,
                        first_start_time,
                        last_end_time,
                        use_case,
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
                """)
                
                return [
                    {
                        column.name: value
                        for column, value in zip(cursor.description, values)
                    }
                    for values in cursor.fetchall()
                ]
        finally:
            self.alertconn.rollback() # will this help me with my server forgetting to close transactions?
