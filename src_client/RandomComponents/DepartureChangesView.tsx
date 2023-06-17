import * as React from "react";
import { AddedRemovedDepartures } from "../protocol";
import { groupDepartureTimesByHour } from "../AlertViews/SingleAlertView";

interface DepartureChangesViewProps {
    departure_change: AddedRemovedDepartures;
}

export function DepartureChangesView({ departure_change: { added_hours, removed_hours } }: DepartureChangesViewProps) {
    // added_hours = removed_hours; // TESTING
    return <>
        {added_hours?.length ? <h2>נסיעות חדשות:</h2> : null}
        <ul className="departure-time-groups departure-time-groups-added">
            {groupDepartureTimesByHour(added_hours)}
        </ul>

        {removed_hours?.length ? <h2>נסיעות מבוטלות:</h2> : null}
        <ul className="departure-time-groups departure-time-groups-removed">
            {groupDepartureTimesByHour(removed_hours)}
        </ul>
    </>;
}
