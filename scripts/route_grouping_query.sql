-- introduction
-- ------------
--
-- despite whatever lies the gtfs may try to tell us about "routes" and
-- "license numbers" and various other data fields -- we as true, flesh-and-
-- blood humans, all know in our hearts the true meaning of "bus line". the
-- gtfs will indiscriminately tear families apart, but we, upon looking at
-- them, recognize immediately the cruel misclassifications done.
--
-- and so here, i intend to create a vague simulacrum of that divison which to
-- us is so intuitive. by first excluding several categories of transit lines
-- which are unfortunately inconvenient for my purposes; and then by looking at
-- several fields combined to group and regroup what's left
--
-- inconvenient for my purposes
-- ----------------------------
--
-- chief among these are student lines, train lines, and light rail lines.
-- student lines are indicated on the israeli gtfs by setting route_color to
-- 'FF9933', train lines are indicated by route_type=2 (TRAIN), and light rail
-- lines are indicated by route_type=0 (TRAM). we can just safely(?) ignore all
-- of these inconvenient lines for now, since none of them ever have any
-- service alerts given in the gtfs-rt feed anyway.
--
-- route_desc
-- ----------
--
-- the israeli ministry of transportation uses gtfs' route_desc field in the
-- following extremely creative way:
-- *ahem*
-- they use it to store the line's internal bureaucratic IDs
-- and they do it in a way where they're separated by dashes
--
-- clever, i know;;;,,
--
-- so at this juncture we also separate these out into individual fields so
-- it'll be easier to group by them later on

SELECT split_part(route_desc, '-', 1) AS mot_license_id,
       split_part(route_desc, '-', 2) AS mot_direction_id,
       split_part(route_desc, '-', 3) AS mot_alternative_id,
       (
            SELECT trip_id
            FROM trips
            WHERE trips.route_id = routes.route_id
            LIMIT 1
        ) AS random_trip_id,
       (CASE WHEN route_color = '9933FF' THEN TRUE ELSE FALSE END) AS is_night_line,
       routes.*
INTO TEMP TABLE tmp__routes
FROM routes
WHERE route_type != 2
    AND route_type != 0
    AND (route_color IS NULL OR route_color != 'FF9933');

ALTER TABLE tmp__routes ADD PRIMARY KEY (route_id);

SELECT DISTINCT ON (tmp__routes.route_id)
    tmp__routes.route_id,
    trip_id,
    MIN(stop_sequence) AS min_stop_sequence,
    MAX(stop_sequence) AS max_stop_sequence,
    JSON_AGG(DISTINCT substring(
            -- get the city name out of stop_desc
            substring(stop_desc, position('עיר:' in stop_desc) + 5),
            0,
            position('רציף: ' in substring(stop_desc, position('עיר:' in stop_desc) + 5)) - 1
    )) AS city_list,
    JSON_AGG(DISTINCT stop_id) AS distinct_stop_ids
INTO TEMP TABLE tmp__route_trips
FROM tmp__routes INNER JOIN trips ON trip_id = random_trip_id
NATURAL JOIN stoptimes
NATURAL JOIN stops
GROUP BY tmp__routes.route_id, trip_id;

ALTER TABLE tmp__route_trips ADD PRIMARY KEY (route_id);
CREATE UNIQUE INDEX ON tmp__route_trips (trip_id);

-- group by mot_license_id & route_short_name
-- ------------------------------------------
--
-- the ministry of transport actually does the most important grouping for us,
-- when they do the bureacratic process of issuing a license for a new public
-- transit line. their internal categorization system has a five digit number
-- for every line, where the three least significant digits are the actual line
-- number -- ALMOST!
--
-- sometimes the routes have an extra aleph or bet at the end, which to the
-- ministry of transportation's indifferent bureacracy are just an extra
-- variant of that same line! but to us, as uberkhukhem jews, they will forever
-- be separate lines!
--
-- so we need to group by that too

-- TODO: finish writing the pretty comments lmao

-- we start from the deepest level because while it may be clearer to start
-- top-down, it's more efficient to do bottom-up


