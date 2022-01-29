#!/usr/bin/env python3
"""Load service alerts from MOT endpoint.

Usage:
    load_service_alerts.py [-c <file>] [-f <pbfile>]

Options:
    -c <file>, --config <file>       Use the specified configuration file.
    -f <pbfile>, --file <pbfile>     Load from <pbfile> instead of MOT endpoint.
                                     If the filename contains six numbers separated from each other by non-number characters, it'll get treated as a yyyy mm dd hh mm ss date


"""

from datetime import datetime, timedelta, timezone
from enum import Enum
import logging
import pytz

import psycopg2, psycopg2.extras, psycopg2.extensions
from google.transit import gtfs_realtime_pb2


CITY_LIST_PREFIX = "ההודעה רלוונטית לישובים: "

CAUSE_INT_TO_STR = {n: s for s, n in gtfs_realtime_pb2.Alert.Cause.items()}
EFFECT_INT_TO_STR = {n: s for s, n in gtfs_realtime_pb2.Alert.Effect.items()}

class USE_CASE(Enum):
    NATIONAL = 1
    AGENCY = 2
    REGION = 3
    CITIES = 4
    STOPS_CANCELLED = 5
    ROUTE_CHANGES_FLEX = 6 # "stop-on-route"
    ROUTE_CHANGES_SIMPLE = 7 # "routes-at-stop"
    SCHEDULE_CHANGES = 8 # "trips-of-route"

    # i think the names i made up are better than the terrible mot ones

