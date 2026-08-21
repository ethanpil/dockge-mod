/*
 * Common utilities for backend and frontend
 */
import yaml, { Document, Pair, Scalar } from "yaml";
import { DotenvParseOutput } from "dotenv";

// Init dayjs
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
// @ts-ignore
import { replaceVariablesSync } from "@inventage/envsubst";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

export interface LooseObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
}

export interface BaseRes {
    ok: boolean;
    msg?: string;
}

let randomBytes : (numBytes: number) => Uint8Array;
initRandomBytes();

async function initRandomBytes() {
    if (typeof window !== "undefined" && window.crypto) {
        randomBytes = function randomBytes(numBytes: number) {
            const bytes = new Uint8Array(numBytes);
            for (let i = 0; i < numBytes; i += 65536) {
                window.crypto.getRandomValues(bytes.subarray(i, i + Math.min(numBytes - i, 65536)));
            }
            return bytes;
        };
    } else {
        randomBytes = (await import("node:crypto")).randomBytes;
    }
}

export const ALL_ENDPOINTS = "##ALL_DOCKGE_ENDPOINTS##";

// Stack Status
export const UNKNOWN = 0;
export const CREATED_FILE = 1;
export const CREATED_STACK = 2;
export const RUNNING = 3;
export const EXITED = 4;

export function statusName(status : number) : string {
    switch (status) {
        case CREATED_FILE:
            return "draft";
        case CREATED_STACK:
            return "created_stack";
        case RUNNING:
            return "running";
        case EXITED:
            return "exited";
        default:
            return "unknown";
    }
}

export function statusNameShort(status : number) : string {
    switch (status) {
        case CREATED_FILE:
            return "inactive";
        case CREATED_STACK:
            return "inactive";
        case RUNNING:
            return "active";
        case EXITED:
            return "exited";
        default:
            return "?";
    }
}

export function statusColor(status : number) : string {
    switch (status) {
        case CREATED_FILE:
            return "dark";
        case CREATED_STACK:
            return "dark";
        case RUNNING:
            return "primary";
        case EXITED:
            return "danger";
        default:
            return "secondary";
    }
}

// The time between the status polls of a stack page, in seconds. The
// server answers most polls from a cache, thus the time is not a setting.
export const POLL_INTERVAL_DEFAULT = 5;

export const isDev = process.env.NODE_ENV === "development";
export const TERMINAL_COLS = 105;
export const TERMINAL_ROWS = 10;
export const PROGRESS_TERMINAL_ROWS = 8;

export const COMBINED_TERMINAL_COLS = 58;
export const COMBINED_TERMINAL_ROWS = 20;

export const ERROR_TYPE_VALIDATION = 1;

export const acceptedComposeFileNames = [
    "compose.yaml",
    "docker-compose.yaml",
    "docker-compose.yml",
    "compose.yml",
];

/**
 * The names of the override file, in the sequence that docker uses. Docker
 * uses the first file that it finds. The name of the base compose file has
 * no effect on this sequence.
 */
export const acceptedComposeOverrideFileNames = [
    "compose.override.yml",
    "compose.override.yaml",
    "docker-compose.override.yml",
    "docker-compose.override.yaml",
];

/**
 * The content of a new override file, when the settings hold no other text.
 * Docker accepts a file that holds only comments, thus the template needs no
 * empty map.
 */
export const defaultComposeOverrideTemplate = `# This file merges with the compose file of the stack.
# Put your changes here. An update of the base file keeps them.
#
# Example:
#
# services:
#   web:
#     environment:
#       - EXAMPLE=1
`;

/**
 * Make the name of a new override file from the name of the base file.
 * Docker accepts each of the accepted names, but a name that agrees with
 * the base file is more clear to the user.
 * @param composeFileName Name of the base compose file
 * @returns Name for a new override file
 */
export function defaultComposeOverrideFileName(composeFileName : string) : string {
    const dot = composeFileName.lastIndexOf(".");
    if (dot <= 0) {
        return "compose.override.yaml";
    }
    return composeFileName.slice(0, dot) + ".override" + composeFileName.slice(dot);
}

/**
 * Generate a decimal integer number from a string
 * @param str Input
 * @param length Default is 10 which means 0 - 9
 */
export function intHash(str : string, length = 10) : number {
    // A simple hashing function (you can use more complex hash functions if needed)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash += str.charCodeAt(i);
    }
    // Normalize the hash to the range [0, 10]
    return (hash % length + length) % length; // Ensure the result is non-negative
}

