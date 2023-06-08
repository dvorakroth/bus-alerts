import { docopt } from "docopt";
import * as fs from "fs";
import * as ini from "ini";
import * as winston from "winston";
import got from "got";
import pg from "pg";
import { DateTime } from "luxon";
import { transit_realtime } from "gtfs-realtime-bindings";
import { JERUSALEM_TZ, copySortAndUnique, forceToNumberOrNull, gtfsRtTranslationsToObject, inPlaceSortAndUnique } from "./junkyard.js";
import { consolidateActivePeriods } from "./activePeriodConsolidation.js";
import { AddStopChange, AlertUseCase, DepartureChanges, OriginalSelector, RouteChanges, TripSelector } from "./dbTypes.js";

const doc = `Load service alerts from MOT endpoint.

Usage:
    load_service_alerts.py [-h] [-c <file>] [-f <pbfile>]

Options:
    -h, --help                       Show this help message and exit.
    -c <file>, --config <file>       Use the specified configuration file.
    -f <pbfile>, --file <pbfile>     Load from <pbfile> instead of MOT endpoint.
                                     If the filename contains six numbers separated from each other by non-number characters, it'll get treated as a yyyy mm dd hh mm ss date
`;

const LOGGER = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console(),
        // TODO uh,,,, other stuff? idk ask elad lol
    ]
});

async function main() {
    const options = docopt(doc);

    const configPath = options["--config"] || "config.ini";
    const pbFilename = options["--file"] || null;

    const config = ini.parse(fs.readFileSync(configPath, 'utf-8'));

    const gtfsDbUrl = config["psql"]["dsn"];
    const alertsDbUrl = config["psql"]["alerts_db"];

    const motEndpoint = config["service_alerts"]["mot_endpoint"];

    let rawData: Buffer|null = null;
    let TESTING_fake_today: DateTime|null = null;

    if (pbFilename) {
        rawData = fs.readFileSync(pbFilename);
        TESTING_fake_today = tryParseFilenameDate(pbFilename);
    } else {
        const response = await got.get(motEndpoint)
        if (response.statusCode !== 200) {
            LOGGER.error(`received status code ${response.statusCode} ${response.statusMessage} from mot endpoint`);
            process.exit(1);
        }
        rawData = response.rawBody;
    }

    const feed = transit_realtime.FeedMessage.decode(
        new Uint8Array(rawData)
    );

    const gtfsDb = new pg.Client(gtfsDbUrl);
    const alertsDb = new pg.Client(alertsDbUrl);

    try {
        await alertsDb.query("BEGIN");
        await loadIsraeliGtfsRt(gtfsDb, alertsDb, feed, TESTING_fake_today);
        await alertsDb.query("COMMIT");
    } catch (err) {
        await alertsDb.query("ROLLBACK");
        throw err;
    }
}

main();

const FILENAME_DATE_REGEX = /(?<year>\d+)\D(?<month>\d+)\D(?<day>\d+)\D(?<hour>\d+)\D(?<minute>\d+)\D(?<second>\d+)/g;
function tryParseFilenameDate(filename: string): DateTime|null {
    const match = FILENAME_DATE_REGEX.exec(filename);
    if (!match) {
        return null;
    }

    const result = DateTime.fromObject(
        // the regex is ~*~perfectly engineered~*~ for the named groups to match lol
        match.groups as any,
        { zone: JERUSALEM_TZ }
    );

    if (!result.isValid) {
        LOGGER.warn(`couldn't make a date out of numbers in filename: ${filename}\n${result.invalidExplanation}`);
        return null;
    } else {
        LOGGER.info(`found date ${result.toISO()} in filename ${filename}`);
        return result;
    }
}

const CITY_LIST_PREFIX = "ההודעה רלוונטית לישובים: ";

async function loadIsraeliGtfsRt(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    feed: transit_realtime.FeedMessage,
    TESTING_fake_today: DateTime|null
) {
    for (const entity of feed.entity) {
        await loadSingleEntity(gtfsDb, alertsDb, entity, TESTING_fake_today);
    }

    LOGGER.info(`Added/updated ${feed.entity.length} alerts`)
    await markAlertsDeletedIfNotInList(alertsDb, feed.entity.map(({id}) => id), TESTING_fake_today);
}

