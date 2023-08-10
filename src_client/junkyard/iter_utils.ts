export function *enumerate<T>(a: Iterable<T>): IterableIterator<[number, T]> {
    let i = 0;
    for (const v of a) {
        yield [i++, v];
    }
}
