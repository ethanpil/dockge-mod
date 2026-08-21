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

    // Goes up at each invalidate. A call that started before the change
    // does not put its result in the cache.
    private generation = 0;

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

        const generation = this.generation;
        // A failure does not stay in the cache. The next call runs the
        // function again.
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
     * Remove the result. The next call runs the function again, also
     * when a call from before the change still runs. That call serves
     * its own callers, but its result does not go in the cache.
     */
    invalidate() {
        this.generation++;
        this.value = undefined;
        this.pending = null;
    }
}
