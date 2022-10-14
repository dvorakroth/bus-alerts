#!/usr/bin/env python3
"""Service Alerts App Web Server.

Usage:
    web_server.py [-c <file>]

Options:
    -c <file>, --config <file>       Use the specified configuration file.
"""


from datetime import datetime, timezone
from functools import reduce
import json
import math
import operator
import re
from copy import deepcopy

import cachetools, cachetools.func
import cherrypy
import psycopg2
import pytz
from pyproj import Transformer
import shapely.geometry

from load_service_alerts import JERUSALEM_TZ, parse_old_aramaic_region, GTFS_CALENDAR_DOW, USE_CASE, parse_unixtime_into_jerusalem_tz

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


class GtfsDbApi:
    def __init__(self, gtfsconn):
        self.gtfsconn = gtfsconn

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
        preferred_date = preferred_date.replace(tzinfo=None)

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

                return {
                    column.name: value
                    for column, value in zip(cursor.description, cursor.fetchone())
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

def line_number_for_sorting(line_number):
    for s in line_number.split():
        if s.isdigit():
            return (int(s), line_number)
    
    return (-1, line_number)

JERUSALEM_TZ = pytz.timezone('Asia/Jerusalem')

# def text_match(filter_string, *other_strings):
#     # naive approach lol
#     for f in filter_string.split():
#         for s in other_strings:
#             if f in s:
#                 return True
    
#     return False

# def filter_alerts(filter_string, alerts, metadata):
#     # this function should be run AFTER the metadata gets chewed up
#     # this function is a wolf pup uwu

#     if not filter_string:
#         return alerts

#     return filter(
#         lambda alert: text_match(
#             filter_string,
#             alert["header"]["he"],
#             alert["description"]["he"],
#             *map(
#                 lambda agency_id: metadata["agencies"][agency_id]["agency_name"],
#                 alert["relevant_agencies"]
#             ),
#             *map(lambda x: x[0], alert["relevant_lines"]),
#             *reduce(operator.add, alert["added_stops"] + alert["removed_stops"], tuple())
#         ),
#         alerts
#     )

COORD_TRANSFORMER = Transformer.from_crs("EPSG:4326", "EPSG:2039")

def coordinate_for_stop(stop_id, metadata):
    s = metadata["stops"][stop_id]
    return (s["stop_lat"], s["stop_lon"])

def euclidean_distance(point_a, point_b):
    return math.sqrt(
        (point_a[0] - point_b[0]) ** 2
        +
        (point_a[1] - point_b[1]) ** 2
    )

# cache but only by current_location_tuple and alert["id"]
DISTANCE_CACHE = cachetools.TTLCache(maxsize=2048, ttl=600)

def cached_distance_to_alert(current_location_tuple, alert, metadata, gtfsdbapi):
    cache_key = (current_location_tuple, alert["id"])

    if cache_key not in DISTANCE_CACHE:
        DISTANCE_CACHE[cache_key] = _calculate_distance_to_alert(
            current_location_tuple,
            alert,
            metadata,
            gtfsdbapi
        )
    
    return DISTANCE_CACHE[cache_key]
    

def _calculate_distance_to_alert(current_location_tuple, alert, metadata, gtfsdbapi):
    """calculates distance to alert from current_location_tuple, and returns the result or None"""
    if not current_location_tuple:
        return None
    
    current_location_transformed = COORD_TRANSFORMER.transform(*current_location_tuple)

    if alert["use_case"] == USE_CASE.REGION.value \
            and not alert["added_stops"] and not alert["removed_stops"]:
        # in the weird case where they define a polygon with no stops,
        # use distance to that polygon
        parsed_region = parse_old_aramaic_region(alert["original_selector"]["old_aramaic"])
        coords = map(
            lambda x: (float(x[0]), float(x[1])),
            parsed_region
        )
        transformed_coords = COORD_TRANSFORMER.itransform(coords)
        polygon = shapely.geometry.Polygon(transformed_coords)
        return shapely.geometry.Point(*current_location_transformed).distance(polygon)
    
    all_stop_ids = set(alert["added_stop_ids"]).union(set(alert["removed_stop_ids"]))

    all_stop_coords = None

    if all_stop_ids:
        all_stop_coords = map(
            lambda x: coordinate_for_stop(x, metadata),
            all_stop_ids
        )
    elif alert["relevant_route_ids"]:
        all_stop_coords = gtfsdbapi.get_all_stop_coords_by_route_ids(alert["relevant_route_ids"])
    
    if all_stop_coords:
        all_transformed_locations = COORD_TRANSFORMER.itransform(all_stop_coords)

        all_euclidean_distances = map(
            lambda x: euclidean_distance(current_location_transformed, x),
            all_transformed_locations
        )

        return min(all_euclidean_distances)
    
    return None

def find_representative_date_for_route_changes_in_alert(alert):
    _active_periods_parsed = map(
        lambda period: list(map(parse_unixtime_into_jerusalem_tz, period)),
        alert["active_periods"]["raw"]
    )

    TODAY_IN_JERUS = JERUSALEM_TZ \
        .fromutc(datetime.utcnow())\
        .replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0
        )
    
    representative_date = None

    if alert["is_expired"]:
        for start, end in _active_periods_parsed:
            if end is None:
                representative_date = TODAY_IN_JERUS
                break
            
            if representative_date is None or end > representative_date:
                representative_date = end
    elif alert["is_deleted"]:
        representative_date = alert["last_end_time"].replace(hour=0, minute=0, second=0, microsecond=0)
    #   TODO representative_date = deleted_date
    else:
        for start, end in _active_periods_parsed:
            hasStart = start is not None
            hasEnd   = end is not None

            if not hasEnd and not hasStart:
                # unbounded period - use today
                representative_date = TODAY_IN_JERUS
                break
            
            if hasEnd and end <= TODAY_IN_JERUS:
                # period ended already, skip it
                continue
            
            if not hasStart or start <= TODAY_IN_JERUS:
                # period is active now!
                representative_date = TODAY_IN_JERUS
                break

            # period is in the future

            if representative_date is None or start < representative_date:
                representative_date = start
    
    return representative_date # or TODAY_IN_JERUS?????

