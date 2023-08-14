#!/bin/bash
set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

pushd ${DIR}
    #POSTGRES_DSN="$(python3 -c 'import configparser; c = configparser.ConfigParser(); c.read("config.ini"); print(c["psql"]["dsn"])')"
    POSTGRES_DSN="postgres://postgres:123@localhost/israel_gtfs"
    POSTGRES_DSN_ALERTS="postgres://postgres:123@localhost/israel_gtfs_sa"
    # wget https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip -O israel-public-transportation.zip
    # wget https://gtfs.mot.gov.il/gtfsfiles/TripIdToDate.zip -O TripIdToDate.zip
    # wget https://gtfs.mot.gov.il/gtfsfiles/ClusterToLine.zip -O ClusterToLine.zip
    psql -n $POSTGRES_DSN -c "drop table if exists stop_popularity; drop table if exists actual_lines; drop view if exists stoptimes_int; drop table if exists agency, cities, routes, shapes, stops, stoptimes, translations, trip_id_to_date, trips, calendar, mot_clusters cascade;"
    psql $POSTGRES_DSN -f gtfs_schema.sql
    psql -n $POSTGRES_DSN_ALERTS -c "drop table if exists alert, alert_agency, alert_stop, alert_route cascade;"
    psql $POSTGRES_DSN_ALERTS -f alerts_schema.sql
    TEMP_DIR="$(mktemp -d)"
    unzip israel-public-transportation.zip -d "$TEMP_DIR"
    unzip TripIdToDate.zip -d "$TEMP_DIR"
    unzip ClusterToLine.zip -d "$TEMP_DIR"
    pushd "$TEMP_DIR"
    # Hack! use  (U+0007, bell) as a quote character, since this will probably
    # will never appear in the CSV. This will avoid skipping lines when "
    # is used in the original CSV
    echo -n "loading translations: "
    psql $POSTGRES_DSN -c "\\copy translations from 'translations.txt' with csv header quote ''"
    echo -n "loading agencies:     "
    psql $POSTGRES_DSN -c "\\copy agency from 'agency.txt' with csv header"
    echo -n "loading stops:        "
    psql $POSTGRES_DSN -c "\\copy stops from stops.txt with csv header quote ''"
    echo -n "loading routes:       "
    psql $POSTGRES_DSN -c "\\copy routes from routes.txt with csv header quote ''"
    # if grep -q 'wheelchair_accessible' trips.txt
    # then
    #     echo "yay, it's the end of days and the ministry of transport suddenly cares about wheelchair users, no modification needed"
    # else
    #     echo "boo, ministry of transport still doesn't care about wheelchair users :( ☹ "
    #     sed -i 's/\r$/,\r/' trips.txt
    #     sed -i "1 s|\r$|wheelchair_accessible\r|" trips.txt
    # fi
    echo "working around MoT Duplicate TRIP IDs issue"
    psql $POSTGRES_DSN -c "DROP TABLE IF EXISTS tmp_trips;"
    psql $POSTGRES_DSN -c "CREATE TABLE tmp_trips AS SELECT * FROM trips WITH NO DATA;"
    psql $POSTGRES_DSN -c "\\copy tmp_trips from trips.txt with csv header quote ''"
    psql $POSTGRES_DSN -c "INSERT INTO trips SELECT DISTINCT ON (trip_id) * FROM tmp_trips"
    psql $POSTGRES_DSN -c "DROP TABLE tmp_trips;"
    # echo -n "loading trips:        "
    # psql $POSTGRES_DSN -c "\\copy trips from trips.txt with csv header quote ''"
    echo -n "loading stoptimes:    "
    psql $POSTGRES_DSN -c "\\copy stoptimes from 'stop_times.txt' with csv header"
    echo -n "loading shape points:     "
    psql $POSTGRES_DSN -c "\\copy shapes from 'shapes.txt' with csv header"
    echo -n "loading calendars:    "
    psql $POSTGRES_DSN -c "\\copy calendar from calendar.txt with csv header quote ''"
    echo -n "loading clusters:     "
    #sed -i 's/,\r$/\r/' ClusterToLine.txt # TODO ugh
    psql $POSTGRES_DSN -c "\\copy mot_clusters from 'ClusterToLine.txt' with csv header quote ''"
    echo -n "loading trip mapping:     "
    #sed -i 's/,\r$/\r/' TripIdToDate.txt # TODO ugh
    psql $POSTGRES_DSN -c "\\copy trip_id_to_date from 'TripIdToDate.txt' with csv header quote ''"
    popd
    psql $POSTGRES_DSN -c "UPDATE translations SET translation='Jerusalem' WHERE trans_id='ירושלים' AND lang='EN';"
    echo -n "creating stop_popularity table:    "
    psql $POSTGRES_DSN -f stop_popularity.sql
    psql $POSTGRES_DSN -f route_grouping_query.sql
    rm -fr "$TEMP_DIR"
popd

