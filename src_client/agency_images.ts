import { JsDict } from "./data";

import agencyUrl_2 from './assets/agency_logos/agency-2.svg';
import agencyUrl_3 from './assets/agency_logos/agency-3.svg';
import agencyUrl_4 from './assets/agency_logos/agency-4.svg';
import agencyUrl_5 from './assets/agency_logos/agency-5.svg';
import agencyUrl_6 from './assets/agency_logos/agency-6.svg';
import agencyUrl_7 from './assets/agency_logos/agency-7.svg';
import agencyUrl_8 from './assets/agency_logos/agency-8.svg';
import agencyUrl_10 from './assets/agency_logos/agency-10.svg';
import agencyUrl_14 from './assets/agency_logos/agency-14.svg';
import agencyUrl_15 from './assets/agency_logos/agency-15.svg';
import agencyUrl_16 from './assets/agency_logos/agency-16.svg';
import agencyUrl_18 from './assets/agency_logos/agency-18.svg';
import agencyUrl_20 from './assets/agency_logos/agency-20.svg';
import agencyUrl_21 from './assets/agency_logos/agency-21.svg';
import agencyUrl_23 from './assets/agency_logos/agency-23.svg';
import agencyUrl_24 from './assets/agency_logos/agency-24.svg';
import agencyUrl_25 from './assets/agency_logos/agency-25.svg';
import agencyUrl_31 from './assets/agency_logos/agency-31.svg';
import agencyUrl_32 from './assets/agency_logos/agency-32.svg';
import agencyUrl_33 from './assets/agency_logos/agency-33.svg';
import agencyUrl_34 from './assets/agency_logos/agency-34.svg';
import agencyUrl_35 from './assets/agency_logos/agency-35.svg';
import agencyUrl_37 from './assets/agency_logos/agency-37.svg';

import taxiUrl from './assets/agency_logos/taxi.svg';

import agencyUrl_42 from './assets/agency_logos/agency-42.png';
import agencyUrl_44 from './assets/agency_logos/agency-44.png';
import agencyUrl_45 from './assets/agency_logos/agency-45.png';
import agencyUrl_50 from './assets/agency_logos/agency-50.png';
import agencyUrl_91 from './assets/agency_logos/agency-91.png';

const AGENCY_LOGOS: JsDict<string> = {
    2: agencyUrl_2,
    3: agencyUrl_3,
    4: agencyUrl_4,
    5: agencyUrl_5,
    6: agencyUrl_6,
    7: agencyUrl_7,
    8: agencyUrl_8,
    10: agencyUrl_10,
    14: agencyUrl_14,
    15: agencyUrl_15,
    16: agencyUrl_16,
    18: agencyUrl_18,
    20: agencyUrl_20,
    21: agencyUrl_21,
    23: agencyUrl_23,
    24: agencyUrl_24,
    25: agencyUrl_25,
    31: agencyUrl_31,
    32: agencyUrl_32,
    33: agencyUrl_33,
    34: agencyUrl_34,
    35: agencyUrl_35,
    37: agencyUrl_37,

    42: agencyUrl_42,
    44: agencyUrl_44,
    45: agencyUrl_45,
    50: agencyUrl_50,
    91: agencyUrl_91,

    47: agencyUrl_42,
    49: agencyUrl_42,
    51: agencyUrl_42,

    92: taxiUrl,
    93: taxiUrl,
    97: taxiUrl,
    98: taxiUrl
};


export function imageNameForAgencyId(agency_id: string) {
    return AGENCY_LOGOS[agency_id];
}

// cursed bonus: first time this script is imported(?), preload all the images
if (!(window as any).AGENCY_LOGOS_PRELOADED) {
    // (window as any).AGENCY_LOGOS_PRELOADED = true;

    const alreadyFound: JsDict<HTMLImageElement> = (window as any).AGENCY_LOGOS_PRELOADED = {};

    for (const k of Object.keys(AGENCY_LOGOS)) {
        const imgPath = AGENCY_LOGOS[k];

        if (alreadyFound[imgPath]) {
            continue;
        }

        alreadyFound[imgPath] = new Image();
        alreadyFound[imgPath].src = imgPath;
    }
}
