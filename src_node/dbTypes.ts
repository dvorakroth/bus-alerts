export enum AlertUseCase {
    National = 1,
    Agency = 2,
    Region = 3,
    Cities = 4,
    StopsCancelled = 5,
    RouteChangesFlex = 6, // "stop-on-route"
    RouteChangesSimple = 7, // "routes-at-stop"
    ScheduleChanges = 8 // "trips-of-route"

    // i think the names i made up are better than the terrible mot ones
}