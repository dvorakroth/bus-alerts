
import sys
sys.path.append('../') # i hate python so much

from load_service_alerts import GTFS_CALENDAR_DOW

class GtfsDbApi:
    def __init__(self, gtfsconn):
        self.gtfsconn = gtfsconn

    def get_all_agencies(self, specific_ids=None):
        try:
            with self.gtfsconn.cursor() as cursor:
                if specific_ids and len(specific_ids):
                    cursor.execute(
                        "SELECT agency_id, agency_name FROM agency WHERE agency_id IN %s;",
                        [tuple(specific_ids)]
                    )
                else:
                    cursor.execute(
                        "SELECT agency_id, agency_name FROM agency;"
                    )
                return {
                    values[0]: {column.name: value for column, value in zip(cursor.description, values)}
                    for values in cursor.fetchall()
                }
        finally:
            self.gtfsconn.rollback()
    
    def get_stop_metadata(self, stop_ids):
        if not stop_ids:
            return {}
        
        stop_ids = tuple(stop_ids)

        if not len(stop_ids):
            return {}
        
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    "SELECT stop_id, stop_lon, stop_lat, stop_name, stop_code FROM stops WHERE stop_id IN %s;",
                    [stop_ids]
                )
                return {
                    values[0]: {column.name: value for column, value in zip(cursor.description, values)}
                    for values in cursor.fetchall()
                }
        finally:
            self.gtfsconn.rollback()


    def get_related_metadata_for_alerts(self, alerts):
        agency_ids = set()
        route_ids = set()
        stop_ids = set()

        for alert in alerts:
            agency_ids = agency_ids.union(alert["relevant_agencies"])
            route_ids  = route_ids.union(alert["relevant_route_ids"])
            stop_ids  = stop_ids.union(alert["added_stop_ids"]).union(alert["removed_stop_ids"])
        
        return self.get_related_metadata(agency_ids, route_ids, stop_ids)

    def get_related_metadata(self, agency_ids, route_ids, stop_ids):
        agencies = {}
        routes = {}
        stops = {}

        try:
            with self.gtfsconn.cursor() as cursor:
                if len(agency_ids) > 0:
                    cursor.execute(
                        "SELECT agency_id, agency_name FROM agency WHERE agency_id IN %s;",
                        [tuple(agency_ids)]
                    )
                    agencies = {
                        values[0]: {column.name: value for column, value in zip(cursor.description, values)}
                        for values in cursor.fetchall()
                    }
                
                if len(route_ids) > 0:
                    cursor.execute(
                        "SELECT route_id, route_short_name, agency_id FROM routes WHERE route_id IN %s;",
                        [tuple(route_ids)]
                    )
                    routes = {
                        values[0]: {column.name: value for column, value in zip(cursor.description, values)}
                        for values in cursor.fetchall()
                    }
                
                if len(stop_ids) > 0:
                    cursor.execute(
                        "SELECT stop_id, stop_lon, stop_lat, stop_name, stop_code FROM stops WHERE stop_id IN %s;",
                        [tuple(stop_ids)]
                    )
                    stops = {
                        values[0]: {column.name: value for column, value in zip(cursor.description, values)}
                        for values in cursor.fetchall()
                    }
        finally:
            self.gtfsconn.rollback() # will this help me with my server forgetting to close transactions?

        return {"agencies": agencies, "routes": routes, "stops": stops}
    
    def get_all_stop_coords_by_route_ids(self, route_ids):
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT DISTINCT stop_lat, stop_lon
                        FROM stops
                        INNER JOIN stoptimes ON stops.stop_id = stoptimes.stop_id
                        INNER JOIN trips ON stoptimes.trip_id = trips.trip_id
                        WHERE trips.route_id in %s;
                    """,
                    [tuple(route_ids)]
                )

                return cursor.fetchall()
        finally:
            self.gtfsconn.rollback()
    
    def get_representative_trip_id(self, route_id, preferred_date):
        preferred_date = preferred_date.replace(
            tzinfo=None,
            hour=0,
            minute=0,
            second=0,
            microsecond=0
        )

        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT trips.trip_id
                        FROM trips
                        INNER JOIN calendar on trips.service_id = calendar.service_id
                        WHERE route_id=%s
                        ORDER BY
                            daterange(start_date, end_date + 1) @> %s::DATE DESC,
                            start_date - %s::DATE <= 0 DESC,
                            ABS(start_date - %s::DATE) ASC,
                            """ + GTFS_CALENDAR_DOW[preferred_date.weekday()] + """ DESC
                        LIMIT 1;
                    """,
                    [
                        route_id,
                        preferred_date,
                        preferred_date,
                        preferred_date
                    ]
                )

                return cursor.fetchone()[0]
        finally:
            self.gtfsconn.rollback()

    def get_stop_seq(self, trip_id):
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT stops.stop_id
                        FROM stops
                        INNER JOIN stoptimes ON stops.stop_id = stoptimes.stop_id
                        WHERE stoptimes.trip_id = %s
                        ORDER BY stop_sequence ASC;
                    """,
                    [
                        trip_id
                    ]
                )

                return [values[0] for values in cursor.fetchall()]
        finally:
            self.gtfsconn.rollback()
    
    def get_route_metadata(self, route_id):
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT
                            routes.route_id,
                            routes.route_desc,
                            routes.agency_id,
                            route_short_name as line_number,
                            agency_name
                        FROM routes
                        INNER JOIN agency
                        ON routes.agency_id = agency.agency_id
                        WHERE route_id = %s;
                    """,
                    [
                        route_id
                    ]
                )

                row = cursor.fetchone()

                if not row or not cursor.description:
                    return {}

                return {
                    column.name: value
                    for column, value in zip(cursor.description, row)
                }
        finally:
            self.gtfsconn.rollback()
    
    def get_trip_headsign(self, trip_id):
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT
                            trip_headsign
                        FROM trips
                        WHERE trip_id = %s;
                    """,
                    [
                        trip_id
                    ]
                )

                return cursor.fetchone()[0]
        finally:
            self.gtfsconn.rollback()
    
    def get_stop_desc(self, stop_ids):
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT
                            stop_id,
                            stop_desc
                        FROM stops
                        WHERE stop_id IN %s;
                    """,
                    [
                        tuple(stop_ids)
                    ]
                )

                return {
                    row[0]: row[1]
                    for row in cursor.fetchall()
                }
        finally:
            self.gtfsconn.rollback()
    
    def get_shape_points(self, trip_id):
        """ finds a trip's shape, and returns a list [(lon, lat), (lon, lat), ...] """
        try:
            with self.gtfsconn.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT
                            shape_pt_lon,
                            shape_pt_lat
                        FROM shapes
                        WHERE shapes.shape_id=(SELECT trips.shape_id FROM trips WHERE trip_id=%s)
                        ORDER BY shape_pt_sequence ASC;
                    """,
                    [
                        trip_id
                    ]
                )

                return [tuple(lonlat) for lonlat in cursor.fetchall()]
        finally:
            self.gtfsconn.rollback()
    
    def get_stops_for_map(self, stop_ids):
        try:
            with self.gtfsconn.cursor() as cursor:
                if len(stop_ids) > 0:
                    cursor.execute(
                        """
                            SELECT
                                stop_id,
                                stop_lon,
                                stop_lat
                            FROM stops
                            WHERE stop_id IN %s;
                        """,
                        [tuple(stop_ids)]
                    )
                    return {
                        values[0]: {
                            column.name: value
                            for column, value in zip(cursor.description, values)
                            if column.name != "stop_id"
                        }
                        for values in cursor.fetchall()
                    }
        finally:
            self.gtfsconn.rollback()