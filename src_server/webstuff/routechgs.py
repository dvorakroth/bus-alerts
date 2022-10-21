import re
from datetime import datetime

import sys
sys.path.append('../') # i hate python so much

from load_service_alerts import parse_unixtime_into_jerusalem_tz, JERUSALEM_TZ


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





# am i gonna understand this regex in a week? let's find out!
ROUTE_DESC_DIR_ALT_PATTERN = re.compile(r'^[^-]+-([^-]+)-([^-]+)$')


def label_line_changes_headsigns_for_direction_and_alternative(line_changes):
    """for chg in line_changes: adds (direction 1, alternative 2) labels to duplicate headsigns,
    and deletes route_desc from the dictionary"""

    dict_headsign_to_dir_alt_pairs = {}

    for chg in line_changes:
        headsign = chg["to_text"]
        route_desc = chg["route_desc"]
        del chg["route_desc"]

        if headsign not in dict_headsign_to_dir_alt_pairs:
            dict_headsign_to_dir_alt_pairs[headsign] = []
        
        dir_alt_pair = ROUTE_DESC_DIR_ALT_PATTERN.findall(route_desc)[0]
        dict_headsign_to_dir_alt_pairs[headsign].append(dir_alt_pair)
        chg["dir_alt_pair"] = dir_alt_pair
    
    ordered_dir_alt_namepairs = label_headsigns_for_direction_and_alternative(
        dict_headsign_to_dir_alt_pairs,
        dict_headsign_to_dir_alt_pairs,
        map(
            lambda x: [x["to_text"], x["dir_alt_pair"]],
            line_changes
        )
    )

    for chg, namepair in zip(line_changes, ordered_dir_alt_namepairs):
        del chg["dir_alt_pair"]
        chg["dir_name"] = namepair[0]
        chg["alt_name"] = namepair[1]

def label_headsigns_for_direction_and_alternative(
    alt_dict_headsign_to_dir_alt_pairs,
    dir_dict_headsign_to_dir_alt_pairs,
    headsigns_with_diralts,
    label_dirs_per_alt=False
):

    def per_headsign(h):
        headsign, dir_alt_pair = h
        alt_dups = alt_dict_headsign_to_dir_alt_pairs[headsign]
        dir_dups = dir_dict_headsign_to_dir_alt_pairs[headsign]

        dir_name = None
        alt_name = None

        if len(alt_dups) == 1 and len(dir_dups) == 1:
            # no duplicates for this headsign! yay upside down smiley
            return [dir_name, alt_name]
        
        dir_id, alt_id = dir_alt_pair

        if any(map(lambda x: x[0] != dir_id and (not label_dirs_per_alt or x[1] == alt_id), dir_dups)):
            # if there's any dups with a different direction id

            # in some distant nebulous future, i could try giving actual names
            # to the directions and alternatives; but not today, not quite yet
            # bukra fil mishmish
            dir_name = str(
                # possibly the slowest most inefficient way to do this but as
                # stated earlier, yours truly is truly bad at algo
                sorted(set([d for d, a in dir_dups if (not label_dirs_per_alt or a == alt_id)])).index(dir_id) + 1
            )
        
        if alt_id not in ['#', '0'] and any(map(lambda x: x[1] != alt_id, alt_dups)):
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
            # note: if a not in ['#', '0'] cause we don't care about the main alternative here
            # i want to display: Towards A, Towards A (Alt 1), Towards A (Alt 2)
            # and not quite:     Towards A, Towards A (Alt 2), Towards A (Alt 3)
            alternatives = sorted(set([a for d, a in alt_dups if a not in ['#', '0']]))

            if len(alternatives) == 1:
                # but also we want to display: Towards A, Towards A (Alt)
                # and not qutie:               Towards A, Towards A (Alt 1)
                # because "1" doesn't make sense when there's just the one
                alt_name = "#"
            else:
                alt_name = str(alternatives.index(alt_id) + 1)
        
        return (dir_name, alt_name)
    
    return map(per_headsign, headsigns_with_diralts)

def bounding_box_for_stops(stop_ids, stops_for_map):
    """get bounding box of affected stops, for setting the map's bounding box"""

    map_bounding_box = {
        "min_lon": None,
        "min_lat": None,
        "max_lon": None,
        "max_lat": None
    }

    for stop_id in stop_ids:
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
    
    return map_bounding_box

def compute_stop_ids_incl_adj_for_single_route_change(alert_minimal, orig_stop_seq):

    stop_ids = set()

    first = True
    prev_stop_id    = None
    prev_is_deleted = None
    for stop_id in orig_stop_seq:
        is_deleted = stop_id in alert_minimal["deleted_stop_ids"]

        if is_deleted:
            # deleted stops need to be in the bounding box
            stop_ids.add(stop_id)

            if not first and not prev_is_deleted:
                # and also non-deleted stops that come right before a deleted stop
                stop_ids.add(prev_stop_id)
        elif not first and prev_is_deleted:
            # and also also non-deleted stops that come right after a new stop
            stop_ids.add(stop_id)

    first = True
    prev_stop_id = None
    prev_is_new  = None
    for stop_id, is_new in alert_minimal["updated_stop_sequence"]:
        if is_new:
            # new stops need to be in the bounding box
            stop_ids.add(stop_id)
        
            if not first and not prev_is_new:
                # and also non-new stops that come right before a new stop
                stop_ids.add(prev_stop_id)
        elif not first and prev_is_new:
            # and also also non-new stops that come right after a new stop
            stop_ids.add(stop_id)
    
        first = False
        prev_stop_id = stop_id
        prev_is_new  = is_new
    
    return stop_ids

    # return bounding_box_for_stops(stop_ids, all_stops)