async function loadSingleEntity(
    gtfsDb: pg.Client,
    alertsDb: pg.Client,
    entity: transit_realtime.IFeedEntity,
    TESTING_fake_today: DateTime|null
) {
    const id = entity.id;
    const alert = entity.alert||{};

    let firstStartTime: number|null = null;
    let lastEndTime: number|null = null;
    const activePeriods: [number|null, number|null][] = [];

    for (const period of alert?.activePeriod||[]) {
        const start = forceToNumberOrNull(period.start);
        const end = forceToNumberOrNull(period.end);
        activePeriods.push([start, end]);

        if (start) {
            if (firstStartTime === null || firstStartTime > start) {
                firstStartTime = start;
            }
        } else {
            firstStartTime = 0;
        }

        if (end) {
            if (lastEndTime === null || lastEndTime < end) {
                lastEndTime = end;
            }
        } else {
            // no end time = forever (more realistically, until alert is deleted)
            lastEndTime = 7258118400 // 2200-01-01 00:00 UTC
        }
    }

    const consolidatedActivePeriods = consolidateActivePeriods(activePeriods);
    const url = gtfsRtTranslationsToObject(alert.url?.translation || []);
    const header = gtfsRtTranslationsToObject(alert.headerText?.translation || []);
    const description = gtfsRtTranslationsToObject(alert.descriptionText?.translation || []);

    const cause = transit_realtime.Alert.Cause[alert.cause ?? transit_realtime.Alert.Cause.UNKNOWN_CAUSE];
    const effect = transit_realtime.Alert.Effect[alert.effect ?? transit_realtime.Alert.Effect.OTHER_EFFECT];

    const oldAramaic = (function() { // *sigh*
        if (description.oar) {
            const tmp = description.oar;
            delete description.oar;
            return tmp;
        } else {
            return null;
        }
    })();

    let useCase: AlertUseCase|null = null;
    let originalSelector: OriginalSelector = {};

    const hasEnt = (alert.informedEntity?.length ?? 0) > 0;
    const firstEnt = alert.informedEntity?.[0];

    const relevantAgencies: string[] = [];
    const relevantRouteIds: string[] = [];
    const addedStopIds: string[] = [];
    const removedStopIds: string[] = [];
    let routeChanges: RouteChanges|null = null;
    let departureChanges: DepartureChanges|null = null;

    const hasOarRouteId = oldAramaic && oldAramaic.startsWith("route_id=");

    if (hasOarRouteId || firstEnt?.stopId) {
        if (!hasOarRouteId && !firstEnt?.routeId) {
            // no old aramaic, no route_id -- only stop_id
            useCase = AlertUseCase.StopsCancelled;

            const stop_ids = (alert.informedEntity?.map(e => e.stopId).filter(s => !!s) ?? []) as string[];

            originalSelector = {
                stop_ids
            };

            removedStopIds.push(...stop_ids);
            relevantRouteIds.push(...await fetchAllRouteIdsAtStopsInDateranges(
                gtfsDb,
                removedStopIds,
                activePeriods
            ));
            relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
        } else {
            // route_id and stop_id
            const routeStopPairs: [string, string][] = [];
            routeChanges = {};
            if (routeChanges === null) {
                throw "???"; //shouldn't happen; this is just here to typescript doesn't yell at me
            }

            for (const entity of alert.informedEntity ?? []) {
                if (!entity.stopId || !entity.routeId) {
                    continue; // this actually happened once and bugged the api server's code -_-
                }

                removedStopIds.push(entity.stopId);
                routeStopPairs.push([entity.routeId, entity.stopId]);

                if (!routeChanges.hasOwnProperty(entity.routeId)) {
                    routeChanges[entity.routeId] = [];
                    relevantRouteIds.push(entity.routeId);
                }

                routeChanges[entity.routeId]?.push({
                    removed_stop_id: entity.stopId
                });
            }

            if (!oldAramaic) {
                useCase = AlertUseCase.RouteChangesSimple;
                originalSelector = {route_stop_pairs: routeStopPairs};
            } else {
                useCase = AlertUseCase.RouteChangesFlex;
                originalSelector = {
                    route_stop_pairs: routeStopPairs,
                    old_aramaic: oldAramaic
                };
                const oarAdditions = parseOldAramaicRoutechgs(oldAramaic);

                // merge the schedule changes we got from old aramaic text
                // into the schedule changes we got from informed_entity[]
                for (const [routeId, additions] of Object.entries(oarAdditions)) {
                    if (!routeChanges.hasOwnProperty(routeId)) {
                        routeChanges[routeId] = additions;
                        relevantRouteIds.push(routeId);
                    } else {
                        // put additions before removals because the additions
                        // can be relative to a stop that gets removed
                        // and i wanna be good to future me and avoid these bugs(?)
                        routeChanges[routeId]?.splice(0, 0, ...additions);
                    }

                    addedStopIds.push(...additions.map(a => a.added_stop_id));
                }
            }

            inPlaceSortAndUnique(removedStopIds);
            inPlaceSortAndUnique(addedStopIds);
            inPlaceSortAndUnique(relevantRouteIds);
            relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
        }
    } else if (firstEnt?.trip?.tripId) {
        useCase = AlertUseCase.ScheduleChanges;

        const trips: TripSelector[] = [];
        const allFakeTripIds: Set<string> = new Set<string>([]); // dolan y
        departureChanges = {};
        if (departureChanges === null) {
            throw "???"; // once again: shouldn't happen, only here so typescript won't yell at me
        }

        for (const entity of alert.informedEntity ?? []) {
            const trip = {
                route_id: entity.trip?.routeId ?? "",
                fake_trip_id: entity.trip?.tripId ?? "", // ugh -_-
                action: entity.trip?.scheduleRelationship ?? transit_realtime.TripDescriptor.ScheduleRelationship.SCHEDULED,
                start_time: entity.trip?.startTime ?? ""
            };
            trips.push(trip);

            if (!departureChanges.hasOwnProperty(trip.route_id)) {
                departureChanges[trip.route_id] = {
                    added: [],
                    removed: []
                };
                relevantRouteIds.push(trip.route_id);
            }

            if (
                trip.action === transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED
                && trip.fake_trip_id
                && trip.fake_trip_id !== "0"
            ) {
                departureChanges[trip.route_id]?.removed?.push(trip.fake_trip_id);
                allFakeTripIds.add(trip.fake_trip_id);
            } else if (
                trip.action === transit_realtime.TripDescriptor.ScheduleRelationship.ADDED
                || !trip.fake_trip_id
                || trip.fake_trip_id === "0"
            ) {
                departureChanges[trip.route_id]?.added.push(trip.start_time);
            }
        }

        // convert removed trips from fake ids (-____-) to actual times
        const departureTimes = await fetchDeparturesForFakeTripIds(gtfsDb, [...allFakeTripIds]);
        for (const change of Object.values(departureChanges)) {
            change.removed = copySortAndUnique(
                change.removed.map(fakeId => departureTimes[fakeId]??"")
            );
            change.added = copySortAndUnique(change.added);
        }

        relevantAgencies.push(...await fetchUniqueAgenciesForRoutes(gtfsDb, relevantRouteIds));
        originalSelector = {trips};
    }
    // TODO
}

