import * as ReactRouterDOM from 'react-router-dom';
import { FurrySearchMatch } from 'furry-text-search';
import { ServiceAlert } from './protocol';

export type LocationStateAlert = {
    alert?: ServiceAlert,
    showDistance?: boolean,
    matches: FurrySearchMatch[][],
    backToLine?: {
        line_number: string;
        agency_id: string;
        line_pk: string;
    };
} & LocationStateBackground;

export type LocationStateBackground = {
    backgroundLocation?: ReactRouterDOM.Location;
}