def load_israeli_gtfs_rt(gtfsconn, alertconn, feed, TESTING_fake_today=None):
    for entity in feed.entity:
        id = entity.id
        alert = entity.alert

        first_start_time = None
        last_end_time = None
        active_periods = []

        for p in alert.active_period:
            active_periods.append([p.start, p.end])

            if p.start != 0 and p.start is not None:
                if first_start_time is None or first_start_time > p.start:
                    first_start_time = p.start
            else:
                first_start_time = 0
            
            if p.end != 0 and p.end is not None:
                if last_end_time is None or last_end_time < p.end:
                    last_end_time = p.end
            else:
                # no end time = forever (more realistically, until alert is deleted)
                last_end_time = 7258118400 # 2200-01-01 00:00 UTC
        
        consolidated_active_periods = consolidate_active_periods(active_periods)
        url = gtfs_rt_translations_to_dict(alert.url.translation)
        header = gtfs_rt_translations_to_dict(alert.header_text.translation)
        description = gtfs_rt_translations_to_dict(alert.description_text.translation)

        cause = CAUSE_INT_TO_STR[alert.cause]
        effect = EFFECT_INT_TO_STR[alert.effect]

        old_aramaic = None
        if 'oar' in description:
            old_aramaic = description['oar']
            del description['oar']
        
        use_case = None
        original_selector = None

        has_ent = len(alert.informed_entity) > 0

        relevant_agencies = []
        relevant_route_ids = []
        added_stop_ids = []
        removed_stop_ids = []
        schedule_changes = None

        if use_case is None and has_ent and alert.informed_entity[0].stop_id != '':
            if alert.informed_entity[0].route_id == '':
                # no route_id, only stop_id
                use_case = USE_CASE.STOPS_CANCELLED
                original_selector = {"stop_ids":[
                    e.stop_id for e in alert.informed_entity
                    if e.stop_id and e.stop_id != ''
                ]}

                removed_stop_ids += original_selector["stop_ids"]
                relevant_route_ids = fetch_all_routeids_at_stops_in_dateranges(
                    gtfsconn, 
                    removed_stop_ids,
                    active_periods
                )
                relevant_agencies = fetch_unique_agencies_for_routes(gtfsconn, relevant_route_ids)
            else:
                # route_id and stop_id
                route_stop_pairs = []
                schedule_changes = {}
                for e in alert.informed_entity:
                    if not e.stop_id or e.stop_id == '' or not e.route_id or e.route_id == '':
                        continue # this actually happened once and bugged the api server's code -_-

                    removed_stop_ids.append(e.stop_id)
                    route_stop_pairs.append([e.route_id, e.stop_id])

                    if e.route_id not in schedule_changes:
                        schedule_changes[e.route_id] = []
                        relevant_route_ids.append(e.route_id)
                    
                    schedule_changes[e.route_id].append({
                        'removed_stop_id': e.stop_id
                    })
                
                if old_aramaic is None:
                    use_case = USE_CASE.ROUTE_CHANGES_SIMPLE
                    original_selector = {"route_stop_pairs": route_stop_pairs}
                else:
                    use_case = USE_CASE.ROUTE_CHANGES_FLEX
                    original_selector = {
                        "route_stop_pairs": route_stop_pairs,
                        "old_aramaic": old_aramaic
                    }
                    oar_additions = parse_old_aramaic_routechgs(old_aramaic)

                    # merge the schedule changes we got from old aramaic text
                    # into the schedule changes we got from informed_entity[]
                    for route_id, additions in oar_additions.items():
                        if route_id not in schedule_changes:
                            schedule_changes[route_id] = additions
                            relevant_route_ids.append(e.route_id)
                        else:
                            # put additions before removals because the additions
                            # can be relative to a stop that gets removed
                            # and i wanna be good to future me and avoid these bugs(?)
                            schedule_changes[route_id] = additions + schedule_changes[route_id]
                        
                        added_stop_ids += [a["added_stop_id"] for a in additions]
                    
                removed_stop_ids = list(set(removed_stop_ids))
                added_stop_ids   = list(set(added_stop_ids))
                relevant_route_ids = list(set(relevant_route_ids))
                relevant_agencies = fetch_unique_agencies_for_routes(gtfsconn, relevant_route_ids)
        elif use_case is None and has_ent and alert.informed_entity[0].trip.trip_id:
            use_case = USE_CASE.SCHEDULE_CHANGES
            
            trips = []
            all_fake_trip_ids = set([])
            schedule_changes = {}

            for ie in alert.informed_entity:
                trips.append({
                    "route_id": ie.trip.route_id,
                    "fake_trip_id": ie.trip.trip_id, # ugh -_-
                    "action": ie.trip.schedule_relationship,
                    "start_time": ie.trip.start_time
                })

                if ie.trip.route_id not in schedule_changes:
                    schedule_changes[ie.trip.route_id] = {
                        "added": set([]),
                        "removed": set([])
                    }
                    relevant_route_ids.append(ie.trip.route_id)

                if ie.trip.schedule_relationship == gtfs_realtime_pb2.TripDescriptor.CANCELED\
                        and ie.trip.trip_id != '' and ie.trip.trip_id != '0':
                    schedule_changes[ie.trip.route_id]["removed"].add(ie.trip.trip_id)
                    all_fake_trip_ids.add(ie.trip.trip_id)
                elif ie.trip.schedule_relationship == gtfs_realtime_pb2.TripDescriptor.ADDED\
                        or ie.trip.trip_id == '' or ie.trip.trip_id == '0':
                    schedule_changes[ie.trip.route_id]["added"].add(ie.trip.start_time)
            
            # convert removed trips from fake ids (-____-) to actual times
            departure_times = fetch_departures_for_fake_tripids(gtfsconn, all_fake_trip_ids)
            for v in schedule_changes.values():
                v["removed"] = sorted([departure_times[t] for t in v["removed"]])
                v["added"] = sorted(v["added"])
            
            relevant_agencies = fetch_unique_agencies_for_routes(gtfsconn, relevant_route_ids)
            
            original_selector = {
                "trips": trips
            }
        
        if use_case is None:
            agency_ids = []

            if has_ent:
                agency_ids = [
                        ie.agency_id
                        for ie in alert.informed_entity
                        if ie.agency_id != '' and ie.agency_id != '1' # dear mot,\r\nface palm\r\nregards
                    ]
            
            city_names = None
            if not agency_ids and 'he' in description:
                he_desc = description['he']
                i = -1
                try:
                    i = he_desc.index(CITY_LIST_PREFIX)
                except ValueError:
                    pass

                if i >= 0:
                    use_case = USE_CASE.CITIES
                    city_names = he_desc[i + len(CITY_LIST_PREFIX):].split('\n')[0].split(',')
                    original_selector = {"cities": city_names}

        is_national = use_case is None and\
            not agency_ids and\
            city_names is None and\
            old_aramaic is None
        
        if is_national:
            use_case = USE_CASE.NATIONAL
            original_selector = {}
        
        polygon = None
        if use_case is None and\
                not agency_ids and old_aramaic is not None and\
                old_aramaic.startswith('region='):
            polygon = parse_old_aramaic_region(old_aramaic)
            use_case = USE_CASE.REGION
            original_selector = {"old_aramaic": old_aramaic}

            removed_stop_ids = fetch_stops_by_polygon(gtfsconn, polygon)
            relevant_route_ids = fetch_all_routeids_at_stops_in_dateranges(gtfsconn, removed_stop_ids, active_periods)
            relevant_agencies = fetch_unique_agencies_for_routes(gtfsconn, relevant_route_ids)
        
        if use_case is None and agency_ids:
            use_case = USE_CASE.AGENCY
            relevant_agencies = agency_ids
        
        alert_dict = {
            "id": id,
            "first_start_time": datetime.fromtimestamp(first_start_time, timezone.utc).replace(tzinfo=None),
            "last_end_time": datetime.fromtimestamp(last_end_time, timezone.utc).replace(tzinfo=None),
            "raw_data": entity.SerializeToString(),

            "use_case": use_case.value,
            "original_selector": original_selector,
            "cause": cause,
            "effect": effect,
            "url": url,
            "header": header,
            "description": description,
            "active_periods": {
                "raw": active_periods,
                "consolidated": consolidated_active_periods
            },
            "schedule_changes": schedule_changes,

            "is_national": is_national,
            "deletion_tstz": None,

            "relevant_agencies": sorted(set(relevant_agencies)),
            "relevant_route_ids": sorted(set(relevant_route_ids)),
            "added_stop_ids": sorted(set(added_stop_ids)),
            "removed_stop_ids": sorted(set(removed_stop_ids))
        }

        create_or_update_alert(alertconn, alert_dict)

    mark_alerts_deleted_if_not_in_list(alertconn, [e.id for e in feed.entity], TESTING_fake_today)
    alertconn.commit()
    gtfsconn.rollback()