/**
 * Delays for specified number of seconds
 * @param ms Number of milliseconds to sleep for
 */
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random alphanumeric string of fixed length
 * @param length Length of string to generate
 * @returns string
 */
export function genSecret(length = 64) {
    let secret = "";
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charsLength = chars.length;
    for ( let i = 0; i < length; i++ ) {
        secret += chars.charAt(getCryptoRandomInt(0, charsLength - 1));
    }
    return secret;
}

/**
 * Get a random integer suitable for use in cryptography between upper
 * and lower bounds.
 * @param min Minimum value of integer
 * @param max Maximum value of integer
 * @returns Cryptographically suitable random integer
 */
export function getCryptoRandomInt(min: number, max: number):number {
    // synchronous version of: https://github.com/joepie91/node-random-number-csprng

    const range = max - min;
    if (range >= Math.pow(2, 32)) {
        console.log("Warning! Range is too large.");
    }

    let tmpRange = range;
    let bitsNeeded = 0;
    let bytesNeeded = 0;
    let mask = 1;

    while (tmpRange > 0) {
        if (bitsNeeded % 8 === 0) {
            bytesNeeded += 1;
        }
        bitsNeeded += 1;
        mask = mask << 1 | 1;
        tmpRange = tmpRange >>> 1;
    }

    const bytes = randomBytes(bytesNeeded);
    let randomValue = 0;

    for (let i = 0; i < bytesNeeded; i++) {
        randomValue |= bytes[i] << 8 * i;
    }

    randomValue = randomValue & mask;

    if (randomValue <= range) {
        return min + randomValue;
    } else {
        return getCryptoRandomInt(min, max);
    }
}

/**
 * True when a service name can go to docker compose as an argument. A
 * name that starts with a dash is an option, not a name. Docker accepts
 * letters, digits, and the characters _ . - in a service name.
 * @param name The service name from the client
 * @returns True when the name is safe as an argument
 */
export function isComposeServiceName(name : string) : boolean {
    return /^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/.test(name);
}

/**
 * True when a shell name can go to docker compose exec as an argument.
 * A path such as /bin/bash is correct. An option or a space is not.
 * @param shell The shell from the client
 * @returns True when the shell is safe as an argument
 */
export function isShellName(shell : string) : boolean {
    return /^[a-zA-Z0-9_/][a-zA-Z0-9_./-]*$/.test(shell);
}

export function getComposeTerminalName(endpoint : string, stack : string) {
    return "compose-" + endpoint + "-" + stack;
}

export function getCombinedTerminalName(endpoint : string, stack : string) {
    return "combined-" + endpoint + "-" + stack;
}

export function getContainerTerminalName(endpoint : string, container : string) {
    return "container-" + endpoint + "-" + container;
}

export function getContainerExecTerminalName(endpoint : string, stackName : string, container : string, index : number) {
    return "container-exec-" + endpoint + "-" + stackName + "-" + container + "-" + index;
}

export function copyYAMLComments(doc : Document, src : Document) {
    doc.comment = src.comment;
    doc.commentBefore = src.commentBefore;

    if (doc && doc.contents && src && src.contents) {
        // @ts-ignore
        copyYAMLCommentsItems(doc.contents.items, src.contents.items);
    }
}

