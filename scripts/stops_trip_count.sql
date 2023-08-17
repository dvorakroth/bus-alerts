DROP TABLE IF EXISTS stops_trip_count;

CREATE TABLE stops_trip_count AS
    SELECT
        stop_code,
        (ARRAY_AGG(stop_name))[1] AS stop_name,
        COUNT(DISTINCT trip_id) AS num_trips
    FROM stops
    LEFT OUTER JOIN stoptimes
    ON stoptimes.stop_id = stops.stop_id
    GROUP BY stop_code;

ALTER TABLE stops_trip_count
    ADD CONSTRAINT stops_trip_count_pkey PRIMARY KEY (stop_code);