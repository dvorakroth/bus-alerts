import { MAX_BITS } from './constants'

export default function search(
  text: string,
  pattern: string,
  patternAlphabet: {[char: string]: number},
  threshold: number
): SearchResult {
  const ignoreLocation = true;

  if (pattern.length > MAX_BITS) {
    throw "too many bits in pattern: " + pattern;
  }

  const patternLen = pattern.length
  const textLen = text.length
  let currentThreshold = threshold;
  let bestLocation = 0;

  // A mask of the matches, used for building the indices
  const matchMask: (undefined | number)[] = new Array(textLen);

  let index: number;

  // Get all exact matches, here for speed up
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    currentThreshold = Math.min(0, currentThreshold)
    bestLocation = index + patternLen

    for (let i = 0; i < patternLen; i++) {
      matchMask[index + i] = 1;
    }
  }

  // Reset the best location
  bestLocation = -1

  let lastBitArr = []
  let finalScore = 1

  const mask = 1 << (patternLen - 1)

  for (let i = 0; i < patternLen; i += 1) {
    // Scan for the best match; each iteration allows for one more error.
    // Run a binary search to determine how far from the match location we can stray
    // at this error level.

    let start = 0;
    let finish = textLen;

    // Initialize the bit array
    let bitArr = Array(finish + 2);

    bitArr[finish + 1] = (1 << i) - 1

    for (let j = finish; j >= start; j -= 1) {
      let currentLocation = j - 1
      let charMatch = patternAlphabet[text.charAt(currentLocation)]

      // First pass: exact match
      bitArr[j] = ((bitArr[j + 1] << 1) | 1) & charMatch

      // Subsequent passes: fuzzy match
      if (i) {
        bitArr[j] |=
          ((lastBitArr[j + 1] | lastBitArr[j]) << 1) | 1 | lastBitArr[j + 1]
      }

      if (bitArr[j] & mask) {
        // Speed up: quick bool to int conversion (i.e, `charMatch ? 1 : 0`)
        matchMask[currentLocation] = +!!charMatch

        if (i) {
          for (let k = 1; bitArr[currentLocation + k] > 3; k++) {
            matchMask[currentLocation + k] = 1;
          }
        }

        finalScore = i / pattern.length; // num of errors, divided by length of search string

        // This match will almost certainly be better than any existing match.
        // But check anyway.
        if (finalScore <= currentThreshold) {
          // Indeed it is
          currentThreshold = finalScore
          bestLocation = currentLocation
        }
      }
    }

    // No hope for a (better) match at greater error levels.
    if ((i + 1) / pattern.length > currentThreshold) {
      break
    }

    lastBitArr = bitArr
  }

  finalScore = Math.max(0.001, finalScore);

  // const indices = convertMaskToIndices(matchMask, 1)
  const isMatch = (bestLocation >= 0);// && (indices.length >= 0);
  return {
      isMatch,
      // Count exact matches (those with a score of 0) to be "almost" exact
      score: finalScore,
      matchMask
    }
}

export type SearchResult = {
  isMatch: boolean;
  score: number;
  matchMask: (undefined | number)[] | undefined;
};