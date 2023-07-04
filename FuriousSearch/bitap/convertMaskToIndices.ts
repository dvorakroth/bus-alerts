// this file is based on src/search/bitap/convertMaskToIndices.js in Fuse JS
// but ever so slightly simplified and with type annotations added

// see: https://github.com/krisk/Fuse

// the original code was released under the apache2 license but this derivative
// work is released into the public domain; for more details about that, see
// the service-alerts project's LICENSE file

export default function convertMaskToIndices(
    matchmask: (undefined | number)[],
    minMatchCharLength: number
) {
    let indices: [number, number][] = []
    let start = -1
    let end = -1
    let i = 0

    for (let len = matchmask.length; i < len; i += 1) {
        let match = matchmask[i]
        if (match && start === -1) {
            start = i
        } else if (!match && start !== -1) {
            end = i - 1
            if (end - start + 1 >= minMatchCharLength) {
                indices.push([start, end])
            }
            start = -1
        }
    }

    // (i-1 - start) + 1 => i - start
    if (matchmask[i - 1] && i - start >= minMatchCharLength) {
        indices.push([start, i - 1])
    }

    return indices
}
