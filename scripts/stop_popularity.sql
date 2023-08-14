DROP TABLE IF EXISTS stop_popularity;

CREATE TABLE stop_popularity AS
    SELECT
        stop_code,
        (ARRAY_AGG(stop_name))[1] AS stop_name,
        COUNT(DISTINCT trip_id) AS num_trips
    FROM stops
    LEFT OUTER JOIN stoptimes
    ON stoptimes.stop_id = stops.stop_id
    GROUP BY stop_code;

ALTER TABLE stop_popularity
    ADD CONSTRAINT stop_popularity_pkey PRIMARY KEY (stop_code);