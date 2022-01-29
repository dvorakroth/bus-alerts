
-- service alerts

CREATE TABLE alert (
    id VARCHAR PRIMARY KEY,
    first_start_time TIMESTAMPTZ,
    last_end_time TIMESTAMPTZ,
    raw_data BYTEA,

    use_case INTEGER,
    original_selector JSON,
    cause VARCHAR,
    effect VARCHAR,
    url JSON,
    header JSON,
    description JSON,
    active_periods JSON,
    schedule_changes JSON,

    is_national BOOLEAN,
    deletion_tstz TIMESTAMPTZ
);

CREATE TABLE alert_agency (
    alert_id VARCHAR,
    agency_id VARCHAR,
    PRIMARY KEY (alert_id, agency_id) --,
    -- CONSTRAINT fk_alert_id FOREIGN KEY(alert_id) REFERENCES alert(id),
    -- CONSTRAINT fk_agency_id FOREIGN KEY(agency_id) REFERENCES agency(agency_id)
);

-- CREATE TABLE alert_city (
--     alert_id VARCHAR,
--     city_name VARCHAR,
--     PRIMARY KEY (alert_id, city_name) --,
--     -- CONSTRAINT fk_alert_id FOREIGN KEY(alert_id) REFERENCES alert(id),
--     -- CONSTRAINT fk_city_name FOREIGN KEY(city_name) REFERENCES cities(name)
-- );

CREATE TABLE alert_stop (
    alert_id VARCHAR,
    stop_id VARCHAR,
    is_added BOOLEAN,
    is_removed BOOLEAN,
    PRIMARY KEY (alert_id, stop_id) --,
    -- CONSTRAINT fk_alert_id FOREIGN KEY(alert_id) REFERENCES alert(id),
    -- CONSTRAINT fk_stop_id FOREIGN KEY(stop_id) REFERENCES stops(stop_id)
);

CREATE TABLE alert_route (
    alert_id VARCHAR,
    route_id VARCHAR,
    PRIMARY KEY (alert_id, route_id) --,
    -- CONSTRAINT fk_alert_id FOREIGN KEY(alert_id) REFERENCES alert(id),
    -- CONSTRAINT fk_route_id FOREIGN KEY(route_id) REFERENCES routes(route_id)
);

CREATE VIEW alerts_with_related AS
SELECT alert.*,
    ARRAY(SELECT agency_id FROM alert_agency WHERE alert_agency.alert_id=id ORDER BY agency_id ASC) AS relevant_agencies,
    ARRAY(SELECT route_id  FROM alert_route  WHERE alert_route.alert_id=id  ORDER BY route_id  ASC) AS relevant_route_ids,
    ARRAY(SELECT stop_id   FROM alert_stop   WHERE alert_stop.alert_id=id AND is_added=TRUE   ORDER BY stop_id   ASC) AS added_stop_ids,
    ARRAY(SELECT stop_id   FROM alert_stop   WHERE alert_stop.alert_id=id AND is_removed=TRUE ORDER BY stop_id   ASC) AS removed_stop_ids,
    (
        last_end_time < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem') --::DATE
        OR
        (deletion_tstz IS NOT NULL AND (deletion_tstz + INTERVAL '2 days') < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem'))
    ) AS is_expired,
    (deletion_tstz IS NOT NULL) AS is_deleted
FROM alert;

-- useful for debugging:
-- DELETE FROM alert; DELETE FROM alert_agency; DELETE FROM alert_stop; DELETE FROM alert_route;