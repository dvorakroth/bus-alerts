import * as React from "react";
import { FurrySearchMatch } from "furry-text-search";
import { Agency } from "../protocol";
import { imageNameForAgencyId } from "../agency_images";
import { MatchedString, areMatchesEqual } from "../AlertViews/AlertSummary";
import nightLinesPng from "../assets/agency_logos/night_lines.png";

interface AgencyTagProps extends Agency {
    matches?: FurrySearchMatch;
    is_night_line?: boolean;
    hideName?: boolean;
}

export const AgencyTag = React.memo(
    ({ agency_id, agency_name, matches, is_night_line, hideName }: AgencyTagProps) => <div className="agency-tag">
        {!is_night_line ? null
            : <img
                className="night-line"
                src={nightLinesPng}
                alt="קו לילה"
                title="קו לילה"
            />}
        <img
            src={imageNameForAgencyId(agency_id)}
            alt={!hideName ? undefined : (agency_name || undefined)}
            title={!hideName ? undefined : (agency_name || undefined)}
        />
        {!agency_name || hideName
            ? null
            : <span><MatchedString s={agency_name} matches={matches} /></span>
        }
    </div>,
    (prevProps, newProps) => {
        if (prevProps.agency_id !== newProps.agency_id) {
            return false;
        }

        if (prevProps.agency_name !== newProps.agency_name) {
            return false;
        }

        if (!areMatchesEqual(prevProps.matches, newProps.matches)) {
            return false;
        }

        return true;
    }
);
