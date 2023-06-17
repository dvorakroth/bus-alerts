import * as React from "react";

const DIST_UNKNOWN = "מרחק לא ידוע";
const DIST_METERS = "מ׳ ממך";
const DIST_KILOMETERS = "ק״מ ממך";
function get_distance_string(distance: number|null|undefined) {
    if (distance === null || distance === undefined || distance < 0) {
        return DIST_UNKNOWN;
    } else if (0 <= distance && distance < 1000) {
        return Math.floor(distance) + " " + DIST_METERS;
    } else if (distance >= 1000) {
        return (Math.floor(distance / 100) / 10) + " " + DIST_KILOMETERS;
    }
}

export interface DistanceTagProps {
    distance: number|null|undefined;
}

export const DistanceTag = React.memo(
    ({ distance }: DistanceTagProps) => {
        const hasDistance = (
            distance !== null
            && distance !== undefined
            /*&& distance >= 0*/
        );

        return <span className={"distance-tag" + (hasDistance ? " distance-known" : " distance-unknown")}>
            {get_distance_string(distance)}
        </span>;
    }
);
