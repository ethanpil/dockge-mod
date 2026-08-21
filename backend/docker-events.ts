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
 * True when an event line of `docker events` shows a change of a
 * container. A health change comes as "health_status: healthy".
 * @param line One line of `docker events --format '{{json .}}'`
 * @returns True when the interface must read the status again
 */
export function isContainerChange(line : string) : boolean {
    let event : { Type? : string, Action? : string };
    try {
        event = JSON.parse(line);
    } catch (e) {
        return false;
    }
    if (event.Type !== "container" || typeof event.Action !== "string") {
        return false;
    }
    return CONTAINER_ACTIONS.has(event.Action) || event.Action.startsWith("health_status");
}

/**
 * A watcher on `docker events`. It calls the handler a short time after
 * a change of a container. Many events in a short time give one call.
 * The process starts again after an exit, with a pause that grows.
 */
export class DockerEvents {

    private handler : () => void;
    private process : ChildProcess | null = null;
    private timer : NodeJS.Timeout | null = null;
    private restartTimer : NodeJS.Timeout | null = null;
    private pause = 1000;
    private stopped = false;

    /**
     * @param handler The function to call after a change
     */
    constructor(handler : () => void) {
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
                if (isContainerChange(line)) {
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
            try {
                this.handler();
            } catch (e) {
                log.warn("dockerEvents", "Handler failed: " + (e as Error).message);
            }
        }, 500);
    }
}
