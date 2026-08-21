import { R } from "redbean-node";
import { log } from "./log";
import { errorMessage, isOneOf, ValidationError } from "./util-server";

/** The services that can get a notification */
export const NOTIFICATION_TYPES = [ "webhook", "ntfy", "apprise" ] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

/** The events that can send a notification */
export const NOTIFICATION_EVENTS = [ "image_update", "container_exited", "container_unhealthy" ] as const;
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];

/**
 * One notification target, for the interface and the table.
 */
export interface Notification {
    id? : number;
    name : string;
    type : NotificationType;
    url : string;
    events : NotificationEvent[];
    active : boolean;
}

/**
 * Make the HTTP request for one target.
 * @param target The target
 * @param event The event name
 * @param title The title
 * @param message The message
 * @returns The URL and the request options
 */
export function buildRequest(target : Notification, event : string, title : string, message : string) : { url : string, init : RequestInit } {
    switch (target.type) {
        case "ntfy":
            return {
                url: target.url,
                init: {
                    method: "POST",
                    headers: {
                        "Title": title,
                        "Tags": event,
                    },
                    body: message,
                },
            };
        case "apprise":
            return {
                url: target.url,
                init: {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        title,
                        body: message,
                        type: "info",
                    }),
                },
            };
        default:
            return {
                url: target.url,
                init: {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        event,
                        title,
                        message,
                        time: new Date().toISOString(),
                    }),
                },
            };
    }
}

/**
 * Check the fields of a target from the client.
 * @param data The data from the client
 * @returns The target
 */
export function checkNotification(data : unknown) : Notification {
    const obj = (data ?? {}) as Record<string, unknown>;

    if (typeof obj.name !== "string" || obj.name.trim() === "" || obj.name.length > 200) {
        throw new ValidationError("The name must be a text of 1 to 200 characters");
    }
    if (!isOneOf(NOTIFICATION_TYPES, obj.type)) {
        throw new ValidationError("Unknown notification type");
    }
    if (typeof obj.url !== "string" || !/^https?:\/\//.test(obj.url) || obj.url.length > 2000) {
        throw new ValidationError("The URL must start with http:// or https://");
    }
    if (!Array.isArray(obj.events) || obj.events.some((e) => !isOneOf(NOTIFICATION_EVENTS, e))) {
        throw new ValidationError("Unknown event");
    }

    return {
        id: typeof obj.id === "number" ? obj.id : undefined,
        name: obj.name.trim(),
        type: obj.type,
        url: obj.url,
        events: [ ...new Set(obj.events as NotificationEvent[]) ],
        active: obj.active !== false,
    };
}

/**
 * The notifications. The targets are in the mod_notification table.
 */
export class Notifier {

    /** The time in which one key sends one notification, in milliseconds */
    static readonly COOLDOWN = 5 * 60 * 1000;

    /** The last send time for each key */
    protected static lastSend : Map<string, number> = new Map();

    static async list() : Promise<Notification[]> {
        const rows = await R.knex("mod_notification").orderBy("id").select();
        return rows.map((row : Record<string, unknown>) => Notifier.fromRow(row));
    }

    protected static fromRow(row : Record<string, unknown>) : Notification {
        let events : NotificationEvent[] = [];
        try {
            events = JSON.parse(row.events as string);
        } catch (e) {
            events = [];
        }
        return {
            id: row.id as number,
            name: row.name as string,
            type: row.type as NotificationType,
            url: row.url as string,
            events,
            active: Boolean(row.active),
        };
    }

    /**
     * Write a target. A target with an id changes, a target without an id
     * is new.
     * @param target The target
     * @returns The id
     */
    static async save(target : Notification) : Promise<number> {
        const row = {
            name: target.name,
            type: target.type,
            url: target.url,
            events: JSON.stringify(target.events),
            active: target.active,
        };
        if (target.id !== undefined) {
            const changed = await R.knex("mod_notification").where({ id: target.id }).update(row);
            if (changed === 0) {
                throw new ValidationError("Notification not found");
            }
            return target.id;
        }
        const [ id ] = await R.knex("mod_notification").insert(row);
        return id;
    }

    static async remove(id : number) : Promise<void> {
        await R.knex("mod_notification").where({ id }).del();
    }

    /**
     * Send one notification to one target, for the test button.
     * @param target The target
     */
    static async sendTo(target : Notification, event : string, title : string, message : string) : Promise<void> {
        const { url, init } = buildRequest(target, event, title, message);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(url, {
                ...init,
                signal: controller.signal,
                // A target must not send the request to a different host
                redirect: "error",
            });
            // Read the body, thus the connection goes back to the pool
            await res.arrayBuffer().catch(() => undefined);
            if (!res.ok) {
                throw new Error("HTTP " + res.status);
            }
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Send a notification to each active target of the event.
     * @param event The event
     * @param title The title
     * @param message The message
     * @param key A key for the cooldown. The same key sends one time in
     * the cooldown period. No key sends each time.
     */
    static async send(event : NotificationEvent, title : string, message : string, key? : string) : Promise<void> {
        if (key !== undefined) {
            const now = Date.now();
            const last = Notifier.lastSend.get(key);
            if (last !== undefined && now - last < Notifier.COOLDOWN) {
                return;
            }
            Notifier.lastSend.set(key, now);
            // Keep the map small
            if (Notifier.lastSend.size > 1000) {
                for (const [ k, time ] of Notifier.lastSend) {
                    if (now - time >= Notifier.COOLDOWN) {
                        Notifier.lastSend.delete(k);
                    }
                }
            }
        }

        let targets : Notification[];
        try {
            targets = await Notifier.list();
        } catch (e) {
            log.warn("notification", "Cannot read the targets: " + errorMessage(e));
            return;
        }

        for (const target of targets) {
            if (!target.active || !target.events.includes(event)) {
                continue;
            }
            try {
                await Notifier.sendTo(target, event, title, message);
            } catch (e) {
                log.warn("notification", "Cannot send to " + target.name + ": " + errorMessage(e));
            }
        }
    }
}
