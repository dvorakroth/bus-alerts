#!/usr/bin/env python3
"""Service Alerts App Web Server.

Usage:
    web_server.py [-c <file>]

Options:
    -c <file>, --config <file>       Use the specified configuration file.
"""


from datetime import datetime
from functools import reduce
import functools
from itertools import chain
import itertools
import json
import operator
import os, os.path

import cachetools, cachetools.func
import cherrypy
import psycopg2

from load_service_alerts import JERUSALEM_TZ, USE_CASE
from junkyard import deepcopy_decorator, extract_city_from_stop_desc, line_number_for_sorting, remove_all_occurrences_from_list
from webstuff.alerts import alert_find_next_relevant_date, cached_distance_to_alert, sort_alerts
from webstuff.routechgs import find_representative_date_for_route_changes_in_alert, label_line_changes_headsigns_for_direction_and_alternative, label_headsigns_for_direction_and_alternative, bounding_box_for_stops, compute_stop_ids_incl_adj_for_single_route_change

from webstuff.alertdbapi import AlertDbApi
from webstuff.gtfsdbapi import GtfsDbApi





ROUTE_CHANGES_CACHE = cachetools.TTLCache(maxsize=512, ttl=600)

class ServiceAlertsApiServer:
    def __init__(self, gtfsdbapi, alertdbapi):
        self.gtfsdbapi  = gtfsdbapi
        self.alertdbapi = alertdbapi

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def all_lines(self, current_location=None):
        # TODO cache
        # TODO location

        alerts = self.alertdbapi.get_alerts()
        # all_affected_stop_ids = set([])

        linepk_to_alerts = {}
        linepk_to_removed_stopids = {}
        # linepk_to_added_stopids = {}

        for alert in alerts:
            if alert["is_deleted"] or alert["is_expired"]:
                continue

            # all_affected_stop_ids.update(alert["added_stop_ids"])
            # all_affected_stop_ids.update(alert["removed_stop_ids"])
            
            alert["first_relevant_date"] = alert_find_next_relevant_date(alert)[0]

            for route_id in alert["relevant_route_ids"]:
                if route_id not in ACTUAL_LINES_BY_ROUTE_ID:
                    cherrypy.log(f"route_id {route_id} not found in ACTUAL_LINES_BY_ROUTE_ID. ignoring")
                    continue
                pk = ACTUAL_LINES_BY_ROUTE_ID[route_id]

                if pk not in linepk_to_alerts:
                    linepk_to_alerts[pk] = []
                    linepk_to_removed_stopids[pk] = set([])
                    # linepk_to_added_stopids[pk]   = set([])
                
                linepk_to_alerts[pk].append(alert)
                linepk_to_removed_stopids[pk].update(alert["removed_stop_ids"])
                # linepk_to_added_stopids[pk].update(alert["added_stop_ids"])
        
        # while we're at it, get all stop metadata
        # all_affected_stops = self.gtfsdbapi.get_stop_metadata(
        #     functools.reduce(
        #         lambda x, y: x.union(y),
        #         itertools.chain(
        #             linepk_to_removed_stopids.values(),
        #             linepk_to_added_stopids.values()
        #         ),
        #         set([])
        #     )
        # )

        TODAY_IN_JERUS = JERUSALEM_TZ \
            .fromutc(datetime.utcnow())\
            .replace(
                hour=0,
                minute=0,
                second=0,
                microsecond=0
            )
        
        # TOMORROW_IN_JERUS = TODAY_IN_JERUS + timedelta(days=1)

        
        all_lines_enriched = []

        for line_dict in ACTUAL_LINES_LIST:
            pk = line_dict["pk"]
            alerts = linepk_to_alerts.get(pk, [])
            num_alerts = len(alerts)
            
            e = {
                **line_dict,
                "num_alerts": num_alerts,
                "first_relevant_date": None if num_alerts == 0 else min(map(
                    lambda alert: alert["first_relevant_date"],
                    alerts
                )),
                "num_relevant_today": None if num_alerts == 0 else sum(map(
                    lambda alert: int(alert["first_relevant_date"] == TODAY_IN_JERUS),
                    alerts
                )),
                "num_removed_stops": None if num_alerts == 0 else len(
                    linepk_to_removed_stopids[pk].intersection(line_dict["all_stopids_distinct"])
                )
                # "num_relevant_tomorrow": None if num_alerts == 0 else sum(map(
                #     lambda alert: int(alert["first_relevant_date"] == TOMORROW_IN_JERUS),
                #     alerts
                # )),
                # "num_relevant_future": None if num_alerts == 0 else sum(map(
                #     lambda alert: int(alert["first_relevant_date"] > TOMORROW_IN_JERUS),
                #     alerts
                # ))
                # "alert_titles": None if num_alerts == 0 else [
                #     alert["header"] for alert in alerts
                # ],
                # "removed_stops": None if num_alerts == 0 else
                #     map( # TODO sort
                #         lambda stop_id: [
                #             all_affected_stops[stop_id]["stop_code"],
                #             all_affected_stops[stop_id]["stop_name"]
                #         ],
                #         linepk_to_removed_stopids[pk]
                #     ),
                # "added_stops": None if num_alerts == 0 else
                #     map( # TODO sort
                #         lambda stop_id: [
                #             all_affected_stops[stop_id]["stop_code"],
                #             all_affected_stops[stop_id]["stop_name"]
                #         ],
                #         linepk_to_added_stopids[pk]
                #     )
                # TODO distance from user's current location
            }
            del e["all_directions_grouped"]
            all_lines_enriched.append(e)
        
        lines_with_alert = sorted(
            filter(
                lambda line_dict: line_dict["num_alerts"] > 0,
                all_lines_enriched
            ),
            key=lambda x: (
                -x["num_alerts"],
                line_number_for_sorting(x["route_short_name"]),
                x["agency_id"] # TODO agency_name
            )
        )

        return {
            "lines_with_alert": lines_with_alert,
            "all_lines": all_lines_enriched,
            "all_agencies": ALL_AGENCIES_DICT,
            "uses_location": False # TODO ugh
        }


    @cherrypy.expose
    @cherrypy.tools.json_out()
    def single_line(self, id):
        # TODO: alert data

        line_dict = ACTUAL_LINES_DICT[id]

        agency_dict = self.gtfsdbapi.get_all_agencies([line_dict["agency_id"]])

        result = {
            "line_details": {
                "pk": id,
                "route_short_name": line_dict["route_short_name"],
                "agency": next(iter(agency_dict.values())),
                "headsign_1": line_dict["headsign_1"],
                "headsign_2": line_dict["headsign_2"],
                "is_night_line": line_dict["is_night_line"],
                # "all_directions_grouped": []
            }
        }

        all_stop_ids = set(line_dict["all_stopids_distinct"])

        # the thought behind flattening these is that i want just one consolidated list
        # shown to the user and sorted by the server, because flattening and sorting it
        # in a react componen would be silly 
        dirs_flattened = []
        # collect this for the label_headsigns_for_direction_and_alternative function
        dict_headsign_to_dir_alt_pairs = {}
        headsigns_collected = set([])
        dir_alt_pairs_collected = []

        for alt_orig in line_dict["all_directions_grouped"]:
            # we do a deep copy here so that we don't accidentally modify our original cache(?) of actual_lines
            for dir_orig in alt_orig["directions"]:
                dir = {
                    **dir_orig,
                    "alt_id": alt_orig["alt_id"]
                }
                dirs_flattened.append(dir)

                rep_trip_id = self.gtfsdbapi.get_representative_trip_id(dir["route_id"], JERUSALEM_TZ.fromutc(datetime.utcnow()))
                dir["stop_seq"] = self.gtfsdbapi.get_stop_seq(rep_trip_id)
                dir["shape"] = self.gtfsdbapi.get_shape_points(rep_trip_id)

                dir_alt_pairs_collected.append((dir["dir_id"], dir["alt_id"]))
                headsign = dir["headsign"]
                if headsign not in headsigns_collected:
                    headsigns_collected.add(headsign)
                    dict_headsign_to_dir_alt_pairs[headsign] = []
                
                dict_headsign_to_dir_alt_pairs[headsign].append((dir["dir_id"], alt_orig["alt_id"]))
        
        # get list of alerts, but only the ones relevant for this line's route_ids
        all_alerts, all_alerts_metadata = self._all_alerts()

        alerts_grouped = []

        for dir in dirs_flattened:
            alerts_grouped.append(
                [
                    a for a in all_alerts
                    if dir["route_id"] in a["relevant_route_ids"]
                    and not a["is_expired"]
                ]
            )

        # at first, just get every alert's route_changes (but limited to each route_id) on its own

        for dir, alerts in zip(dirs_flattened, alerts_grouped):
            dir["route_changes"] = []
            dir["other_alerts"]  = []

            for alert in alerts:
                alert_minimal = {
                    "header": alert["header"],
                    "description": alert["description"],
                    "active_periods": alert["active_periods"],
                    "is_deleted": alert["is_deleted"],
                }                    

                chgs_struct = self._cached_route_changes(alert["id"], alert)
                agency_id = result["line_details"]["agency"]["agency_id"]
                line_number = result["line_details"]["route_short_name"]

                if "departure_changes" in alert:
                    dc = alert["departure_changes"] or {}
                    a = dc.get(agency_id, {}) or {}
                    l = a.get(line_number, []) or []
                    for dep_chg in l:
                        if dep_chg["route_id"] == dir["route_id"]:
                            alert_minimal["departure_change"] = dep_chg
                            break

                relevant_change_struct = None

                if "route_changes" in chgs_struct:
                    rc = chgs_struct["route_changes"] or {}
                    a = rc.get(agency_id, {}) or {}
                    l = a.get(line_number, []) or []
                    for chg in l:
                        if chg["route_id"] == dir["route_id"]:
                            relevant_change_struct = chg
                            break
                
                if relevant_change_struct != None:
                    dir["route_changes"].append(alert_minimal)
                    alert_minimal["shape"] = relevant_change_struct["shape"]
                    alert_minimal["deleted_stop_ids"] = relevant_change_struct["deleted_stop_ids"]
                    alert_minimal["updated_stop_sequence"] = relevant_change_struct["updated_stop_sequence"]
                    alert_minimal["bbox_stop_ids"] = compute_stop_ids_incl_adj_for_single_route_change(alert_minimal, dir["stop_seq"])
                    all_stop_ids.update(alert_minimal["bbox_stop_ids"])
                else:
                    dir["other_alerts"].append(alert_minimal)
        
        result["all_stops"] = self.gtfsdbapi.get_stop_metadata(all_stop_ids)
        result["map_bounding_box"] = bounding_box_for_stops(result["all_stops"].keys(), result["all_stops"])

        for dir in dirs_flattened:
            for rc in dir["route_changes"]:
                rc["map_bounding_box"] = bounding_box_for_stops(rc["bbox_stop_ids"], result["all_stops"])
                # TODO fill in missing shapes

        # TODO LATER: divide their active_period_raw into a sequence of (alert_bitmask, start_time, end_time)
        # TODO LATER: refactor the route_changes logic so that we can sequentially apply alert after alert to the same route
        # TODO LATER: user that to give the user a list of time periods + cumulative map for each time period
        
        dir_alt_names = label_headsigns_for_direction_and_alternative(
            dict(
                map(
                    lambda h: (h, dir_alt_pairs_collected),
                    headsigns_collected
                )
            ),
            dict_headsign_to_dir_alt_pairs,
            map(
                lambda d: (d["headsign"], (d["dir_id"], d["alt_id"])),
                dirs_flattened
            ),
            True
        )

        for dir, (dir_name, alt_name) in zip(dirs_flattened, dir_alt_names):
            dir["dir_name"] = dir_name
            dir["alt_name"] = alt_name
        
        dirs_flattened.sort(
            key = lambda d: (d["dir_name"] or "", d["alt_name"] or "")
        )
        
        result["line_details"]["dirs_flattened"] = dirs_flattened
        
        return result

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
            
            first_relevant_date, current_active_period_start = alert_find_next_relevant_date(alert)
            
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
            
            # TODO: it looks like i never took care of the REGION use case lmaooooooo
            #       i'd feel much more comfortable implementing it if they,,, uh,,,,,,,,,,,, ever used it :|
            #       but sure; i can try to do it al iver just in case
            if alert["use_case"] not in [
                USE_CASE.STOPS_CANCELLED.value,
                USE_CASE.ROUTE_CHANGES_FLEX.value,
                USE_CASE.ROUTE_CHANGES_SIMPLE.value
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
                    label_line_changes_headsigns_for_direction_and_alternative(line_changes)

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
            
            # 8. bounding box for the map widget
            map_bounding_box = bounding_box_for_stops(
                itertools.chain(
                    alert["added_stop_ids"],
                    alert["removed_stop_ids"],
                    list(near_added_stop_ids)
                ),
                stops_for_map
            )

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
                    key=lambda x: x["to_text"] # TODO uhhhh this doesn't look like the same sort wtf did i do here lol
                )

        return {
            "departure_changes": changes_by_agency_and_line
        }


