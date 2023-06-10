import { transit_realtime } from "gtfs-realtime-bindings";
import Long from "long";
import { TranslationObject } from "../dbTypes.js";

export type ArrayOrValue = ArrayOrValue[]|boolean|string|number|null|undefined;

type JsonSimpleValue = string | number | boolean | null;
type JsonArray = (JsonSimpleValue|JsonObject|JsonArray)[];
export type JsonObject = 
    {[k: string]: JsonObject|JsonSimpleValue|JsonArray};

export function arraysDeepEqual(a: ArrayOrValue[], b: ArrayOrValue[]): boolean {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length && i < b.length; i++) {
        const aEl = a[i];
        const bEl = b[i];

        if (typeof aEl !== typeof bEl) {
            return false;
        }

        if (aEl === undefined || bEl === undefined
            || aEl === null || bEl === null
            || typeof aEl === "number" || typeof bEl === "number"
            || typeof aEl === "string" || typeof bEl === "string"
            || typeof aEl === "boolean" || typeof bEl === "boolean") {
            if (aEl !== bEl) {
                return false;
            } else {
                continue;
            }
        }

        if (!arraysDeepEqual(aEl, bEl)) {
            return false;
        }
    }

    return true;
}

export const TIME_FORMAT_ISO_NO_TZ = "yyyy-MM-dd'T'HH:mm:ss.SSS";

export function gtfsRtTranslationsToObject(
    translations: transit_realtime.TranslatedString.ITranslation[]
): TranslationObject {
    const result: any = {};

    for (const {language, text} of translations) {
        if (!language) continue;
        result[language] = replaceUnicodeFails(text);
    }

    return result;
}

const ALLOWED_UNICODE_REPLACEMENTS = {
    ["\\u2013"]: "\u2013",
    ["\\u2019"]: "\u2019"
} as {[key: string]: string};

function replaceUnicodeFails(s: string) {
    // *sigh*

    let i = 0;

    while (i < s.length) {
        i = s.indexOf("\\u", i);

        if (i < 0 || (i + 6) > s.length) {
            break;
        }

        const escSeq = s.substring(i, i + 6);
        const replacement = ALLOWED_UNICODE_REPLACEMENTS[escSeq];

        if (replacement) {
            s = s.substring(0, i) + replacement + s.substring(i + 6);
            i += replacement.length;
        } else {
            i += escSeq.length;
        }
    }

    return s;
}

export function forceToNumberOrNull(value: number|Long|null|undefined) {
    // if you're still using my shitty typescript code in the year 2255
    // (when the 2^53-1 unix epoch problem becomes relevant)
    // then, uh,,,,,,,,,, i hope my generation didn't destroy the planet *too* much lol
    if (typeof value === "number") {
        return value;
    } else if (!value) {
        return null;
    } else {
        return value.toNumber();
    }
}
