import * as React from "react";
import { FuriousSearchMatch } from "../FuriousSearch/furiousindex";
import { Agency } from "./data";
import { imageNameForAgencyId } from "./agency_images";
import { MatchedString, areMatchesEqual } from "./AlertSummary";


interface AgencyTagProps extends Agency {
    matches?: FuriousSearchMatch;
}

export const AgencyTag = React.memo(
    ({ agency_id, agency_name, matches }: AgencyTagProps) => <div className="agency-tag">
        <img src={imageNameForAgencyId(agency_id)} alt="" />
        {!agency_name
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
