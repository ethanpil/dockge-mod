/**
 * Shares one in-flight call and caches its result for `ttl` ms (or until
 * invalidate()). Keeps the number of docker processes flat when many
 * clients poll at once.
 */
export class CachedCall<T> {

    private fn : () => Promise<T>;
    private ttl : number;
    private value? : { time : number, data : T };
    private pending : Promise<T> | null = null;

    // Bumped by invalidate(), so a call started earlier does not cache its result.
    private generation = 0;

    /**
     * @param fn Produces the result
     * @param ttl Cache lifetime in milliseconds
     */
    constructor(fn : () => Promise<T>, ttl : number) {
        this.fn = fn;
        this.ttl = ttl;
    }

    /**
     * Get the cached result, join the in-flight call, or start a new one.
     * @returns The result
     */
    get() : Promise<T> {
        if (this.value && Date.now() - this.value.time < this.ttl) {
            return Promise.resolve(this.value.data);
        }
        if (this.pending) {
            return this.pending;
        }

        const generation = this.generation;
        // Failures are not cached.
        const call = this.fn().then((data) => {
            if (generation === this.generation) {
                this.value = {
                    time: Date.now(),
                    data,
                };
            }
            return data;
        }).finally(() => {
            if (this.pending === call) {
                this.pending = null;
            }
        });
        this.pending = call;
        return call;
    }

    /**
     * Drop the cached result. The next get() starts a fresh call even if an
     * older one is still running; that older call still answers its own
     * callers but does not fill the cache.
     */
    invalidate() {
        this.generation++;
        this.value = undefined;
        this.pending = null;
    }
}
