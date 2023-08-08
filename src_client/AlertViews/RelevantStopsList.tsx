import * as React from "react";
import { FurrySearchMatch } from "furry-text-search";
import { MatchedString, areMatchListsEqual } from "./AlertSummary";
import clsx from "clsx";

const MAX_STOPS_IN_LIST = 7; // chosen arbitrarily sunglasses emoji

const REMOVED_STOPS_LABEL = "תחנות מבוטלות:";
const ADDED_STOPS_LABEL   = "תחנות חדשות:";

interface RelevantStopsListProps {
    relevant_stops: [string, string][];
    isRemoved: boolean;
    stopNameMatches?: FurrySearchMatch[];
    stopCodeMatches?: FurrySearchMatch[];
    //dontHideStops?: boolean;
    isInteractive?: boolean;
}

export const RelevantStopsList = React.memo(
    (
        {
            relevant_stops,
            isRemoved,
            stopNameMatches,
            stopCodeMatches,
            //dontHideStops,
            isInteractive
        }: RelevantStopsListProps
    ) => {
        const [isOpen, setIsOpen] = React.useState(false);
        const isActuallyOpen = isInteractive && isOpen;

        const shownStops = [];
        let hiddenStopCount = 0;

        for (let i = 0; i < relevant_stops.length; i++) {
            const stop = relevant_stops[i];
            if (!stop)
                continue;

            const nameMatches = stopNameMatches?.[i];
            const codeMatches = stopCodeMatches?.[i];

            if (isActuallyOpen /*|| dontHideStops*/ || i < MAX_STOPS_IN_LIST || nameMatches?.length || codeMatches?.length) {
                shownStops.push({ stop, nameMatches, codeMatches });
            } else {
                hiddenStopCount += 1;
            }
        }

        const toggleOpen = React.useCallback(
            () => {
                if (isInteractive) {
                    setIsOpen(!isOpen)
                }
            },
            [isOpen, isInteractive, setIsOpen]
        );

        return (relevant_stops.length > 0)
            ? <>
                <h2>{isRemoved ? REMOVED_STOPS_LABEL : ADDED_STOPS_LABEL}</h2>
                <ul className="relevant-stops">
                    {shownStops.map(
                        ({ stop: [stop_code, stop_name], nameMatches, codeMatches }) => <li key={stop_code}>
                            <MatchedString s={stop_code} matches={codeMatches} />
                            &nbsp;-&nbsp;
                            <MatchedString s={stop_name} matches={nameMatches} />
                        </li>
                    )}
                    {!isInteractive
                        ? (!hiddenStopCount ? null
                            : <li className="hidden-count">
                                {hiddenStopCount === 1
                                    ? `(ועוד תחנה 1 נוספת...)`
                                    : `(ועוד ${hiddenStopCount} תחנות נוספות...)`}
                            </li>)
                        : null}
                    
                    {(isInteractive && (hiddenStopCount || isActuallyOpen))
                        ? (<li className={clsx("hidden-count", "interactive", {"is-open": isActuallyOpen})}>
                            <span className="fake-link" role="button" onClick={toggleOpen}>
                                {isActuallyOpen
                                    ? `צמצום הרשימה`
                                    : hiddenStopCount === 1
                                    ? `תחנה 1 נוספת...`
                                    : `${hiddenStopCount} תחנות נוספות...`
                                }
                            </span>
                        </li>)
                        : null}
                    
                </ul>
            </>
            : null;
    },
    (oldProps, newProps) => {
        if (oldProps.isRemoved !== newProps.isRemoved) {
            return false;
        }

        if (oldProps.relevant_stops !== newProps.relevant_stops) {
            return false;
        }

        if (!areMatchListsEqual(oldProps.stopCodeMatches, newProps.stopCodeMatches)) {
            return false;
        }

        if (!areMatchListsEqual(oldProps.stopNameMatches, newProps.stopNameMatches)) {
            return false;
        }

        return true;
    }
);