def parse_stupid_local_unixtime(stupid_local_unixtime):
    if stupid_local_unixtime is not None and stupid_local_unixtime != 0:
        return JERUSALEM_TZ.localize(
            datetime.fromtimestamp(stupid_local_unixtime, timezone.utc) \
                .replace(tzinfo=None)
        )
    else:
        return None

def consolidate_active_periods(active_periods):
    result = []
    might_need_consolidation = {} # (y,m,d) -> [(startime, endtime, isPlusOne), ...]

    for start_time, end_time in active_periods:
        start_time = parse_stupid_local_unixtime(start_time)
        end_time = parse_stupid_local_unixtime(end_time)

        if not start_time or not end_time:
            # an infinite range can't be consolidated
            result.append({
                "simple": [start_time.isoformat(), end_time.isoformat()]
            })
            continue

        start_day = JERUSALEM_TZ.localize(datetime(start_time.year, start_time.month, start_time.day, 0, 0, 0))
        end_day = JERUSALEM_TZ.localize(datetime(end_time.year, end_time.month, end_time.day, 0, 0, 0))

        if end_day > (start_day + timedelta(days=1)):
            # a range stretching out over more than one calendar day can't be consolidated
            result.append({
                "simple": [start_time.isoformat(), end_time.isoformat()]
            })
            continue
        
        # now we're in an interesting case: a period stretching over 1-2 calendar days
        start_day_tuple = (start_day.year, start_day.month, start_day.day)
        if start_day_tuple not in might_need_consolidation:
            might_need_consolidation[start_day_tuple] = []
        
        might_need_consolidation[start_day_tuple].append(
            ((start_time.hour, start_time.minute), (end_time.hour, end_time.minute), end_day > start_day)
        )
    
    # now that we have a list of all the periods we might want to consolidate,
    # do the actual consolidation!

    consolidated_tuples = [] # each item: ([(y,m,d), (y,m,d), ...], [((h,m), (h,m), t/f), ((h,m), (h,m), t/f), ...])

    for date_tuple, times in might_need_consolidation.items():
        found = False
        for other_date_tuples, other_times in consolidated_tuples:
            if len(other_times) == len(times) \
                    and all(map(lambda x: x[0] == x[1], zip(times, other_times))):
                # found another consolidated group with these same times!
                found = True
                other_date_tuples.append(date_tuple)
                break
        
        if not found:
            # no other dates with these same times encountered yet, so make a new group
            consolidated_tuples.append(([date_tuple], times))
    
    # and finally, convert it to strings that will be easier for the client to handle
    for date_tuple_list, time_tuple_list in consolidated_tuples:
        # but WAIT there's MORE CONSOLIDATION TO DO!!! how fun!
        consolidated_date_tuples = consolidate_sorted_date_tuple_list(sorted(set(date_tuple_list)))

        consolidated_date_strings = []
        for d in consolidated_date_tuples:
            if isinstance(d, tuple):
                consolidated_date_strings.append(date_tuple_to_str(d))
            else:
                consolidated_date_strings.append([
                    date_tuple_to_str(dd) for dd in d
                ])

        sorted_times = [
            (f"{sh:02}:{sm:02}", f"{eh:02}:{em:02}", p) for ((sh, sm), (eh, em), p) in sorted(set(time_tuple_list))
        ]

        result.append({
            "dates": consolidated_date_strings,
            "times": sorted_times
        })
    
    return result

