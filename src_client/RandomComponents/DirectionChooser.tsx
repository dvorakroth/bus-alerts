import * as React from "react";
import hazardSvg from '../assets/hazard.svg';

const CHOOSE_DIRECTION_LABEL = "בחרו כוון:";
const TOWARDS_LABEL = "ל";
const DIRECTION_NAME_LABEL = "כוון";
const ALTERNATIVE_NAME_LABEL = "חלופה";
const CIRCULAR_LABEL = "מעגלי";

function direction_text(direction: string, is_circular?: boolean, alt_name?: string, dir_name?: string) {
    let result = TOWARDS_LABEL + direction;

    if (dir_name || alt_name || is_circular) {
        const dir_part = dir_name
            ? `${DIRECTION_NAME_LABEL}\u00a0${dir_name}`
            : null;

        const alt_part = alt_name
            ? (
                alt_name == '#'
                    ? ALTERNATIVE_NAME_LABEL
                    : `${ALTERNATIVE_NAME_LABEL}\u00a0${alt_name}`
            )
            : null;

        result += ' (';

        if (is_circular) {
            result += CIRCULAR_LABEL;

            if (dir_part || alt_part) {
                result += ', ';
            }
        }

        if (dir_part) {
            result += dir_part;

            if (alt_part) {
                result += ', ';
            }
        }

        if (alt_part) {
            result += alt_part;
        }

        result += ')';
    }

    return result;
}
interface DirectionChooserDirectionProps {
    direction: string;
    is_circular?: boolean;
    alt_name?: string;
    dir_name?: string;
    has_alerts?: boolean;
    isSelected: boolean;
    index: number;
    onDirectionClick: (index: number, event: React.MouseEvent) => void;
}
const DirectionChooserDirection = React.memo(
    (
        {
            direction, is_circular, alt_name, dir_name, has_alerts, isSelected, onDirectionClick, index
        }: DirectionChooserDirectionProps
    ) => {
        const onClick = (event: React.MouseEvent) => onDirectionClick?.(index, event);
        return <li role="radio"
            aria-selected={isSelected}
            onClick={onClick}
            className={isSelected ? "is-selected" : null}>
            {!has_alerts ? null : <img src={hazardSvg} alt="יש התראות" height="15" />}
            {direction_text(direction, is_circular, alt_name, dir_name)}
        </li>;
    }
);
type DirectionItem =
    ({ to_text: string; } | { headsign: string; }) 
    & {
        is_circular?: boolean,
        alt_name?: string,
        dir_name?: string,
        has_alerts?: boolean
    };

    function extractToTextOrHeadsign(d: DirectionItem): string {
    return (d as any).to_text || (d as any).headsign;
}
interface DirectionChooserProps {
    changes_for_line: DirectionItem[];
    selectedIndex: number;
    onNewSelection: (index: number, event: React.MouseEvent) => void;
    hideCaption?: boolean;
}
export default function DirectionChooser({ changes_for_line, onNewSelection, selectedIndex, hideCaption }: DirectionChooserProps) {
    const onDirectionClick = React.useCallback(
        (index: number, event: React.MouseEvent) => {
            // setSelection(index);
            onNewSelection(index, event);
        },
        [onNewSelection]
    );

    return <div className="direction-chooser-wrapper" role="radiogroup" aria-labelledby="choose-direction-label">
        <h2 id="choose-direction-label" style={hideCaption ? {display: 'none'} : null}>{CHOOSE_DIRECTION_LABEL}</h2>
        <ul className="direction-chooser">
            {changes_for_line?.map?.((change, idx) => <DirectionChooserDirection key={idx}
                direction={extractToTextOrHeadsign(change)}
                is_circular={change.is_circular}
                alt_name={change.alt_name}
                dir_name={change.dir_name}
                isSelected={idx === selectedIndex}
                index={idx}
                onDirectionClick={onDirectionClick}
                has_alerts={change.has_alerts} />
            )}
            {changes_for_line?.length
                ? null
                : <DirectionChooserDirection direction=""
                    isSelected={false}
                    index={0}
                    onDirectionClick={null} />}
        </ul>
    </div>;
}
