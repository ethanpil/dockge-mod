import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Stack } from "../../backend/stack";
import type { DockgeServer } from "../../backend/dockge-server";
import { ValidationError } from "../../backend/util-server";
import { CREATED_STACK, EXITED, RUNNING, UNKNOWN } from "../../common/util-common";

/**
 * The Stack class reads only stacksDir from the server. A plain object
 * with that field is enough for the tests.
 * @param stacksDir the stacks directory
 * @returns a server stub
 */
function fakeServer(stacksDir : string) : DockgeServer {
    return { stacksDir } as unknown as DockgeServer;
}

describe("Stack.statusConvert", () => {
    it.each([
        [ "running(2)", RUNNING ],
        [ "exited(1), running(1)", EXITED ],
        [ "running(1), exited(1)", EXITED ],
        [ "created(1)", CREATED_STACK ],
        [ "paused(1)", UNKNOWN ],
        [ "", UNKNOWN ],
    ])("%j gives %s", (status, expected) => {
        expect(Stack.statusConvert(status)).toBe(expected);
    });
});

describe("Stack.getComposeOptions", () => {
    let stacksDir : string;
    let server : DockgeServer;

    beforeEach(() => {
        stacksDir = fs.mkdtempSync(path.join(os.tmpdir(), "dockge-test-"));
        fs.mkdirSync(path.join(stacksDir, "demo"));
        server = fakeServer(stacksDir);
    });

    afterEach(() => {
        fs.rmSync(stacksDir, {
            recursive: true,
            force: true,
        });
    });

    it("gives the plain command without a global.env", () => {
        const stack = new Stack(server, "demo");
        expect(stack.getComposeOptions("up", "-d")).toEqual([ "compose", "up", "-d" ]);
    });

    it("adds global.env before the command", () => {
        fs.writeFileSync(path.join(stacksDir, "global.env"), "A=1\n");
        const stack = new Stack(server, "demo");
        expect(stack.getComposeOptions("ps")).toEqual([ "compose", "--env-file", "../global.env", "ps" ]);
    });

    it("adds the .env of the stack after global.env", () => {
        fs.writeFileSync(path.join(stacksDir, "global.env"), "A=1\n");
        fs.writeFileSync(path.join(stacksDir, "demo", ".env"), "B=2\n");
        const stack = new Stack(server, "demo");
        expect(stack.getComposeOptions("ps")).toEqual([
            "compose", "--env-file", "../global.env", "--env-file", "./.env", "ps",
        ]);
    });

    it("does not add the .env of the stack without a global.env", () => {
        fs.writeFileSync(path.join(stacksDir, "demo", ".env"), "B=2\n");
        const stack = new Stack(server, "demo");
        expect(stack.getComposeOptions("ps")).toEqual([ "compose", "ps" ]);
    });
});

describe("Stack.getStack", () => {
    // The tests skip the file operations, thus no directory is necessary
    const stacksDir = os.tmpdir();

    it.each([
        "..",
        "../other",
        "a/../../other",
        "",
        ".",
    ])("refuses the name %j", async (name) => {
        await expect(Stack.getStack(fakeServer(stacksDir), name, true)).rejects.toThrow(ValidationError);
    });

    it("accepts a name inside the stacks directory", async () => {
        const stack = await Stack.getStack(fakeServer(stacksDir), "demo", true);
        expect(stack.name).toBe("demo");
        expect(stack.path).toBe(path.join(stacksDir, "demo"));
    });
});

describe("Stack.validate", () => {
    const server = fakeServer(os.tmpdir());

    it.each([
        "demo",
        "my_stack-1",
    ])("accepts the name %j", (name) => {
        const stack = new Stack(server, name, "services: {}\n", "", null, true);
        expect(() => stack.validate()).not.toThrow();
    });

    it.each([
        "Demo",
        "my stack",
        "a/b",
        "a.b",
    ])("refuses the name %j", (name) => {
        const stack = new Stack(server, name, "services: {}\n", "", null, true);
        expect(() => stack.validate()).toThrow(ValidationError);
    });

    it("refuses a compose text with a YAML error", () => {
        const stack = new Stack(server, "demo", "services: [\n", "", null, true);
        expect(() => stack.validate()).toThrow();
    });

    it("refuses an override text with a YAML error", () => {
        const stack = new Stack(server, "demo", "services: {}\n", "", "services: [\n", true);
        expect(() => stack.validate()).toThrow();
    });

    it("accepts an override that holds only comments", () => {
        const stack = new Stack(server, "demo", "services: {}\n", "", "# only a comment\n", true);
        expect(() => stack.validate()).not.toThrow();
    });

    it("refuses a one-line .env without an = sign", () => {
        const stack = new Stack(server, "demo", "services: {}\n", "JUST_TEXT", null, true);
        expect(() => stack.validate()).toThrow(ValidationError);
    });
});