def consolidate_sorted_date_tuple_list(sorted_date_tuple_list):
    result = []
    current_range_start = None
    current_range_end   = None
    current_range_end_datetime = None

    for y, m, d in sorted_date_tuple_list:
        current_datetime = JERUSALEM_TZ.localize(datetime(y, m, d, 0, 0, 0))

        if current_range_start is None:
            current_range_start = (y, m, d)
            current_range_end   = (y, m, d)
            current_range_end_datetime = current_datetime
            continue
        elif current_datetime == current_range_end_datetime + timedelta(days=1):
            # we went forward by one day, so lengthen the current range
            current_range_end = (y, m, d)
            current_range_end_datetime = current_datetime
        else:
            # we went forward by more than one day, so start a new range
            if current_range_start == current_range_end:
                result.append(current_range_start)
            else:
                result.append([current_range_start, current_range_end])
            current_range_start = (y, m, d)
            current_range_end   = (y, m, d)
            current_range_end_datetime = current_datetime
    
    # clean up any leftovers
    if current_range_start is not None:
        if current_range_start == current_range_end:
            result.append(current_range_start)
        else:
            result.append([current_range_start, current_range_end])

    return result

def date_tuple_to_str(date_tuple):
    y, m, d = date_tuple

    return f"{y:04}-{m:02}-{d:02}"

# def fetch_alert(alertconn, alert_id):
#     # TODO if i ever need thsi function again: convert the raw_data field to bytes()
#     # instead of the weird memory pointer thing it usually is(????)
#     with alertconn.cursor() as cursor:
#         cursor.execute(
#             "SELECT * FROM alerts_with_related WHERE id=%s;",
#             [alert_id]
#         )
#         values = cursor.fetchone()

#         if values is None:
#             return None
#         else:
#             return {column.name: value for column, value in zip(cursor.description, values)}

