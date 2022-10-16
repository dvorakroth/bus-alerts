import * as React from "react";
import { FuriousSearchMatch } from "../../FuriousSearch/furiousindex";
import { Agency } from "../data";
import { imageNameForAgencyId } from "../agency_images";
import { MatchedString, areMatchesEqual } from "../AlertViews/AlertSummary";
import nightLinesPng from "../assets/agency_logos/night_lines.png";

interface AgencyTagProps extends Agency {
    matches?: FuriousSearchMatch;
    is_night_line?: boolean;
    hideName?: boolean;
}

export const AgencyTag = React.memo(
    ({ agency_id, agency_name, matches, is_night_line, hideName }: AgencyTagProps) => <div className="agency-tag">
        {!is_night_line ? null : <img className="night-line" src={nightLinesPng} alt="קו לילה" />}
        <img src={imageNameForAgencyId(agency_id)} alt={hideName && agency_name || ""} />
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
