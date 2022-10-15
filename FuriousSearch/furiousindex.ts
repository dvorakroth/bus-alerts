// loosely based on fuse index but greatly simplified
// because my needs are extremely specific

import BitapSearch from "./bitap";
import convertMaskToIndices from "./bitap/convertMaskToIndices";
import { SearchResult } from "./bitap/search";

export class FuriousIndex<T> {
    originalObjects: T[];
    keys: FuriousKeyDefinition<T>[];
    totalKeyWeight: number;
    sortCompareFunc: FuriousSortFunc<T>;

    processedObjects: ProcessedObject[];

    constructor(
        objects: T[],
        keys: FuriousKeyDefinition<T>[],
        sortCompareFunc: FuriousSortFunc<T>
    ) {
        this.originalObjects = objects;
        this.keys = keys;
        this.totalKeyWeight = 0;
        this.sortCompareFunc = sortCompareFunc;

        for (const k of keys) {
            this.totalKeyWeight += k.weight || 1;
        }

        this.processedObjects = new Array(objects.length);

        for (let i = 0; i < objects.length; i++) {
            this.processedObjects[i] = {
                index: i,
                data: keys.map(({get}) => get(objects[i]))
            };
        }
    }

    search(patterns: string[], threshold: number, returnExcluded: boolean) {
        const searchers = patterns.map(p => new BitapSearch(p, threshold));
        const numKeys = this.keys.length;

        const result: FuriousSearchResult<T>[] = [];

        for (const obj of this.processedObjects) {
            const matches = new Array<SearchResult[]>(numKeys); // matches[keyIndex][valueIndex || 0]
            const hasMatchByPattern = new Array<boolean>(patterns.length);

            let totalScore = 1;

            for (let keyIndex = 0; keyIndex < numKeys; keyIndex++) {
                const { weight = 1, useExactSearch } = this.keys[keyIndex];
                const relativeWeight = weight / this.totalKeyWeight;
                const valueRaw = obj.data[keyIndex];

                if (!valueRaw) {
                    continue;
                }

                const matchesForKey = (matches[keyIndex] = matches[keyIndex] || []);

                let fieldScore = null;

                const valueList = Array.isArray(valueRaw) ? valueRaw : [valueRaw];
                
                for (let valueIndex = 0; valueIndex < valueList.length; valueIndex++) {
                    const innerValue = valueList[valueIndex];
                    if (!innerValue) {
                        continue;
                    }

                    if (useExactSearch) {
                        for (let patIndex = 0; patIndex < patterns.length; patIndex++) {
                            const pattern = patterns[patIndex];
    
                            if (valueList[valueIndex] === pattern) {
                                fieldScore = 0;
                                hasMatchByPattern[patIndex] = true;
    
                                const matchMask = new Array<undefined | number>(pattern.length);
                                for (let i = 0; i < pattern.length; i++) {
                                    matchMask[i] = 1;
                                }
    
                                matchesForKey[valueIndex] = {
                                    isMatch: true,
                                    score: 0,
                                    matchMask
                                };

                                break; // stop going through more patterns; exact match already found
                            }
                        }
                    } else {
                        for (let patIndex = 0; patIndex < patterns.length; patIndex++) {
                            const newResult = searchers[patIndex].searchIn(valueList[valueIndex]);

                            if (newResult.isMatch) {
                                hasMatchByPattern[patIndex] = true;
                                fieldScore = fieldScore == null ? newResult.score : Math.min(fieldScore, newResult.score);

                                const existingResult = matchesForKey[valueIndex];

                                if (!existingResult) {
                                    matchesForKey[valueIndex] = newResult;
                                } else {
                                    existingResult.score = Math.min(newResult.score, existingResult.score);
                                    for (
                                        let i = 0;
                                        i < Math.max(existingResult.matchMask.length, newResult.matchMask.length);
                                        i++
                                    ) {
                                        existingResult.matchMask[i] |= newResult.matchMask[i] || 0;
                                    }
                                }
                            }
                        }
                    }
                }

                // incorporate fieldScore into totalScore?
                if (fieldScore !== null) {
                    totalScore *= Math.pow(
                        fieldScore === 0 ? Number.EPSILON : fieldScore,
                        relativeWeight
                    )
                }
            }

            // so, did this object match at least SOMETHING against each pattern?
            const allPatternsMatched = patterns.reduce<boolean>((p, _, i) => !!(p && hasMatchByPattern[i]), true);
            if (allPatternsMatched) {
                // yes!
                result.push({
                    furiousSearchResult: true,
                    isMatch: true,
                    idx: obj.index,
                    obj: this.originalObjects[obj.index],
                    score: totalScore,
                    matches: matches.map(matchesForKey =>
                        matchesForKey?.map?.(matchForValue => 
                            matchForValue ? convertMaskToIndices(matchForValue.matchMask, 1) : null
                        )
                    )
                });
            } else if (returnExcluded) {
                result.push({
                    furiousSearchResult: true,
                    isMatch: false,
                    idx: obj.index,
                    obj: this.originalObjects[obj.index],
                    score: Number.MAX_SAFE_INTEGER,
                    matches: null
                });
            }
        }

        if (this.sortCompareFunc) {
            result.sort(this.sortCompareFunc);
        }

        return result;
    }
}

export interface FuriousKeyDefinition<T> {
    get: (obj: T) => (string | string[]);
    weight?: number;
    useExactSearch?: boolean;
}

export interface ProcessedObject {
    index: number;
    data: (string | string[])[];
}

export type FuriousSearchMatch = [number, number][];

export interface FuriousSearchResult<T> {
    furiousSearchResult: true,
    isMatch: boolean
    obj: T;
    idx: number;
    score: number;
    matches: FuriousSearchMatch[][]; // matches[keyIndex][valueIndex || 0]
}

export function isFuriousSearchResult<T>(x: any): x is FuriousSearchResult<T> {
    return !!x["furiousSearchResult"];
}

export type FuriousSortFunc<T> = (a: FuriousSearchResult<T>, b: FuriousSearchResult<T>) => number;