SELECT mot_license_id,
       route_short_name,
       mot_alternative_id,
       mot_direction_id,
       MAX(tmp__routes.route_id) AS route_id,
       MAX(route_desc) AS route_desc,
       MAX(trip_headsign) AS headsign,
       FALSE AS is_circular,
       BOOL_OR(is_night_line) AS is_night_line,
       NULL::JSON AS city_list
    --    0 AS best_trip_count -- will be calculated later because sql is hard lol
INTO TEMP TABLE tmp__actual_line_alt_directions
FROM tmp__routes NATURAL JOIN trips
GROUP BY mot_license_id, route_short_name, mot_alternative_id, mot_direction_id;

ALTER TABLE tmp__actual_line_alt_directions
ADD PRIMARY KEY (mot_license_id, route_short_name, mot_alternative_id, mot_direction_id);

UPDATE tmp__actual_line_alt_directions
SET city_list = (
    SELECT rt.city_list
    FROM tmp__route_trips rt
    WHERE rt.route_id = tmp__actual_line_alt_directions.route_id
),
is_circular = (
    -- distance between first and last stop lmao
    SELECT asin(
            sqrt(
                sin(radians(s2.stop_lat-s1.stop_lat)/2)^2 +
                sin(radians(s2.stop_lon-s1.stop_lon)/2)^2 *
                cos(radians(s1.stop_lat)) *
                cos(radians(s2.stop_lat))
            )
        ) * 7926.3352 AS distance
    -- SELECT geodistance_miles(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon)
    FROM 
        tmp__route_trips rt
        INNER JOIN stoptimes st1
        ON rt.trip_id = st1.trip_id AND st1.stop_sequence = rt.min_stop_sequence
        INNER JOIN stops s1
        ON st1.stop_id = s1.stop_id
        INNER JOIN stoptimes st2
        ON rt.trip_id = st2.trip_id AND st2.stop_sequence = rt.max_stop_sequence
        INNER JOIN stops s2
        ON st2.stop_id = s2.stop_id
    WHERE rt.route_id = tmp__actual_line_alt_directions.route_id
) <= 0.5; -- if it's less than a half mile (800 m) then consider the line to be circular

-- calculate best-trip-count-per-service-id field (ideally i'd want this to be
-- best-trip-count-per-day, but gtfs services are complicated sooooo heuristic
-- it is)

-- UPDATE tmp__actual_line_alt_directions d
-- SET best_trip_count = (
--     SELECT COUNT(DISTINCT trip_id)
--     FROM trips
--     WHERE trips.route_id = d.route_id
--     GROUP BY service_id
--     ORDER BY COUNT(DISTINCT trip_id) DESC
--     LIMIT 1
-- );

-- fill in missing headsigns lmao

-- israel_gtfs=# select route_desc from tmp__actual_line_alt_directions where headsign is null;
--  route_desc 
-- ------------
--  11357-2-1
--  52005-3-0
--  52005-1-0

UPDATE tmp__actual_line_alt_directions d
SET headsign = (
    -- get the name of the city, where the last stop for these trips is
    SELECT substring(
            -- get the city name out of stop_desc
            substring(stop_desc, position('עיר:' in stop_desc) + 5),
            0,
            position('רציף: ' in substring(stop_desc, position('עיר:' in stop_desc) + 5)) - 1
    )
    FROM  trips t1 NATURAL JOIN stoptimes st1 NATURAL JOIN stops
    WHERE route_id = d.route_id
    AND   stop_sequence = (
        -- find the max stop_sequence for this trip
        SELECT MAX(st2.stop_sequence)
        FROM   trips t2 NATURAL JOIN stoptimes st2
        WHERE t2.trip_id = t1.trip_id
        GROUP BY t2.trip_id
        LIMIT 1
    )
    LIMIT 1
)
WHERE headsign IS NULL;

