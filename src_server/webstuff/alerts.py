import math
from datetime import datetime
import shapely

import sys
import cachetools
from pyproj import Transformer

from pytz import timezone

sys.path.append('../') # i hate python so much

from load_service_alerts import parse_unixtime_into_jerusalem_tz, JERUSALEM_TZ, parse_old_aramaic_region, USE_CASE

def alert_find_next_relevant_date(alert):
    today_in_jerus = datetime.now(JERUSALEM_TZ).replace(hour=0, minute=0, second=0, microsecond=0)

    # convert list of active_periods from unixtime to datetime objects with pytz
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
            #     JERUSALEM_TZ.fromutc(datetime.fromtimestamp(period_start_unixtime, timezone.utc).replace(tzinfo=None)) \
            #     if period_start_unixtime is not None and period_start_unixtime != 0 else None
            
            # period_end = \
            #     JERUSALEM_TZ.fromutc(datetime.fromtimestamp(period_end_unixtime, timezone.utc).replace(tzinfo=None)) \
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
    
    return first_relevant_date, current_active_period_start

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