/**
 * Copy yaml comments from srcItems to items
 * Attempts to preserve comments by matching content rather than just array indices
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function copyYAMLCommentsItems(items: any, srcItems: any) {
    if (!items || !srcItems) {
        return;
    }

    // First pass - try to match items by their content
    for (let i = 0; i < items.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item: any = items[i];

        // Try to find matching source item by content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const srcIndex = srcItems.findIndex((srcItem: any) =>
            JSON.stringify(srcItem.value) === JSON.stringify(item.value) &&
            JSON.stringify(srcItem.key) === JSON.stringify(item.key)
        );

        if (srcIndex !== -1) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const srcItem: any = srcItems[srcIndex];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nextSrcItem: any = srcItems[srcIndex + 1];

            if (item.key && srcItem.key) {
                item.key.comment = srcItem.key.comment;
                item.key.commentBefore = srcItem.key.commentBefore;
            }

            if (srcItem.comment) {
                item.comment = srcItem.comment;
            }

            // Handle comments between array items
            if (nextSrcItem && nextSrcItem.commentBefore) {
                if (items[i + 1]) {
                    items[i + 1].commentBefore = nextSrcItem.commentBefore;
                }
            }

            // Handle trailing comments after array items
            if (srcItem.value && srcItem.value.comment) {
                if (item.value) {
                    item.value.comment = srcItem.value.comment;
                }
            }

            if (item.value && srcItem.value) {
                if (typeof item.value === "object" && typeof srcItem.value === "object") {
                    item.value.comment = srcItem.value.comment;
                    item.value.commentBefore = srcItem.value.commentBefore;

                    if (item.value.items && srcItem.value.items) {
                        copyYAMLCommentsItems(item.value.items, srcItem.value.items);
                    }
                }
            }
        }
    }
}

/**
 * Possible Inputs:
 * ports:
 *   - "3000"
 *   - "3000-3005"
 *   - "8000:8000"
 *   - "9090-9091:8080-8081"
 *   - "49100:22"
 *   - "8000-9000:80"
 *   - "127.0.0.1:8001:8001"
 *   - "127.0.0.1:5000-5010:5000-5010"
 *   - "0.0.0.0:8080->8080/tcp"
 *   - "6060:6060/udp"
 * @param input
 * @param hostname
 */
export function parseDockerPort(input : string, hostname : string) {
    let port;
    let display;

    const parts = input.split("/");
    let part1 = parts[0];
    let protocol = parts[1] || "tcp";

    // coming from docker ps, split host part
    const arrow = part1.indexOf("->");
    if (arrow >= 0) {
        part1 = part1.split("->")[0];
        const colon = part1.indexOf(":");
        if (colon >= 0) {
            part1 = part1.split(":")[1];
        }
    }

    // Split the last ":"
    const lastColon = part1.lastIndexOf(":");

    if (lastColon === -1) {
        // No colon, so it's just a port or port range
        // Check if it's a port range
        const dash = part1.indexOf("-");
        if (dash === -1) {
            // No dash, so it's just a port
            port = part1;
        } else {
            // Has dash, so it's a port range, use the first port
            port = part1.substring(0, dash);
        }

        display = part1;

    } else {
        // Has colon, so it's a port mapping
        let hostPart = part1.substring(0, lastColon);
        display = hostPart;

        // Check if it's a port range
        const dash = part1.indexOf("-");

        if (dash !== -1) {
            // Has dash, so it's a port range, use the first port
            hostPart = part1.substring(0, dash);
        }

        // Check if it has a ip (ip:port)
        const colon = hostPart.indexOf(":");

        if (colon !== -1) {
            // Has colon, so it's a ip:port
            hostname = hostPart.substring(0, colon);
            port = hostPart.substring(colon + 1);
        } else {
            // No colon, so it's just a port
            port = hostPart;
        }
    }

    let portInt = parseInt(port);

    if (portInt == 443) {
        protocol = "https";
    } else if (protocol === "tcp") {
        protocol = "http";
    }

    return {
        url: protocol + "://" + hostname + ":" + portInt,
        display: display,
    };
}

export function envsubst(string : string, variables : LooseObject) : string {
    return replaceVariablesSync(string, variables)[0];
}

/**
 * Traverse all values in the yaml and for each value, if there are template variables, replace it environment variables
 * Emulates the behavior of how docker-compose handles environment variables in yaml files
 * @param content Yaml string
 * @param env Environment variables
 * @returns string Yaml string with environment variables replaced
 */
export function envsubstYAML(content : string, env : DotenvParseOutput) : string {
    const doc = yaml.parseDocument(content);

    // A document with an error cannot go to toString. Without this, the
    // caller gets a different, less clear error, or a text that hides the
    // problem of the raw content.
    if (doc.errors.length > 0) {
        throw doc.errors[0];
    }

    if (doc.contents) {
        // @ts-ignore
        for (const item of doc.contents.items) {
            traverseYAML(item, env);
        }
    }
    return doc.toString();
}

/**
 * Used for envsubstYAML(...)
 * @param pair
 * @param env
 */
function traverseYAML(pair : Pair, env : DotenvParseOutput) : void {
    // @ts-ignore
    if (pair.value && pair.value.items) {
        // @ts-ignore
        for (const item of pair.value.items) {
            if (item instanceof Pair) {
                traverseYAML(item, env);
            } else if (item instanceof Scalar) {
                let value = item.value as unknown;

                if (typeof(value) === "string") {
                    item.value = envsubst(value, env);
                }
            }
        }
    // @ts-ignore
    } else if (pair.value && typeof(pair.value.value) === "string") {
        // @ts-ignore
        pair.value.value = envsubst(pair.value.value, env);
    }
}

