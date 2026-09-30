import { spawn, ChildProcess } from "child_process";
import { log } from "./log";

/**
 * Container actions that change what the UI shows. Others, such as exec_create, are ignored.
 */
const CONTAINER_ACTIONS = new Set([
    "create",
    "start",
    "die",
    "stop",
    "kill",
    "pause",
    "unpause",
    "destroy",
    "rename",
    "restart",
    "oom",
]);

/**
 * A change of a container, from one line of `docker events`.
 */
export interface ContainerChange {
    /** Compose project of the container, or null when it has none */
    project : string | null;
    /** The docker action, for example "die" or "health_status: unhealthy" */
    action : string;
    /** The container name */
    name : string;
    /** The exit code of a die action, or null */
    exitCode : number | null;
    /** The signal of a kill action, for example "15" or "SIGTERM", or null */
    signal : string | null;
}

/**
 * Parse one line of `docker events --format '{{json .}}'`. Health changes
 * arrive as "health_status: healthy".
 * @param line One line of the output
 * @returns The change, or null when the line shows no change of a container
 */
export function parseContainerChange(line : string) : ContainerChange | null {
    let event : { Type? : string, Action? : string, Actor? : { Attributes? : Record<string, string> } };
    try {
        event = JSON.parse(line);
    } catch (e) {
        return null;
    }
    if (event.Type !== "container" || typeof event.Action !== "string") {
        return null;
    }
    if (!CONTAINER_ACTIONS.has(event.Action) && !event.Action.startsWith("health_status")) {
        return null;
    }
    const attributes = event.Actor?.Attributes ?? {};
    const exitCode = event.Action === "die" && attributes.exitCode !== undefined ? Number(attributes.exitCode) : null;
    return {
        project: attributes["com.docker.compose.project"] ?? null,
        action: event.Action,
        name: attributes.name ?? "",
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
        signal: event.Action === "kill" ? (attributes.signal ?? null) : null,
    };
}

/**
 * Handler for one batch of changes.
 * @param projects The compose projects that changed
 * @param other True when a container without a project changed
 * @param changes Each change in the batch
 */
export type ChangeHandler = (projects : Set<string>, other : boolean, changes : ContainerChange[]) => void;

/**
 * Watches `docker events` and calls the handler shortly after container
 * changes, with the changed compose projects. A burst of events gives one
 * call. The process restarts after an exit, with a growing backoff.
 */
export class DockerEvents {

    private handler : ChangeHandler;
    private process : ChildProcess | null = null;
    private timer : NodeJS.Timeout | null = null;
    private restartTimer : NodeJS.Timeout | null = null;
    private pause = 1000;
    private stopped = false;

    // Changes since the last handler call
    private changes : ContainerChange[] = [];

    /** True when changes were dropped, so every cache must be invalidated */
    private overflow = false;

    /** True after the first start, so a restart can invalidate the caches */
    private hasRun = false;

    /**
     * @param handler The function to call after a change
     */
    constructor(handler : ChangeHandler) {
        this.handler = handler;
    }

    start() {
        this.stopped = false;
        this.spawn();
    }

    stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        this.process?.kill();
        this.process = null;
    }

    private spawn() {
        let rest = "";
        const started = Date.now();
        const process = spawn("docker", [ "events", "--format", "{{json .}}", "--filter", "type=container" ], {
            stdio: [ "ignore", "pipe", "pipe" ],
        });
        this.process = process;

        process.stdout?.setEncoding("utf-8");
        process.stdout?.on("data", (chunk : string) => {
            rest += chunk;
            const lines = rest.split("\n");
            rest = lines.pop() ?? "";
            for (const line of lines) {
                const change = parseContainerChange(line);
                if (change) {
                    // Cap the buffer during event floods; dropped changes still invalidate every cache
                    if (this.changes.length < 1000) {
                        this.changes.push(change);
                    } else {
                        this.overflow = true;
                    }
                    this.schedule();
                }
            }
        });

        // Events that happened while no watcher ran are lost, so the caches
        // start fresh after a restart
        if (this.hasRun) {
            this.overflow = true;
            this.schedule();
        }
        this.hasRun = true;

        process.stderr?.setEncoding("utf-8");
        process.stderr?.on("data", (chunk : string) => {
            log.debug("dockerEvents", chunk.trim());
        });

        process.on("error", (e) => {
            log.warn("dockerEvents", "Cannot start docker events: " + e.message);
        });

        // A process that fails to start emits error and close, but no exit, so listen for close
        process.on("close", (code) => {
            if (this.process !== process) {
                return;
            }
            this.process = null;
            if (this.stopped) {
                return;
            }
            // A stream that lived a while was healthy, so reset the backoff. One
            // that ended at once keeps it, so a failing daemon is not restarted every second.
            if (Date.now() - started > 30 * 1000) {
                this.pause = 1000;
            }
            log.warn("dockerEvents", "docker events ended with code " + code + ", start again in " + this.pause + " ms");
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                this.spawn();
            }, this.pause);
            this.pause = Math.min(this.pause * 2, 60 * 1000);
        });
    }

    /**
     * Call the handler after a short delay, so a burst of events gives one call.
     */
    private schedule() {
        if (this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            const changes = this.changes;
            this.changes = [];
            const projects = new Set<string>();
            let other = this.overflow;
            this.overflow = false;
            for (const change of changes) {
                if (change.project !== null) {
                    projects.add(change.project);
                } else {
                    other = true;
                }
            }
            try {
                this.handler(projects, other, changes);
            } catch (e) {
                log.warn("dockerEvents", "Handler failed: " + (e as Error).message);
            }
        }, 500);
    }
}
