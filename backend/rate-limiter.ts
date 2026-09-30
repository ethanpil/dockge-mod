// "limit" is bugged in Typescript, use "limiter-es6-compat" instead
// See https://github.com/jhurliman/node-rate-limiter/issues/80
import { RateLimiter, RateLimiterOpts } from "limiter-es6-compat";
import { log } from "./log";

export interface KumaRateLimiterOpts extends RateLimiterOpts {
    errorMessage : string;
}

export type KumaRateLimiterCallback = (err : object) => void;

class KumaRateLimiter {

    errorMessage : string;
    rateLimiter : RateLimiter;

    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config : KumaRateLimiterOpts) {
        this.errorMessage = config.errorMessage;
        this.rateLimiter = new RateLimiter(config);
    }

    /**
     * Callback for pass
     * @callback passCB
     * @param {object} err Too many requests
     */

    /**
     * Should the request be passed through
     * @param callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(callback : KumaRateLimiterCallback, num = 1) {
        const remainingRequests = await this.removeTokens(num);
        log.info("rate-limit", "remaining requests: " + remainingRequests);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(num = 1) {
        return await this.rateLimiter.removeTokens(num);
    }
}

/**
 * A separate rate limiter per key (e.g. client address), so one client
 * cannot use up the tokens of others.
 */
export class KeyedRateLimiter {

    config : KumaRateLimiterOpts;
    limiters : Map<string, { limiter : KumaRateLimiter, lastUse : number }> = new Map();

    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config : KumaRateLimiterOpts) {
        this.config = config;
    }

    /**
     * Should the request be passed through
     * @param key The client key, e.g. the address
     * @param callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} True if the request is allowed
     */
    async pass(key : string, callback : KumaRateLimiterCallback, num = 1) {
        const now = Date.now();

        let entry = this.limiters.get(key);
        if (!entry) {
            this.prune(now);
            entry = {
                limiter: new KumaRateLimiter(this.config),
                lastUse: now,
            };
            this.limiters.set(key, entry);
        }
        entry.lastUse = now;
        return entry.limiter.pass(callback, num);
    }

    /**
     * Drop limiters unused for ten minutes, then the least recently used
     * ones, so a client that spoofs addresses cannot grow the map forever.
     * @param now The current time
     */
    private prune(now : number) {
        if (this.limiters.size < KeyedRateLimiter.MAX_KEYS) {
            return;
        }
        for (const [ k, entry ] of this.limiters) {
            if (now - entry.lastUse > 10 * 60 * 1000) {
                this.limiters.delete(k);
            }
        }
        if (this.limiters.size >= KeyedRateLimiter.MAX_KEYS) {
            const entries = [ ...this.limiters.entries() ].sort((a, b) => a[1].lastUse - b[1].lastUse);
            for (const [ k ] of entries) {
                if (this.limiters.size < KeyedRateLimiter.MAX_KEYS) {
                    break;
                }
                this.limiters.delete(k);
            }
        }
    }

    static readonly MAX_KEYS = 1000;
}

/** Per-address login limit, so one address cannot lock out the others. */
export const loginRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 20,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

/** Global login limit, which still applies to a client that rotates addresses. */
export const loginGlobalRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 100,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

/** Per-address setup limit, separate from the login limit. */
export const setupRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 10,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});