def remove_all_occurrences_from_list(l, item):
    count = 0
    finished = False

    while not finished:
        try:
            l.remove(item)
            count += 1
        except ValueError:
            # why tf does python use exceptions for something that should be
            # a return value ugh
            finished = True
    
    return count

# cursed and bad and stupid and of course this is what the mot gives us
STOP_DESC_CITY_PATTERN = re.compile('עיר: (.*) רציף:')

def extract_city_from_stop_desc(stop_desc):
    return STOP_DESC_CITY_PATTERN.findall(stop_desc)[0]

# am i gonna understand this regex in a week? let's find out!
ROUTE_DESC_DIR_ALT_PATTERN = re.compile(r'^[^-]+-([^-]+)-([^-]+)$')

def label_headsigns_for_direction_and_alternative(line_changes):
    """for chg in line_changes: adds (direction 1, alternative 2) labels to duplicate headsigns,
    and deletes route_desc from the dictionary"""

    route_desc_by_headsign = {}

    for chg in line_changes:
        headsign = chg["to_text"]
        route_desc = chg["route_desc"]

        if headsign not in route_desc_by_headsign:
            route_desc_by_headsign[headsign] = []
        
        route_desc_by_headsign[headsign].append(ROUTE_DESC_DIR_ALT_PATTERN.findall(route_desc)[0])
    
    # two iterations over the dataset cause im dumb and was never any good at algorithms
    for chg in line_changes:
        other_dups = route_desc_by_headsign[chg["to_text"]]

        if len(other_dups) == 1:
            # no duplicates for this headsign! yay upside down smiley
            del chg["route_desc"]
            continue
        
        dir_id, alt_id = ROUTE_DESC_DIR_ALT_PATTERN.findall(chg["route_desc"])[0]
        del chg["route_desc"]

        if any(map(lambda x: x[0] != dir_id, other_dups)):
            # if there's any dups with a different direction id

            # in some distant nebulous future, i could try giving actual names
            # to the directions and alternatives; but not today, not quite yet
            # bukra fil mishmish
            chg["dir_name"] = str(
                # possibly the slowest most inefficient way to do this but as
                # stated earlier, yours truly is truly bad at algo
                sorted(set([d for d, a in other_dups])).index(dir_id) + 1
            )
        
        if alt_id != '#' and any(map(lambda x: x[1] != alt_id, other_dups)):
            # if there's any dups with a different alternative id
            # (and also this isn't the main alternative)

            # remember what i said about actual names for directions?
            # well, same for the alternatives
            # i mean, like, how the heck does one even approach this problem???
            # we're given basically zero computer readable information that
            # summarizes the differences between directions/alternatives!
            # i guess if someone was eager enough, they COULD go through the
            # stop_seq of a representative trip, but then, how do you turn that
            # into not only user-readable info, but user-useful info, that isn't
            # too long to fit in the ui?????? can't just dump stop names/city names,
            # and detecting street names would be absolutely hellish
            
            # so uhm,, yeah
            # numbers it is for now

            # again possibly the slowest most inefficient blah blah blah
            # note: if a != '#' cause we don't care about the main alternative here
            # i want to display: Towards A, Towards A (Alt 1), Towards A (Alt 2)
            # and not quite:     Towards A, Towards A (Alt 2), Towards A (Alt 3)
            alternatives = sorted(set([a for d, a in other_dups if a != '#']))

            if len(alternatives) == 1:
                # but also we want to display: Towards A, Towards A (Alt)
                # and not qutie:               Towards A, Towards A (Alt 1)
                # because "1" doesn't makes sense when there's just the one
                chg["alt_name"] = "#"
            else:
                chg["alt_name"] = str(alternatives.index(alt_id) + 1)