def create_or_update_alert(alertconn, alert_dict):
    id = alert_dict["id"]

    with alertconn.cursor() as cursor:
        psycopg2.extras.execute_values(
            cursor,
            "INSERT INTO alert VALUES %s " +\
                "ON CONFLICT (id) DO UPDATE SET " +\
                    "first_start_time = EXCLUDED.first_start_time, " +\
                    "last_end_time = EXCLUDED.last_end_time, " +\
                    "raw_data = EXCLUDED.raw_data, " +\
                    "use_case = EXCLUDED.use_case, " +\
                    "original_selector = EXCLUDED.original_selector, " +\
                    "cause = EXCLUDED.cause, " +\
                    "effect = EXCLUDED.effect, " +\
                    "url = EXCLUDED.url, " +\
                    "header = EXCLUDED.header, " +\
                    "description = EXCLUDED.description, " +\
                    "active_periods = EXCLUDED.active_periods, " +\
                    "schedule_changes = EXCLUDED.schedule_changes, " +\
                    "is_national = EXCLUDED.is_national, " +\
                    "deletion_tstz = CASE WHEN EXCLUDED.deletion_tstz IS NULL THEN NULL ELSE LEAST(EXCLUDED.deletion_tstz, alert.deletion_tstz) END;",
            [(
                alert_dict["id"],
                alert_dict["first_start_time"],
                alert_dict["last_end_time"],
                alert_dict["raw_data"],
                alert_dict["use_case"],
                alert_dict["original_selector"],
                alert_dict["cause"],
                alert_dict["effect"],
                alert_dict["url"],
                alert_dict["header"],
                alert_dict["description"],
                psycopg2.extras.Json(alert_dict["active_periods"]),
                alert_dict["schedule_changes"],
                alert_dict["is_national"],
                alert_dict["deletion_tstz"]
            )]
        )

        logging.info("Added/updated alert with id: " + str(id))
        
        has_agencies = len(alert_dict["relevant_agencies"]) > 0
        cursor.execute(
            "DELETE FROM alert_agency WHERE alert_id=%s" +\
                (" AND agency_id NOT IN %s;" if has_agencies else ";"),
            [id, tuple(alert_dict["relevant_agencies"])] if has_agencies else [id]
        )
        logging.info(f"Deleted {cursor.rowcount} rows from alert_agency")
        
        has_routes = len(alert_dict["relevant_route_ids"]) > 0
        cursor.execute(
            "DELETE FROM alert_route WHERE alert_id=%s" +\
                (" AND route_id NOT IN %s;" if has_routes else ";"),
            [id, tuple(alert_dict["relevant_route_ids"])] if has_routes else [id]
        )
        logging.info(f"Deleted {cursor.rowcount} rows from alert_route")

        all_stops = \
            [
                # all removed_stop_ids (including whether or not they're in added_stop_ids)
                (id, s, s in alert_dict["added_stop_ids"], True) for s in alert_dict["removed_stop_ids"]
            ] +\
            [
                # the added stops that were NOT in removed_stop_ids
                (id, s, True, False) \
                    for s in alert_dict["added_stop_ids"] \
                        if s not in alert_dict["removed_stop_ids"]
            ]
        has_stops = len(all_stops) > 0
        cursor.execute(
            "DELETE FROM alert_stop WHERE alert_id=%s" +\
                (" AND stop_id NOT IN %s;" if has_stops else ";"),
            [id, tuple(map(lambda x: x[1], all_stops))] if has_stops else [id]
        )
        logging.info(f"Deleted {cursor.rowcount} rows from alert_stop")

        if has_agencies:
            psycopg2.extras.execute_values(
                cursor,
                "INSERT INTO alert_agency VALUES %s ON CONFLICT DO NOTHING;",
                [(id, agency_id) for agency_id in alert_dict["relevant_agencies"]]
            )
            logging.info(f"Added {cursor.rowcount} rows to alert_agency")
        
        if has_routes:
            psycopg2.extras.execute_values(
                cursor,
                "INSERT INTO alert_route VALUES %s ON CONFLICT DO NOTHING;",
                [(id, route_id) for route_id in alert_dict["relevant_route_ids"]]
            )
            logging.info(f"Added {cursor.rowcount} rows to alert_route")
        
        if has_stops:
            psycopg2.extras.execute_values(
                cursor,
                "INSERT INTO alert_stop VALUES %s ON CONFLICT(alert_id, stop_id) DO UPDATE " +\
                    "SET is_added = EXCLUDED.is_added, is_removed = EXCLUDED.is_removed;",
                all_stops
            )
            logging.info(f"Added {cursor.rowcount} rows to alert_stop")

def mark_alerts_deleted_if_not_in_list(alertconn, alert_ids_to_keep, TESTING_fake_today=None):
    if len(alert_ids_to_keep) == 0:
        return
    
    with alertconn.cursor() as cursor:
        cursor.execute("UPDATE alert SET deletion_tstz = %s WHERE deletion_tstz IS NULL AND id NOT IN %s;", [
            TESTING_fake_today or JERUSALEM_TZ.fromutc(datetime.utcnow()),
            tuple(alert_ids_to_keep)
        ])
        logging.info(f"Marked {cursor.rowcount} alerts as deleted")

