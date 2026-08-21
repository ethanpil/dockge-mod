import { describe, expect, it } from "vitest";
import { isContainerChange } from "../../backend/docker-events";

describe("isContainerChange", () => {
    it.each([
        [ "start", true ],
        [ "die", true ],
        [ "destroy", true ],
        [ "health_status: healthy", true ],
        [ "health_status: unhealthy", true ],
        [ "exec_create: sh", false ],
        [ "exec_start: sh", false ],
        [ "attach", false ],
    ])("action %j gives %s", (action, expected) => {
        const line = JSON.stringify({
            Type: "container",
            Action: action,
            Actor: { ID: "abc" },
        });
        expect(isContainerChange(line)).toBe(expected);
    });

    it("ignores a different type", () => {
        expect(isContainerChange(JSON.stringify({
            Type: "network",
            Action: "connect",
        }))).toBe(false);
    });

    it("ignores a line that is not JSON", () => {
        expect(isContainerChange("not json")).toBe(false);
        expect(isContainerChange("")).toBe(false);
    });
});