/**
 * Convert docker's human readable container status ("Up 55 minutes (healthy)",
 * "Up 3 days", "Up About an hour") into the fixed "0d 0h 55m" form.
 * Docker only reports one coarse unit, so the other two positions are zero.
 * @param {string} status Status column of `docker compose ps`
 * @returns {string|null} Shorthand uptime, or null when the container is not up
 */
export function formatUptime(status : string) : string | null {
    if (!status || !status.startsWith("Up")) {
        return null;
    }

    // "Up 55 minutes (healthy)" -> "55 minutes"
    const body = status.replace(/^Up\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();

    const m = body.match(/^(About\s+an?|Less\s+than\s+an?|\d+)\s+(second|minute|hour|day|week|month|year)s?$/i);
    if (!m) {
        // Unrecognised phrasing: better no value than a fabricated "0d 0h 0m"
        return null;
    }

    const n = /^\d+$/.test(m[1]) ? parseInt(m[1]) : (/^Less/i.test(m[1]) ? 0 : 1);
    const unit = m[2].toLowerCase();
    const perUnit : Record<string, number> = {
        second: 0,
        minute: 1,
        hour: 60,
        day: 1440,
        week: 10080,
        month: 43200,
        year: 525600,
    };
    const minutes = n * (perUnit[unit] ?? 0);

    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const min = minutes % 60;
    return `${d}d ${h}h ${min}m`;
}

/**
 * Compact docker's Ports column by dropping the WILDCARD published host
 * ("0.0.0.0:", "[::]:", ":::", "*:") and deduplicating the IPv4/IPv6 twins
 * that stripping produces. A specific bind address (127.0.0.1, a LAN IP) is
 * meaningful — the user restricted the port on purpose — so it is kept.
 * @param {string} ports Ports column of `docker compose ps`
 * @returns {string} the short form, for example "18080->80/tcp"
 */
export function formatPorts(ports : string) : string {
    if (!ports) {
        return "";
    }
    const seen = new Set<string>();
    for (const part of ports.split(",")) {
        // ":::8080" is docker's bracket-less IPv6 wildcard form
        const cleaned = part.trim().replace(/^(0\.0\.0\.0:|\[::\]:|:::|\*:)/, "");
        if (cleaned) {
            seen.add(cleaned);
        }
    }
    return [ ...seen ].join(", ");
}

/**
 * Format a byte count for display. For example, 2147483648 gives "2.0 GiB".
 * @param {number} bytes Byte count
 * @returns {string} Human readable size
 */
export function formatBytes(bytes : number) : string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "-";
    }
    const units = [ "B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB" ];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    // 1023.6 would otherwise round up to a nonsensical "1024 B"
    if (Number(v.toFixed(v >= 100 || i === 0 ? 0 : 1)) >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Parse docker's human readable sizes to bytes. Docker usually prints decimal
 * units ("1.53GB"), but some builds emit IEC units ("1.5GiB") — both parse.
 * @param {string} size Size string from docker
 * @returns {number} Byte count, 0 when unparsable
 */
export function parseDockerSize(size : string) : number {
    const m = (size ?? "").trim().match(/^([\d.]+)\s*([kKmMgGtT]?)(i)?B?$/);
    if (!m) {
        return 0;
    }
    const base = m[3] ? 1024 : 1000;
    const exp : Record<string, number> = { "": 0,
        k: 1,
        m: 2,
        g: 3,
        t: 4 };
    return parseFloat(m[1]) * Math.pow(base, exp[m[2].toLowerCase()] ?? 0);
}

/**
 * Tell if a compose field holds a simple list that the form can edit. A map,
 * or a list of objects (the long syntax), must go to the YAML editor. Note
 * that typeof null is "object", so a blank list item is not a simple value.
 *
 * The list editors and the add button of their parent both use this, because
 * an add button over an editor that cannot show the list writes an item that
 * the user cannot see or remove.
 * @param {*} value the field value
 * @returns {boolean} true when the form can edit the list
 */
export function isSimpleList(value : unknown) : boolean {
    if (value === undefined || value === null) {
        return true;
    }
    if (!Array.isArray(value)) {
        return false;
    }
    return !value.some((item) => typeof item === "object");
}