OAR_PREFIX_REGION = 'region='

def parse_old_aramaic_region(region_text):
    # note for future me: their coords are lat,lon = y,x
    # and this function returns strings, not floats, to avoid rounding errors
    if region_text.endswith(';'):
        region_text = region_text[:-1]
    
    if region_text.startswith(OAR_PREFIX_REGION):
        region_text = region_text[len(OAR_PREFIX_REGION):]
    
    return [s.split(',') for s in region_text.split(':')]

def parse_old_aramaic_routechgs(routechgs_text):
    results = {}

    for c in routechgs_text.split(';'):
        if c == '':
            continue
        values = dict(map(lambda x: x.split('='), c.split(',')))

        route_id = values['route_id']
        added_stop_id = values['add_stop_id']
        is_before = 'before_stop_id' in values

        if route_id not in results:
            results[route_id] = []
        
        results[route_id].append({
            'added_stop_id': added_stop_id,
            'relative_stop_id': values['before_stop_id'] if is_before\
                else values['after_stop_id'],
            'is_before': is_before
        })

    return results

def fetch_departures_for_fake_tripids(gtfsconn, fake_trip_ids):
    if len(fake_trip_ids) == 0:
        return {}

    with gtfsconn.cursor() as cursor:
        cursor.execute('SELECT DISTINCT "TripId", "DepartureTime" FROM trip_id_to_date WHERE "TripId" IN %s;', [tuple(fake_trip_ids)])
        return dict(cursor.fetchall())

GTFS_CALENDAR_DOW = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

def fetch_unique_agencies_for_routes(gtfsconn, route_ids):
    if len(route_ids) == 0:
        return []
    
    with gtfsconn.cursor() as cursor:
        cursor.execute('SELECT DISTINCT agency_id FROM routes WHERE route_id IN %s;', [tuple(route_ids)])
        return [t[0] for t in cursor.fetchall()]

def fetch_all_routeids_at_stops_in_dateranges(gtfsconn, relevant_stop_ids, active_periods):
    q, v = generate_query___fetch_all_routeids_at_stops_in_dateranges(relevant_stop_ids, active_periods)

    with gtfsconn.cursor() as cursor:
        cursor.execute(q, v)
        return [t[0] for t in cursor.fetchall()]

