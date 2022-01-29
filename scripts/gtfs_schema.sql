-- shared schema for my Israeli GTFS projects

CREATE TABLE agency (
    agency_id character varying NOT NULL,
    agency_name character varying,
    agency_url character varying,
    agency_timezone character varying,
    agency_lang character varying,
    agency_phone character varying,
    agency_fare_url character varying
);
ALTER TABLE ONLY agency
    ADD CONSTRAINT agency_pkey PRIMARY KEY (agency_id);


CREATE TABLE cities (
    name character varying NOT NULL,
    english_name character varying
);
ALTER TABLE ONLY cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (name);


CREATE TABLE mot_clusters (
    "OperatorName" character varying,
    "OfficeLineId" character varying,
    "OperatorLineId" character varying,
    "ClusterName" character varying,
    "FromDate" date,
    "ToDate" date,
    "ClusterId" character varying,
    "LineType" character varying,
    "LineTypeDesc" character varying,
    "ClusterSubDesc" character varying,
    "IntentionallyLeftBlank" CHARACTER VARYING
);


CREATE TABLE routes (
    route_id character varying NOT NULL,
    agency_id character varying,
    route_short_name character varying,
    route_long_name character varying,
    route_desc character varying,
    route_type integer,
    route_color character varying
);
ALTER TABLE ONLY routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (route_id);
CREATE INDEX ix_routes_route_short_name ON routes USING btree (route_short_name);
CREATE INDEX ix_routes_route_desc ON routes USING btree (route_desc);


CREATE TABLE shapes (
    shape_id character varying,
    shape_pt_lat double precision,
    shape_pt_lon double precision,
    shape_pt_sequence integer
);
ALTER TABLE ONLY shapes
    ADD CONSTRAINT shapes_pkey PRIMARY KEY (shape_id, shape_pt_sequence);
CREATE INDEX ix_shapes_shape_id ON shapes USING btree (shape_id);


CREATE TABLE stops (
    stop_id character varying NOT NULL,
    stop_code character varying,
    stop_name character varying,
    stop_desc character varying,
    stop_lat double precision,
    stop_lon double precision,
    location_type boolean,
    parent_station character varying,
    zone_id character varying
);
ALTER TABLE ONLY stops
    ADD CONSTRAINT stops_pkey PRIMARY KEY (stop_id);
CREATE INDEX ix_stops_stop_code ON stops USING btree (stop_code);


CREATE TABLE stoptimes (
    trip_id character varying NOT NULL,
    arrival_time character varying NOT NULL,
    departure_time character varying,
    stop_id character varying NOT NULL,
    stop_sequence integer NOT NULL,
    pickup_type boolean,
    drop_off_type boolean,
    shape_dist_traveled character varying
);
ALTER TABLE ONLY stoptimes
    ADD CONSTRAINT stoptimes_pkey PRIMARY KEY (trip_id, arrival_time, stop_id, stop_sequence);
CREATE INDEX ix_stoptimes_stop_id ON stoptimes USING btree (stop_id);
CREATE INDEX ix_stoptimes_trip_id ON stoptimes USING btree (trip_id);

CREATE TABLE translations (
    trans_id character varying NOT NULL,
    lang character varying NOT NULL,
    translation character varying
);
ALTER TABLE ONLY translations
    ADD CONSTRAINT translations_pkey PRIMARY KEY (trans_id, lang);
CREATE INDEX ix_translations_trans_id ON translations USING btree (trans_id);


CREATE TABLE trip_id_to_date (
    "LineDetailRecordId" character varying,
    "OfficeLineId" character varying,
    "Direction" character varying,
    "LineAlternative" character varying,
    "FromDate" date,
    "ToDate" date,
    "TripId" character varying,
    "DayInWeek" character varying,
    "DepartureTime" character varying,
    "IntentionallyLeftBlank" character varying
);


CREATE TABLE trips (
    route_id character varying,
    service_id character varying,
    trip_id character varying NOT NULL,
    trip_headsign character varying,
    direction_id integer,
    shape_id character varying --,
    --wheelchair_accessible character varying
);
ALTER TABLE ONLY trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (trip_id);
CREATE INDEX ix_trips_route_id ON trips USING btree (route_id);

CREATE TABLE calendar (
    service_id character varying NOT NULL,
    sunday boolean,
    monday boolean,
    tuesday boolean,
    wednesday boolean,
    thursday boolean,
    friday boolean,
    saturday boolean,
    start_date date,
    end_date date
);
ALTER TABLE ONLY calendar
    ADD CONSTRAINT calendar_pkey PRIMARY KEY (service_id);



CREATE VIEW stoptimes_int AS
SELECT
    trip_id,
    arrival_time::INTERVAL AS arrival_time,
    departure_time::INTERVAL AS departure_time,
    stop_id,
    stop_sequence,
    pickup_type,
    drop_off_type,
    shape_dist_traveled
FROM stoptimes;