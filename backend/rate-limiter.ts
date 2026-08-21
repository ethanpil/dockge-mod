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
 * One rate limiter for each key, for example for each client address.
 * One client cannot use the tokens of the other clients.
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
     * @param key The client key, for example the address
     * @param callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(key : string, callback : KumaRateLimiterCallback, num = 1) {
        const now = Date.now();

        // Remove the limiters that had no use for ten minutes. A check
        // at each call is cheap, because the map is small.
        if (this.limiters.size > 100) {
            for (const [ k, entry ] of this.limiters) {
                if (now - entry.lastUse > 10 * 60 * 1000) {
                    this.limiters.delete(k);
                }
            }
        }

        let entry = this.limiters.get(key);
        if (!entry) {
            entry = {
                limiter: new KumaRateLimiter(this.config),
                lastUse: now,
            };
            this.limiters.set(key, entry);
        }
        entry.lastUse = now;
        return entry.limiter.pass(callback, num);
    }
}

/**
 * The login limiter counts for each client address. One address cannot
 * lock out the other addresses.
 */
export const loginRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 20,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

export const apiRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 60,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

export const twoFaRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 30,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});
