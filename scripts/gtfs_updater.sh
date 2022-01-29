

#!/bin/bash
set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

pushd ${DIR}
    #POSTGRES_DSN="$(python3 -c 'import configparser; c = configparser.ConfigParser(); c.read("config.ini"); print(c["psql"]["dsn"])')"
    POSTGRES_DSN="postgres:///israel_gtfs"
    POSTGRES_DSN_ALERTS="postgres:///israel_gtfs_sa"
    #wget ftp://gtfs.mot.gov.il/israel-public-transportation.zip -O israel-public-transportation.zip
    #wget ftp://gtfs.mot.gov.il/TripIdToDate.zip -O TripIdToDate.zip
    #wget ftp://gtfs.mot.gov.il/ClusterToLine.zip -O ClusterToLine.zip
    psql -n $POSTGRES_DSN -c "drop table if exists agency, cities, routes, shapes, stops, stoptimes, translations, trip_id_to_date, trips, calendar, mot_clusters cascade;"
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
    echo -n "loading trips:        "
    psql $POSTGRES_DSN -c "\\copy trips from trips.txt with csv header quote ''"
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
    rm -fr "$TEMP_DIR"
popd

