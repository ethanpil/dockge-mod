import { spawn, ChildProcess } from "child_process";
import { log } from "./log";

/**
 * The actions of a container that change what the interface shows. A
 * different action, for example exec_create, changes nothing.
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
    /** The compose project of the container, or null for a different container */
    project : string | null;
    /** The docker action, for example "die" or "health_status: unhealthy" */
    action : string;
    /** The container name */
    name : string;
    /** The exit code of a die action, or null */
    exitCode : number | null;
}

/**
 * Read one line of `docker events --format '{{json .}}'`. A health change
 * comes as "health_status: healthy".
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
    };
}

/**
 * The function that gets the changes of a period.
 * @param projects The compose projects that changed
 * @param other True when a container without a project changed
 * @param changes Each change of the period
 */
export type ChangeHandler = (projects : Set<string>, other : boolean, changes : ContainerChange[]) => void;

/**
 * A watcher on `docker events`. It calls the handler a short time after
 * a change of a container, with the compose projects that changed. Many
 * events in a short time give one call. The process starts again after
 * an exit, with a pause that grows.
 */
export class DockerEvents {

    private handler : ChangeHandler;
    private process : ChildProcess | null = null;
    private timer : NodeJS.Timeout | null = null;
    private restartTimer : NodeJS.Timeout | null = null;
    private pause = 1000;
    private stopped = false;

    // The changes since the last call of the handler
    private changes : ContainerChange[] = [];

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
        const process = spawn("docker", [ "events", "--format", "{{json .}}", "--filter", "type=container" ], {
            stdio: [ "ignore", "pipe", "pipe" ],
        });
        this.process = process;

        process.stdout?.setEncoding("utf-8");
        process.stdout?.on("data", (chunk : string) => {
            // The stream is healthy, thus the next pause is short again
            this.pause = 1000;
            rest += chunk;
            const lines = rest.split("\n");
            rest = lines.pop() ?? "";
            for (const line of lines) {
                const change = parseContainerChange(line);
                if (change) {
                    // A limit for a period with very many events
                    if (this.changes.length < 1000) {
                        this.changes.push(change);
                    }
                    this.schedule();
                }
            }
        });

        process.stderr?.setEncoding("utf-8");
        process.stderr?.on("data", (chunk : string) => {
            log.debug("dockerEvents", chunk.trim());
        });

        process.on("error", (e) => {
            log.warn("dockerEvents", "Cannot start docker events: " + e.message);
        });

        process.on("exit", (code) => {
            if (this.process !== process) {
                return;
            }
            this.process = null;
            if (this.stopped) {
                return;
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
     * Call the handler after a short time. Events that come in that time
     * give one call.
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
            let other = false;
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