-- aggregate these tiny splinters of bus information into route-alternatives
-- (what's known as xalufot, in hebrew)

SELECT mot_license_id,
       route_short_name,
       mot_alternative_id,
       BOOL_OR(is_night_line) AS is_night_line,
       JSON_AGG(
           JSON_BUILD_OBJECT(
               'dir_id', mot_direction_id,
               'route_id', route_id,
               'headsign', headsign,
               'city_list', city_list,
               'is_circular', is_circular
           )
           ORDER BY mot_direction_id ASC
       ) all_directions
    --    SUM(best_trip_count) sum_best_trip_count
INTO TEMP TABLE tmp__actual_line_alts
FROM tmp__actual_line_alt_directions
GROUP BY mot_license_id, route_short_name, mot_alternative_id;

ALTER TABLE tmp__actual_line_alts
ADD PRIMARY KEY (mot_license_id, route_short_name, mot_alternative_id);


-- aaand another level up
DROP TABLE IF EXISTS actual_lines;

SELECT mot_license_id,
       route_short_name,
       '' AS agency_id,
       '' AS headsign_1,
       '' AS headsign_2,
       BOOL_OR(is_night_line) AS is_night_line,
       JSON_AGG(
           JSON_BUILD_OBJECT(
               'alt_id', mot_alternative_id,
               'directions', all_directions
           )
           ORDER BY mot_alternative_id ASC
        ) AS all_directions_grouped,
       NULL::JSON AS all_stopids_distinct
INTO TABLE actual_lines
FROM tmp__actual_line_alts
GROUP BY mot_license_id, route_short_name;

ALTER TABLE actual_lines ADD PRIMARY KEY (mot_license_id, route_short_name);

UPDATE actual_lines
SET agency_id = (
        SELECT r.agency_id
        FROM routes r
        WHERE r.route_id = (all_directions_grouped #>> '{0, directions, 0, route_id}')
        LIMIT 1
    ),
    headsign_1 = (all_directions_grouped #>> '{0, directions, 0, headsign}'),
    headsign_2 = (
        CASE
            WHEN json_array_length(all_directions_grouped #> '{0, directions}') = 1 THEN NULL

            ELSE (all_directions_grouped #>> '{0, directions, 1, headsign}')
        END
    ),
    all_stopids_distinct = (
        SELECT JSON_AGG(DISTINCT stop_id)
        FROM tmp__route_trips
        INNER JOIN (
            SELECT JSON_ARRAY_ELEMENTS(alt.value -> 'directions') dir
            FROM JSON_ARRAY_ELEMENTS(all_directions_grouped) alt
        ) dirs_flattened
        ON dirs_flattened.dir ->> 'route_id' = tmp__route_trips.route_id
        CROSS JOIN LATERAL JSON_ARRAY_ELEMENTS_TEXT(distinct_stop_ids) stop_id
    );

-- CREATE OR REPLACE FUNCTION ___tmp__geodistance_miles(alat double precision, alng double precision, blat double precision, blng double precision)
--   RETURNS double precision AS
-- $BODY$
-- SELECT asin(
--   sqrt(
--     sin(radians($3-$1)/2)^2 +
--     sin(radians($4-$2)/2)^2 *
--     cos(radians($1)) *
--     cos(radians($3))
--   )
-- ) * 7926.3352 AS distance;
-- $BODY$
--   LANGUAGE sql IMMUTABLE
--   COST 100;

-- sometimes, when there's only one direction for the alternative,
-- it's actually bad data; so i'll need to check if the line is
-- REALLY circular (ugh; sounds complicated) and if it isn't, then
-- headsign_2 should be set to #>> '{1, 0}' instead
UPDATE actual_lines
SET headsign_2 = (
        CASE
            WHEN (all_directions_grouped #>> '{0, directions, 0, is_circular}')::BOOLEAN THEN
                NULL -- keep the headsign_2 as null, this trip's first and last stops are less than a half mile (800 m) apart
            WHEN (all_directions_grouped #>> '{1, directions, 0, headsign}') = headsign_1 THEN
                NULL -- TODO: maybe use first stop's name? idk that'd involve switching headsign 1 and 2
            ELSE (all_directions_grouped #>> '{1, directions, 0, headsign}')
        END
    )
WHERE headsign_2 IS NULL;
