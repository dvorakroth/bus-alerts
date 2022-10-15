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
