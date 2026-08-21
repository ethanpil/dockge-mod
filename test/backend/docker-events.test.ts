import { describe, expect, it } from "vitest";
import { parseContainerChange } from "../../backend/docker-events";

/**
 * Make one event line.
 * @param action The docker action
 * @param project The compose project, or none
 * @returns The JSON line
 */
function line(action : string, project? : string) : string {
    return JSON.stringify({
        Type: "container",
        Action: action,
        Actor: {
            ID: "abc",
            Attributes: project ? { "com.docker.compose.project": project } : {},
        },
    });
}

describe("parseContainerChange", () => {
    it.each([
        [ "start", true ],
        [ "die", true ],
        [ "destroy", true ],
        [ "health_status: healthy", true ],
        [ "health_status: unhealthy", true ],
        [ "exec_create: sh", false ],
        [ "exec_start: sh", false ],
        [ "attach", false ],
    ])("action %j is a change: %s", (action, expected) => {
        expect(parseContainerChange(line(action, "demo")) !== null).toBe(expected);
    });

    it("gives the compose project", () => {
        expect(parseContainerChange(line("start", "demo"))).toEqual({ project: "demo" });
    });

    it("gives null as the project for a container without a project", () => {
        expect(parseContainerChange(line("start"))).toEqual({ project: null });
    });

    it("ignores a different type", () => {
        expect(parseContainerChange(JSON.stringify({
            Type: "network",
            Action: "connect",
        }))).toBeNull();
    });

    it("ignores a line that is not JSON", () => {
        expect(parseContainerChange("not json")).toBeNull();
        expect(parseContainerChange("")).toBeNull();
    });
});