class JSONEncoderWithDateTime(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, set) or isinstance(obj, map):
            return list(obj)
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

ALL_AGENCIES_DICT = None

def create_all_agencies_list(gtfsdbapi):
    global ALL_AGENCIES_DICT

    ALL_AGENCIES_DICT = gtfsdbapi.get_all_agencies()

ACTUAL_LINES_LIST = []
ACTUAL_LINES_DICT = {}

ACTUAL_LINES_BY_ROUTE_ID = {}

def line_pk_to_str(mot_license_id, route_short_name):
    return f"{route_short_name}_{mot_license_id}"

def create_actual_lines_list(gtfs_db_url):
    cherrypy.log("Started generating list of actual lines")

    # https://stackoverflow.com/a/4060259
    cwd = os.path.realpath(os.path.join(os.getcwd(), os.path.dirname(__file__)))

    sql_script = None
    with open(os.path.join(cwd, "route_grouping_query.sql"), "r") as f:
        # this feels so dirty lmao
        sql_script = f.read()
    
    with psycopg2.connect(gtfs_db_url) as gtfsconn:
        with gtfsconn.cursor() as cursor:
            cursor.execute(sql_script) # like bestie WHAT
            cursor.execute("SELECT * FROM tmp__actual_lines ORDER BY route_short_name, agency_id, mot_license_id;")
            for values in cursor.fetchall():
                linedict = {
                    column.name: value
                    for column, value in zip(cursor.description, values)
                }
                pk = line_pk_to_str(linedict["mot_license_id"], linedict["route_short_name"])
                linedict["pk"] = pk

                hs_1 = linedict.get("headsign_1", None)
                if hs_1:
                    linedict["headsign_1"] = hs_1.replace("_", " - ")

                hs_2 = linedict.get("headsign_2", None)
                if hs_2:
                    linedict["headsign_2"] = hs_2.replace("_", " - ")
                
                linedict["main_cities"] = set()
                other_alts_cities = set()

                is_first_alt = True
                
                for alt in linedict["all_directions_grouped"]:
                    directions = alt["directions"]

                    for dir in directions:
                        dir["headsign"] = dir["headsign"].replace("_", " - ")
                        if is_first_alt:
                            linedict["main_cities"].update(dir["city_list"])
                        else:
                            other_alts_cities.update(dir["city_list"])
                        
                        ACTUAL_LINES_BY_ROUTE_ID[dir["route_id"]] = pk
                        

                    is_first_alt = False

                linedict["secondary_cities"] = sorted(other_alts_cities.difference(linedict["main_cities"]))

                linedict["all_stopids_distinct"] = set(linedict["all_stopids_distinct"])

                ACTUAL_LINES_LIST.append(linedict)
                ACTUAL_LINES_DICT[pk] = linedict
    
    cherrypy.log("Finished generating list of actual lines")


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

    create_actual_lines_list(gtfs_db_url)

    with psycopg2.connect(gtfs_db_url) as gtfsconn, psycopg2.connect(alerts_db_url) as alertconn:
        gtfsdbapi = GtfsDbApi(gtfsconn)
        alertdbapi = AlertDbApi(alertconn)

        create_all_agencies_list(gtfsdbapi)

        cherrypy.tree.mount(ServiceAlertsApiServer(gtfsdbapi, alertdbapi), '/api', server_conf_api)
        # cherrypy.tree.mount(None, '/', server_conf_root)
        cherrypy.engine.start()
        cherrypy.engine.block()

if __name__ == "__main__":
    main()