def generate_query___fetch_all_routeids_at_stops_in_dateranges(relevant_stop_ids, active_periods):
    # i fear the day when i need to maintain this function haha upside down smiley emoji

    if len(relevant_stop_ids) == 0 or len(active_periods) == 0:
        return []
    query_text = 'SELECT DISTINCT route_id FROM trips ' +\
        'INNER JOIN stoptimes_int ON trips.trip_id = stoptimes_int.trip_id ' +\
        'INNER JOIN calendar ON trips.service_id = calendar.service_id ' +\
        'WHERE stoptimes_int.stop_id IN %s '
    query_values = [tuple(relevant_stop_ids)]

    all_period_conditions = []
    all_period_values = []

    for start_unixtime, end_unixtime in active_periods:
        active_period_parts = split_active_period_to_subperiods(
            start_unixtime, end_unixtime
        )

        for part in active_period_parts:
            if part is None:
                continue
            s, e = part

            part_condition = ''
            part_values = []

            relevant_dow = None

            if s is not None and e is None:
                part_condition = \
                    'calendar.end_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time '+\
                    ' >= ' +\
                    '%s'
                part_values = [s]
            elif s is None and e is not None:
                part_condition = \
                    'calendar.start_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time '+\
                    ' < ' +\
                    '%s'
                part_values = [e]
            elif s is not None and e is not None:
                part_condition = \
                    '(calendar.start_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time, '+\
                    'calendar.end_date AT TIME ZONE \'Asia/Jerusalem\' + stoptimes_int.arrival_time + INTERVAL \'1 second\') ' +\
                    'OVERLAPS (%s, %s)'
                part_values = [s, e]

                # loop through all days in this part
                # and add their dows to relevant_dow
                relevant_dow = set([])

                d = s
                while d < e:
                    relevant_dow.add(d.weekday())
                    if len(relevant_dow) == 7:
                        break # stop looping if we already figured we need every day
                    d += timedelta(days = 1)
                
                less_than_a_day = (e - s) < timedelta(days = 1)
            
                if relevant_dow is not None and 0 < len(relevant_dow) < 7:
                    part_condition += \
                        ' AND (' +\
                            '(' +\
                                'stoptimes_int.arrival_time < INTERVAL \'24 hours\' ' +\
                                'AND (' +\
                                    ' OR '.join([
                                        'calendar.' + GTFS_CALENDAR_DOW[dow] + ' = TRUE'
                                        for dow in relevant_dow
                                    ]) +\
                                ')' +\
                                (' AND (%s + stoptimes_int.arrival_time) BETWEEN %s AND %s' if less_than_a_day else '') +\
                            ') OR (' +\
                                'stoptimes_int.arrival_time >= INTERVAL \'24 hours\' ' + \
                                'AND (' +\
                                    ' OR '.join([
                                        'calendar.' + GTFS_CALENDAR_DOW[(dow - 1) % 7] + ' = TRUE'
                                        for dow in relevant_dow
                                    ]) +\
                                ')' +\
                                (' AND (%s + stoptimes_int.arrival_time) BETWEEN %s AND %s' if less_than_a_day else '') +\
                            ')' +\
                        ')'
                    
                    if less_than_a_day:
                        part_values += [
                            JERUSALEM_TZ.localize(datetime(s.year, s.month, s.day, 0, 0, 0)),
                            s,
                            e,
                            JERUSALEM_TZ.localize(datetime(s.year, s.month, s.day, 0, 0, 0)) - timedelta(days = 1),
                            s,
                            e
                        ]
                                
            if part_condition != '':
                all_period_conditions.append(part_condition)
                all_period_values += part_values

    if len(all_period_conditions) > 0:  
        query_text += \
            'AND ((' + \
            ') OR ('.join(all_period_conditions) + \
            '))'
        query_values += all_period_values
    
    query_text += ';'
    
    return query_text, query_values

JERUSALEM_TZ = pytz.timezone("Asia/Jerusalem")

def split_active_period_to_subperiods(start_unixtime, end_unixtime):
    """
        Given two unix times for an alert's active_period, returns
        that period split up into 3 parts:
            start_remainder: a period of less than 24 hours, that ends midnight
            middle_part: a period of several days, midnight-to-midnight
            end_remainder: a period of less than 24 hours, that starts midnight
        
        Each of these parts can be None, or a sub-list with two datetimes in Asia/Jerusalem.
        Either of the two dates in the list could also be None.

        A part that is None should be ignored;
        A start time that is None is basically negative infinity;
        An end time that is None is, conversely, infinity;
        If all parts are None, that means no time bounds were given;
                
        This is done so we can search for services+stoptimes that are active at
        a certain active_period because gtfs services are hard
    """
    has_start = start_unixtime != 0 and start_unixtime is not None
    has_end =   end_unixtime   != 0 and end_unixtime   is not None
    
    # assuming both start and end times exist
    # did you know? the mot's timestamps are in LOCAL TIME! good thing i checked
    # because the gtfs rt standard defines them as utc -_-
    # bonus: python timezone-sensitive timestamps are notoriously difficult
    start_local = JERUSALEM_TZ.localize(datetime.fromtimestamp(start_unixtime, timezone.utc).replace(tzinfo=None)) \
        if has_start else None
    end_local   = JERUSALEM_TZ.localize(datetime.fromtimestamp(end_unixtime,   timezone.utc).replace(tzinfo=None)) \
        if has_end   else None

    starts_midnight = has_start and start_local.hour == 0 and start_local.minute == 0
    ends_midnight   = has_end   and end_local.hour   == 0 and end_local.minute   == 0
    
    # easy case: all within a single day
    if has_start and has_end and\
            start_local.strftime("%Y-%m-%d") == end_local.strftime("%Y-%m-%d"):
        return [[start_local, end_local], None, None]
    
    start_remainder = None
    middle_part = None
    end_remainder = None

    if has_start and not starts_midnight:
        midnight_after_start_day = JERUSALEM_TZ.localize(datetime(
            start_local.year, start_local.month, start_local.day,
            0, 0, 0,
        )) + timedelta(days = 1)
        start_remainder = [start_local, midnight_after_start_day]
        start_local = midnight_after_start_day
    
    if has_end and not ends_midnight:
        midnight_before_end_day = JERUSALEM_TZ.localize(datetime(
            end_local.year, end_local.month, end_local.day,
            0, 0, 0
        ))
        end_remainder = [midnight_before_end_day, end_local]
        end_local = midnight_before_end_day
    
    if start_local != end_local:
        middle_part = [start_local, end_local]

    return [start_remainder, middle_part, end_remainder]

