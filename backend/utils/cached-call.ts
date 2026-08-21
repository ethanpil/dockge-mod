/**
 * One result for many callers. A call that runs serves each caller that
 * comes while it runs. A result stays good for a time, or until a call
 * of invalidate(). This keeps the number of docker processes flat when
 * many clients poll at the same time.
 */
export class CachedCall<T> {

    private fn : () => Promise<T>;
    private ttl : number;
    private value? : { time : number, data : T };
    private pending : Promise<T> | null = null;

    /**
     * @param fn The function that makes the result
     * @param ttl How long a result stays good, in milliseconds
     */
    constructor(fn : () => Promise<T>, ttl : number) {
        this.fn = fn;
        this.ttl = ttl;
    }

    /**
     * Get the result. A good result comes from the cache. A call that
     * runs serves this caller too.
     * @returns The result
     */
    get() : Promise<T> {
        if (this.value && Date.now() - this.value.time < this.ttl) {
            return Promise.resolve(this.value.data);
        }
        if (this.pending) {
            return this.pending;
        }
        // A failure does not stay in the cache. The next call runs the
        // function again.
        this.pending = this.fn().then((data) => {
            this.value = {
                time: Date.now(),
                data,
            };
            return data;
        }).finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    /**
     * Remove the result. The next call runs the function. A call that
     * runs now completes and serves its callers, but its result does
     * not go in the cache.
     */
    invalidate() {
        this.value = undefined;
        if (this.pending) {
            const stale = this.pending;
            // The result of the stale call must not go in the cache
            stale.then(() => {
                if (this.value && this.value.data !== undefined && this.pending === null) {
                    // The then-handler of get() ran before this one, and
                    // it put the stale result in the cache
                    this.value = undefined;
                }
            }, () => undefined);
        }
    }
}
