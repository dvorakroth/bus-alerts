import functools
import itertools
import re
from datetime import datetime
import cherrypy
import sys

sys.path.append('../') # i hate python so much

from load_service_alerts import parse_unixtime_into_jerusalem_tz, JERUSALEM_TZ, USE_CASE
from junkyard import remove_all_occurrences_from_list

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
        
        first = False
        prev_stop_id = stop_id
        prev_is_deleted = is_deleted

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
    
    if not len(stop_ids):
        # sometimes the route changes don't actually have any changes????
        # i have no idea what the fuck they're doing over there in the wherever
        # they're doing whatever ther fuck it is they're doing
        return set(map(lambda x: x[0], alert_minimal["updated_stop_sequence"]))
    else:
        return stop_ids

def list_of_alerts_to_active_period_intersections_and_bitmasks(alerts_minimal):
    all_active_period_boundaries = []

    for idx, alert_minimal in enumerate(alerts_minimal):
        for start, end in alert_minimal["active_periods"]["raw"]:
            all_active_period_boundaries.append((start or 0, idx, False))
            all_active_period_boundaries.append((end or 7258118400, idx, True)) # alerts with no specified end time get the timestamp for 2200-01-01 00:00 UTC
    
    all_active_period_boundaries.sort()

    all_periods = []
    current_period = None

    while len(all_active_period_boundaries):
        timestamp, idx, is_end = all_active_period_boundaries.pop(0)

        if not current_period:
            # this is the first period boundary we're encountering

            if is_end:
                # i don't know what kind of terrible data would get us HERE
                # but if it does, ignore it and hope for the best lol!
                continue
            
            current_period = {"start": timestamp, "end": None, "bitmask": 0}
            all_periods.append(current_period)
        elif current_period["start"] != timestamp:
            current_period["end"] = timestamp
            current_period = {"start": timestamp, "end": None, "bitmask": current_period["bitmask"]}
            all_periods.append(current_period)
        
        idx_bitmask = 1 << idx
        if not is_end:
            # this alert just started, add it to the bitmask
            current_period["bitmask"] |= idx_bitmask
        elif current_period["bitmask"] & idx_bitmask:
            # this alert just ended, and it actually was in the bitmask
            # (i could theoretically do &= ~idx_bitmask, but python's bitwise
            # not feels unpredictable, so for my own sake, i added the extra
            # check and did a xor instead)
            current_period["bitmask"] ^= idx_bitmask
    
    return all_periods



def does_alert_have_route_changes(alert):
    return alert["use_case"] in [
        USE_CASE.STOPS_CANCELLED.value,
        USE_CASE.ROUTE_CHANGES_FLEX.value,
        USE_CASE.ROUTE_CHANGES_SIMPLE.value
    ]


def apply_alert_to_route(
    alert,
    route_id,
    gtfsdbapi,
    representative_date = None,
    representative_trip_id = None,
    raw_stop_seq = None,
    updated_stop_seq = None,
    deleted_stop_ids = None,
    mut_all_stop_ids_set = None
):
    # TODO: it looks like i never took care of the REGION use case lmaooooooo
    #       i'd feel much more comfortable implementing it if they,,, uh,,,,,,,,,,,, ever used it :|
    #       but sure; i can try to do it al iver just in case
    if not does_alert_have_route_changes(alert):
        return None

    # if needed, get a representative date
    if not representative_date and not representative_trip_id and not updated_stop_seq:
        representative_date = find_representative_date_for_route_changes_in_alert(alert)
    
    # if needed, get a representative trip
    if not representative_trip_id and not updated_stop_seq:
        representative_trip_id = gtfsdbapi.get_representative_trip_id(route_id, representative_date)
    
    # and if needed, get that trip's stop sequence
    if not updated_stop_seq:
        if not raw_stop_seq:
            raw_stop_seq = gtfsdbapi.get_stop_seq(representative_trip_id)
        
        if mut_all_stop_ids_set:
            mut_all_stop_ids_set.update(raw_stop_seq)
        
        updated_stop_seq = [
            (stop_id, False) # (stop_id, is_added)
            for stop_id in raw_stop_seq
        ]
        deleted_stop_ids = []
    
    # and actually do the magic of computing the new stop sequence
    if alert["use_case"] == USE_CASE.STOPS_CANCELLED.value:
        # special case :|
        for removed_stop_id in alert["removed_stop_ids"]:
            times_removed = remove_all_occurrences_from_list(
                # TODO: support removing a stop thats been inserted by an alert
                updated_stop_seq,
                (removed_stop_id, False)
            )

            if times_removed > 0 or len(alert["relevant_route_ids"]) == 1:
                deleted_stop_ids.append(removed_stop_id)
    else:
        changes_for_route = alert["schedule_changes"][route_id]

        for change in changes_for_route:
            if "removed_stop_id" in change:
                times_removed = remove_all_occurrences_from_list(
                    # TODO: support removing a stop thats been inserted by an alert
                    updated_stop_seq,
                    (change["removed_stop_id"], False)
                )

                if times_removed == 0:
                    cherrypy.log(f"tried removing stop that's not on a route; route_id={route_id}, {repr(change)}, alert_id={alert['id']}, trip_id={representative_trip_id})")
                
                if times_removed > 0 or len(alert["relevant_route_ids"]) == 1:
                    deleted_stop_ids.append(change["removed_stop_id"])
            elif "added_stop_id" in change:
                dest_idx = None
                for idx, t in enumerate(updated_stop_seq):
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
                        f"tried adding stop relative to stop not on route; route_id={route_id}, {repr(change)}, alert_id={alert['id']}, trip_id={representative_trip_id}"
                    )
                    continue

                if not change["is_before"]:
                    dest_idx += 1
                
                updated_stop_seq.insert(dest_idx, (change["added_stop_id"], True))
                cherrypy.log(f"added stop {change['added_stop_id']} to route {route_id} at index {dest_idx}")

                if mut_all_stop_ids_set:
                    mut_all_stop_ids_set.add(change["added_stop_id"])
    
    if mut_all_stop_ids_set:
        mut_all_stop_ids_set.update(deleted_stop_ids)

    # aaahahahahahahahha in like 2 weeks im gonna look at this return statemnet
    # and be so perplexed lmao sgonna be real funny and by funny i mean ill get
    # [REDACTED] again ahahahahah
    return {
        "alert": alert,
        "route_id": route_id,
        "gtfsdbapi": gtfsdbapi,
        "representative_date": representative_date,
        "representative_trip_id": representative_trip_id,
        "raw_stop_seq": raw_stop_seq,
        "updated_stop_seq": updated_stop_seq,
        "deleted_stop_ids": deleted_stop_ids,
        "mut_all_stop_ids_set": mut_all_stop_ids_set
    }