ALLOWED_UNICODE_REPLACEMENTS = {
    '\\u2013': '\u2013',
    '\\u2019': '\u2019'
}

def replace_unicode_fails(s):
    i = 0
    while True:
        i = s.find("\\u", i)

        if i < 0 or i + 6 > len(s):
            return s
        
        esc_seq = s[i:i+6]
        replacement = ALLOWED_UNICODE_REPLACEMENTS.get(esc_seq, None)

        if replacement is not None:
            s = s[:i] + replacement + s[i+6:]
            i += len(replacement)
        else:
            i += len(esc_seq)

def gtfs_rt_translations_to_dict(translations):
    return {
        t.language: replace_unicode_fails(t.text)
        for t in translations
        if len(t.text) > 0
    }

def fetch_stops_by_polygon(gtfsconn, polygon):
    if len(polygon) == 0:
        return []
    
    with gtfsconn.cursor() as cursor:
        gtfsconn.execute(
            "SELECT stop_id FROM stops WHERE point(stop_lat, stop_lon) <@ polygon %s;",
            [
                '(' + ', '.join([f'({lat},{lon})' for lat, lon in polygon]) + ')'
            ]
        )
        return [t[0] for t in gtfsconn.fetchall()]

def main():
    import sys, re
    import configparser
    from docopt import docopt
    import requests

    logging.basicConfig()
    logging.getLogger().setLevel(logging.INFO)

    arguments = docopt(__doc__)
    configfile = arguments['--config'] or "config.ini"
    config = configparser.ConfigParser()
    config.read(configfile)

    gtfs_db_url   = config['psql']['dsn']
    alerts_db_url = config['psql']['alerts_db']

    mot_endpoint  = config['service_alerts']['mot_endpoint']
    pb_filename   = arguments['--file']

    data = None
    TESTING_fake_today = None

    if pb_filename:
        with open(pb_filename, 'rb') as f:
            data = f.read()
                                        #year   month  day    hours  mins   secs
        filename_pattern = re.compile(r'(\d+)\D(\d+)\D(\d+)\D(\d+)\D(\d+)\D(\d+)')
        numbers_found = filename_pattern.findall(pb_filename)

        if numbers_found:
            try:
                TESTING_fake_today = JERUSALEM_TZ.localize(
                    datetime(*map(int, numbers_found))
                )

                logging.info(f'found date {TESTING_fake_today.isoformat()} in filename {pb_filename}')
            except:
                logging.warn(
                    f'couldn\'t make a date out of numbers in filename: {pb_filename}',
                    exc_info=True
                )
    else:
        r = requests.get(mot_endpoint)
        if r.status_code != 200:
            logging.error(f"received status code {r.status_code} {r.reason} from mot endpoint")
            sys.exit(1)
        data = r.content

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(data)

    with psycopg2.connect(gtfs_db_url) as gtfsconn, psycopg2.connect(alerts_db_url) as alertconn:
        psycopg2.extensions.register_adapter(dict, psycopg2.extras.Json)

        try:
            load_israeli_gtfs_rt(gtfsconn, alertconn, feed, TESTING_fake_today)
        except:
            alertconn.rollback()
            gtfsconn.rollback()
            raise

if __name__ == "__main__":
    main()