function parseOldAramaicRoutechgs(routechgsText: string) {
    const results: {[routeId: string]: AddStopChange[]} = {};

    for (const command of routechgsText.split(";")) {
        if (!command) {
            continue;
        }

        const values = (function() {
            const obj: {[_: string]: string} = {};
            for (const x of command.split(",")) {
                const [k, v] = x.split("=");
                obj[k??""] = v??"";
            }
            return obj;
        })();

        const routeId = values["route_id"] ?? "";
        const added_stop_id = values["add_stop_id"] ?? "";
        const is_before = values.hasOwnProperty("before_stop_id");

        if (!results.hasOwnProperty(routeId)) {
            results[routeId] = [];
        }

        results[routeId]?.push({
            added_stop_id,
            relative_stop_id: is_before
                ? (values["before_stop_id"]??"")
                : (values["after_stop_id"]??""),
            is_before
        });
    }

    return results;
}

async function markAlertsDeletedIfNotInList(
    alertsDb: pg.Client,
    ids: string[],
    TESTING_fake_today: DateTime|null
) {
    // TODO
}

async function fetchAllRouteIdsAtStopsInDateranges(
    gtfsDb: pg.Client,
    stopIds: string[],
    activePeriods: [number|null, number|null][]
): Promise<string[]> {
    // TODO
    return [];
}

async function fetchUniqueAgenciesForRoutes(
    gtfsDb: pg.Client,
    routeIds: string[]
): Promise<string[]> {
    // TODO
    return [];
}

async function fetchDeparturesForFakeTripIds(
    gtfsDb: pg.Client,
    fakeTripIds: string[]
): Promise<{[fakeTripId: string]: string}> {
    // TODO
    return {};
}