def sort_alerts(alerts):
    return sorted(
        # filter_alerts(search_string, alerts, metadata),
        alerts,
        key=lambda alert: (
            alert["is_expired"],
            alert["is_deleted"],
            alert.get("distance", math.inf),
            alert.get("current_active_period_start", None) or alert["last_end_time"],
            (not alert["is_national"]) if (alert["is_expired"] or alert["is_deleted"]) else False
        )
    )

def deepcopy_decorator(func):
    return lambda *x, **y: deepcopy(func(*x, **y))

ROUTE_CHANGES_CACHE = cachetools.TTLCache(maxsize=512, ttl=600)

class ServiceAlertsApiServer:
    def __init__(self, gtfsconn, alertconn):
        self.gtfsdbapi  = GtfsDbApi(gtfsconn)
        self.alertdbapi = AlertDbApi(alertconn)
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def all_alerts(self, current_location=None):
        alerts, metadata = None, None

        current_location_tuple = None
        if current_location:
            current_location_tuple = tuple(
                round(float(n), 6)
                for n in current_location.split('_')[:2]
            )
            alerts, metadata = self._all_alerts_with_location(current_location_tuple)
        else:
            alerts, metadata = self._all_alerts()

        for a in alerts:
            self._clean_up_alert_dict(a)
        
        return {
            "alerts": alerts
        }
        
    @deepcopy_decorator
    @cachetools.func.ttl_cache(ttl=600)
    def _all_alerts(self):
        alerts = self.alertdbapi.get_alerts()

        alerts, metadata = self._enrich_alerts(alerts)

        return alerts, metadata
    
    @deepcopy_decorator
    @cachetools.func.ttl_cache(ttl=600)
    def _all_alerts_with_location(self, current_location_tuple):
        alerts, metadata = self._all_alerts()

        alerts = self._add_distance_to_alerts(alerts, metadata, current_location_tuple)

        return alerts, metadata
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def single_alert(self, id, current_location=None):
        current_location_tuple = None
        if current_location:
            current_location_tuple = tuple(
                round(float(n), 6)
                for n in current_location.split('_')[:2]
            )
        
        result, metadata = self._single_alert(id)

        if not result:
            # an alert with this id was probably not found in the db
            return {"alerts": []}

        alert = result["alerts"][0]

        if current_location_tuple:
            alert["distance"] = cached_distance_to_alert(
                current_location_tuple,
                alert,
                metadata,
                self.gtfsdbapi
            )
        
        self._clean_up_alert_dict(alert)
        
        return result

    @deepcopy_decorator
    @cachetools.func.ttl_cache(ttl=600)
    def _single_alert(self, id):
        alerts = self.alertdbapi.get_single_alert(id)

        if not alerts:
            return None, None

        alerts, metadata = self._enrich_alerts(alerts)
        result = {"alerts": alerts}
        result.update(self._cached_route_changes(id, alert=alerts[0]))

        return result, metadata
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def get_route_changes(self, id):
        return self._cached_route_changes(id)
    
    def _clean_up_alert_dict(self, alert):
        # delete stuff that isn't used by the client
        # (only run this AFTER all the enrichments and fetching route changes)
        del alert["schedule_changes"]
        del alert["relevant_route_ids"]
        del alert["added_stop_ids"]
        del alert["removed_stop_ids"]

    def _enrich_alerts(self, alerts):
        # chew up and regurgitate the data a bit for the client
        # like a wolf mother for her tiny adorable wolf pups

        metadata = self.gtfsdbapi.get_related_metadata_for_alerts(alerts)

        today_in_jerus = datetime.now(JERUSALEM_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        # tomorrow_in_jerus = today_in_jerus + timedelta(days=1)

        for alert in alerts:
            added_stops = set([])
            removed_stops = set([])
            lines = {}

            for stop_id in alert["added_stop_ids"]:
                stop = metadata["stops"].get(stop_id, None)
                if stop:
                    added_stops.add((stop["stop_code"], stop["stop_name"]))
            for stop_id in alert["removed_stop_ids"]:
                stop = metadata["stops"].get(stop_id, None)
                if stop:
                    removed_stops.add((stop["stop_code"], stop["stop_name"]))
            
            for route_id in alert["relevant_route_ids"]:
                route = metadata["routes"].get(route_id, None)

                if route:
                    lines_for_agency = lines.get(route["agency_id"], set([]))
                    lines_for_agency.add(route["route_short_name"])
                    lines[route["agency_id"]] = lines_for_agency
            
            alert["added_stops"]    = sorted(added_stops,   key=lambda x: line_number_for_sorting(x[0]))
            alert["removed_stops"]  = sorted(removed_stops, key=lambda x: line_number_for_sorting(x[0]))
            alert["relevant_lines"] = {
                agency_id: sorted(line_numbers, key=line_number_for_sorting)
                for agency_id, line_numbers in lines.items()
            }
            alert["relevant_agencies"] = sorted(
                map(lambda agency_id: metadata["agencies"][agency_id], alert["relevant_agencies"]),
                key=lambda agency: agency["agency_name"]
            )

            # convert list of active_periods from stupid local unixtime to datetime objects with pytz
            active_periods_raw = alert["active_periods"]["raw"]
            _active_periods_parsed = map(
                lambda period: list(map(parse_unixtime_into_jerusalem_tz, period)),
                active_periods_raw
            )

            # find next relevant date
            first_relevant_date = None
            current_active_period_start = None

            if not alert["is_deleted"] and not alert["is_expired"]:
                for period_start, period_end in _active_periods_parsed:
                    # period_start = \
                    #     JERUSALEM_TZ.localize(datetime.fromtimestamp(period_start_unixtime, timezone.utc).replace(tzinfo=None)) \
                    #     if period_start_unixtime is not None and period_start_unixtime != 0 else None
                    
                    # period_end = \
                    #     JERUSALEM_TZ.localize(datetime.fromtimestamp(period_end_unixtime, timezone.utc).replace(tzinfo=None)) \
                    #     if period_end_unixtime is not None and period_end_unixtime != 0 else None
                    
                    # make sure this period hasn't expired yet; if it has, ignore it
                    if period_end is not None and period_end <= today_in_jerus:
                        continue

                    # if this period already started (given it's not expired), then it's relevant to today
                    if period_start is None or period_start <= today_in_jerus:
                        first_relevant_date = today_in_jerus
                        current_active_period_start = period_start if period_start is not None else \
                            JERUSALEM_TZ.localize(datetime.fromtimestamp(0, timezone.utc).replace(tzinfo=None))
                        break # definitely relevant to today, so stop iterating

                    # period is in the future
                    d = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
                    if first_relevant_date is None or d < first_relevant_date:
                        first_relevant_date = d
                        current_active_period_start = period_start
            
            alert["first_relevant_date"] = first_relevant_date
            alert["current_active_period_start"] = \
                None if current_active_period_start is None \
                    else current_active_period_start.replace(tzinfo=None)

            alert.update(self._get_departure_changes(alert["id"], alert))


        return sort_alerts(alerts), metadata
    
    def _add_distance_to_alerts(self, alerts, metadata, current_location_tuple):
        # this used to be at the end of every iteration of the Big loop in _enrich_alerts
        # but for caching's sake, i took it out of there
        for alert in alerts:
            distance = cached_distance_to_alert(
                current_location_tuple,
                alert,
                metadata,
                self.gtfsdbapi
            )

            if distance is not None: # so we don't confuse the sort (can't < None and float)
                alert["distance"] = distance
        
        return sort_alerts(alerts)

    # cache but only by alert_id
    @deepcopy_decorator
    def _cached_route_changes(self, alert_id, alert=None):
        if alert_id not in ROUTE_CHANGES_CACHE:
            ROUTE_CHANGES_CACHE[alert_id] = self._uncached_get_route_changes(alert_id, alert)
        
        return ROUTE_CHANGES_CACHE[alert_id]

    def _uncached_get_route_changes(self, alert_id, alert=None):
            
            # 1. get alert and relevant routes, if no route changes return {}

            if alert is None:
                alert = self.alertdbapi.get_single_alert(alert_id)[0]
            
            if alert["use_case"] not in [
                USE_CASE.STOPS_CANCELLED.value, USE_CASE.ROUTE_CHANGES_FLEX.value, USE_CASE.ROUTE_CHANGES_SIMPLE.value
            ]:
                return {}
            
            representative_date = find_representative_date_for_route_changes_in_alert(alert)
            changes_by_agency_and_line = {}

            all_stop_ids = set(alert["removed_stop_ids"]).union(set(alert["added_stop_ids"]))
            near_added_stop_ids = set([])

            for route_id in alert["relevant_route_ids"]:
                # 2. for each route, get a representative trip (haha easy peasy)
                representative_trip_id = self.gtfsdbapi.get_representative_trip_id(route_id, representative_date)
                raw_stop_seq = self.gtfsdbapi.get_stop_seq(representative_trip_id)
                all_stop_ids.update(raw_stop_seq)

                stop_seq = [
                    (stop_id, False) # (stop_id, is_added)
                    for stop_id in raw_stop_seq
                ]
                deleted_stop_ids = []

                # 3. for each route, compute new reperesentative trip (actually easy)
                if alert["use_case"] == USE_CASE.STOPS_CANCELLED.value:
                    # special case :|
                    for removed_stop_id in alert["removed_stop_ids"]:
                        times_removed = remove_all_occurrences_from_list(
                            stop_seq,
                            (removed_stop_id, False)
                        )

                        if times_removed > 0 or len(alert["relevant_route_ids"]) == 1:
                            deleted_stop_ids.append(removed_stop_id)
                else:
                    # changes_for_route = alert.get("schedule_changes", {}).get(route_id, [])
                    changes_for_route = alert["schedule_changes"][route_id]

                    for change in changes_for_route:
                        if "removed_stop_id" in change:
                            times_removed = remove_all_occurrences_from_list(
                                stop_seq,
                                (change["removed_stop_id"], False)
                            )

                            if times_removed == 0:
                                cherrypy.log(f"tried removing stop that's not on a route; route_id={route_id}, {repr(change)}, alert_id={alert_id or alert['id']}, trip_id={representative_trip_id})")
                            
                            if times_removed > 0 or len(alert["relevant_route_ids"]) == 1:
                                deleted_stop_ids.append(change["removed_stop_id"])
                        elif "added_stop_id" in change:
                            dest_idx = None
                            for idx, t in enumerate(stop_seq):
                                # can't JUST search for (relative_stop_id, False) because the
                                # relative_stop_id might have been added some previous iteration
                                if t[0] == change["relative_stop_id"]:
                                    dest_idx = idx
                                    break
                                # nice lil edge case the mot didn't think about:
                                # what if a trip stops somewhere twice, and we're told to add
                                # another stop before/after that one that appears twice?

                                # should i like check for that edge case? and put the stop.....
                                # uhm.... where.... the .... distance to the other stops?
                                # is shortest? idk; or i'll just bug, and blame the government
                                # because that's easier
                            
                            if dest_idx is None:
                                # didn't find the stop we're supposed to add relative to
                                cherrypy.log(
                                    f"tried adding stop relative to stop not on route; route_id={route_id}, {repr(change)}, alert_id={alert_id or alert['id']}, trip_id={representative_trip_id}"
                                )
                                continue

                            if not change["is_before"]:
                                dest_idx += 1
                            
                            stop_seq.insert(dest_idx, (change["added_stop_id"], True))
                            cherrypy.log(f"added stop {change['added_stop_id']} to route {route_id} at index {dest_idx}")

                # --> 3+1/2. for the map bounding box, collect all stop_ids of stops that
                # are adjacent to added stops

                prev_stop_id, prev_stop_is_added = stop_seq[1]
                for stop_id, is_added in stop_seq[1:]:
                    if is_added and not prev_stop_is_added:
                        near_added_stop_ids.add(prev_stop_id)
                    elif not is_added and prev_stop_is_added:
                        near_added_stop_ids.add(stop_id)

                    prev_stop_id, prev_stop_is_added = stop_id, is_added

                # 4. decide what to call each route???? as in from/to????? aaaaa israel
                #    (and get route_short_name and agency_id)
                route_metadata = self.gtfsdbapi.get_route_metadata(route_id)

                route_metadata["to_text"] = self._get_headsign(representative_trip_id, raw_stop_seq)

                # 5. get shape
                shape = self.gtfsdbapi.get_shape_points(representative_trip_id)

                if not shape:
                    # use straight lines if there's no shape
                    stop_data = self.gtfsdbapi.get_stops_for_map(raw_stop_seq)

                    shape = [
                        [stop_data[stop_id]["stop_lon"], stop_data[stop_id]["stop_lat"]]
                        for stop_id in raw_stop_seq
                    ]


                route_metadata["updated_stop_sequence"] = stop_seq
                route_metadata["deleted_stop_ids"] = deleted_stop_ids
                route_metadata["shape"] = shape

                # add to the dict
                agency_id = route_metadata["agency_id"]
                line_number = route_metadata["line_number"]

                if agency_id not in changes_by_agency_and_line:
                    changes_by_agency_and_line[agency_id] = {}
                
                if line_number not in changes_by_agency_and_line[agency_id]:
                    changes_by_agency_and_line[agency_id][line_number] = []
                
                changes_by_agency_and_line[agency_id][line_number].append(route_metadata)

                cherrypy.log("done processing route_id " + route_id)
            
            # --> bonus step cause i'm thorough, and motivated by hatred and spite:
            #     sort out any duplicate to_text
            for agency_id in changes_by_agency_and_line:
                for line_number, line_changes in changes_by_agency_and_line[agency_id].items():
                    label_headsigns_for_direction_and_alternative(line_changes)

            # 6. get all stops' metadata
            stops_for_map = self.gtfsdbapi.get_stops_for_map(all_stop_ids)

            # 7. sort each line's changes by.... uhhhh..... good question le'ts
            #    decide on this issue randomly lmao
            for agency_id in changes_by_agency_and_line:
                for line_number in changes_by_agency_and_line[agency_id]:
                    changes_by_agency_and_line[agency_id][line_number].sort(
                        key=lambda x: (
                            x["to_text"],
                            x.get("dir_name", None) or "",
                            x.get("alt_name", None) or ""
                        )
                        # other candidates:
                        #  - always north->south/west->east before opposite?
                        #  - always big place to small place before opposite?
                        #  - by gtfs direction_id???
                        #  - by mot route license id thing (route_desc)
                        #  - random order for maximum fun! party horn emoji!
                    )
            
            # 8. get bounding box of affected stops, for setting the map's bounding box
            map_bounding_box = {
                "min_lon": None,
                "min_lat": None,
                "max_lon": None,
                "max_lat": None
            }

            for stop_id in alert["added_stop_ids"] + alert["removed_stop_ids"] + list(near_added_stop_ids):
                try:
                    stop = stops_for_map[stop_id]
                except KeyError:
                    continue

                lon = stop["stop_lon"]
                lat = stop["stop_lat"]

                if map_bounding_box["min_lon"] is None or map_bounding_box["min_lon"] > lon:
                    map_bounding_box["min_lon"] = lon
                if map_bounding_box["min_lat"] is None or map_bounding_box["min_lat"] > lat:
                    map_bounding_box["min_lat"] = lat
                if map_bounding_box["max_lon"] is None or map_bounding_box["max_lon"] < lon:
                    map_bounding_box["max_lon"] = lon
                if map_bounding_box["max_lat"] is None or map_bounding_box["max_lat"] < lat:
                    map_bounding_box["max_lat"] = lat

            return {
                "route_changes": changes_by_agency_and_line,
                "stops_for_map": stops_for_map,
                "map_bounding_box": map_bounding_box
            }
    
    def _get_headsign(self, representative_trip_id, raw_stop_seq=None):
        headsign = self.gtfsdbapi.get_trip_headsign(representative_trip_id)

        if raw_stop_seq is None:
            raw_stop_seq = self.gtfsdbapi.get_stop_seq(representative_trip_id)

        if headsign and len(headsign):
            return headsign.replace('_', ' - ')
        else:
            first_stop_id = raw_stop_seq[0]
            last_stop_id = raw_stop_seq[-1]

            endstops_desc = self.gtfsdbapi.get_stop_desc([first_stop_id, last_stop_id])

            first_stop_city = extract_city_from_stop_desc(endstops_desc[first_stop_id])
            last_stop_city = extract_city_from_stop_desc(endstops_desc[last_stop_id])

            if first_stop_city != last_stop_city:
                return last_stop_city
            else:
                return self.gtfsdbapi.get_stops_for_map([last_stop_id])[last_stop_id]["stop_name"]
    
    def _get_departure_changes(self, alert_id, alert=None):
        # 1. get alert and relevant routes, if no departure changes, return {}

        if alert is None:
            alert = self.alertdbapi.get_single_alert(alert_id)[0]
        
        if alert["use_case"] != USE_CASE.SCHEDULE_CHANGES.value:
            return {}
        
        representative_date = find_representative_date_for_route_changes_in_alert(alert)
        changes_by_agency_and_line = {}

        for route_id in alert["relevant_route_ids"]:
            # 2. get metadata and compute headsign (upside down smiley)
            route_metadata = self.gtfsdbapi.get_route_metadata(route_id)

            representative_trip_id = self.gtfsdbapi.get_representative_trip_id(route_id, representative_date)
            route_metadata["to_text"] = self._get_headsign(representative_trip_id)

            # 3. put the schedule changes into the nicer data structure
            chgs = alert.get("schedule_changes", {}).get(route_id, {})
            route_metadata["added_hours"] = chgs.get("added", [])
            route_metadata["removed_hours"] = chgs.get("removed", [])

            # 4. add to the dict
            agency_id = route_metadata["agency_id"]
            line_number = route_metadata["line_number"]

            if agency_id not in changes_by_agency_and_line:
                changes_by_agency_and_line[agency_id] = {}
            
            if line_number not in changes_by_agency_and_line[agency_id]:
                changes_by_agency_and_line[agency_id][line_number] = []
            
            changes_by_agency_and_line[agency_id][line_number].append(route_metadata)
        
        # 5. do the same sort as in _uncached_get_route_changes
        for agency_id in changes_by_agency_and_line:
            for line_number in changes_by_agency_and_line[agency_id]:
                changes_by_agency_and_line[agency_id][line_number].sort(
                    key=lambda x: x["to_text"]
                )

        return {
            "departure_changes": changes_by_agency_and_line
        }


class JSONEncoderWithDateTime(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        else:
            return super().default(obj)
    
    # magic vooodoo from stackoverflow and the cherrypy source code wheeeeeee
    def iterencode(self, value):
        # Adapted from cherrypy/_cpcompat.py
        for chunk in super().iterencode(value):
            yield chunk.encode("utf-8")

json_encoder = JSONEncoderWithDateTime(ensure_ascii=False)

# i have no idea why this function is necessary, and nowhere in the cherrypy
# documentation or source code do they bother to actually tell you what the
# expected arguments and return values are????? they're just like "oh btw
# u can supply ur own custom handler kthxbai" and im like ????? this is,,,,
# supposed to be the SIMPLE and EASY way to do server stuff?????? what the
# HECK man? like, why is no one in the computers industry(tm) bothered as
# much as i am by how many gosh dang MAGICAL CODE RITUALS we sometimes need
# to do just to use a FRAMEWORK that's SUPPOSED to make writing code somewhat
# "EASIER" or something?????? idgi but anyway here's a function that plays
# SOME part in handling json output, but i simply have NO idea what that part
# is, because the original programmers DIDN'T BOTHER TELLING ANYONE what the
# expected *args, **kwargs MIGHT BE, or what the expected RETURN VALUES are.
# and as a bonus, i text searched the ENTIRE CHERRYPY REPOSITORY for the
# string "_json_inner_handler" and found NOTHING so i don't even WANT to know
# what kind of DARK DEMONIC MAGICK they had used to MAKE that function AAAAAAAaaAAAaaAAaaaAaaaAAAaaaaa
# anyway i copied this code from here: https://stackoverflow.com/a/14730863
def json_handler(*args, **kwargs):
    # Adapted from cherrypy/lib/jsontools.py
    value = cherrypy.serving.request._json_inner_handler(*args, **kwargs)
    return json_encoder.iterencode(value)

def main():
    import os.path
    import configparser
    from docopt import docopt

    arguments = docopt(__doc__)
    configfile = arguments['--config'] or "config.ini"
    config = configparser.ConfigParser()
    config.read(configfile)

    gtfs_db_url   = config['psql']['dsn']
    alerts_db_url = config['psql']['alerts_db']

    host = config['service_alerts']['web_host']
    port = int(config['service_alerts']['web_port'])

    # server_conf_root = {
    #     '/': {
    #         'tools.staticdir.on': True,
    #         'tools.staticdir.root': os.path.abspath(
    #             os.path.join(os.path.dirname(os.path.abspath(__file__)), '../dist')
    #         ),
    #         'tools.staticdir.dir': '',
    #         'tools.staticdir.index': "index.html"
    #     }
    # }

    server_conf_api = {
        '/': {
            'tools.json_out.handler': json_handler
        }
    }

    cherrypy.config.update({
        'server.socket_host': host,
        'server.socket_port': port,
    })

    with psycopg2.connect(gtfs_db_url) as gtfsconn, psycopg2.connect(alerts_db_url) as alertconn:
        cherrypy.tree.mount(ServiceAlertsApiServer(gtfsconn, alertconn), '/api', server_conf_api)
        # cherrypy.tree.mount(None, '/', server_conf_root)
        cherrypy.engine.start()
        cherrypy.engine.block()

if __name__ == "__main__":
    main()