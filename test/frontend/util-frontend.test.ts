import { describe, expect, it, vi } from "vitest";

// util-frontend imports the i18n module, which needs the browser. The
// functions under test do not use it.
vi.mock("../../frontend/src/i18n", () => ({
    currentLocale: () => "en",
    localeDirection: () => "ltr",
}));

vi.mock("vue-toastification", () => ({
    POSITION: {
        BOTTOM_RIGHT: "bottom-right",
    },
}));

const {
    formatBytes,
    formatPorts,
    formatUptime,
    isSimpleList,
    parseDockerSize,
} = await import("../../frontend/src/util-frontend");

describe("formatUptime", () => {
    it.each([
        [ "Up 55 minutes (healthy)", "0d 0h 55m" ],
        [ "Up 3 days", "3d 0h 0m" ],
        [ "Up About an hour", "0d 1h 0m" ],
        [ "Up Less than a second", "0d 0h 0m" ],
        [ "Up 2 weeks", "14d 0h 0m" ],
        [ "Up 90 minutes", "0d 1h 30m" ],
        [ "Exited (0) 2 hours ago", null ],
        [ "Up something strange", null ],
        [ "", null ],
    ])("%j gives %j", (status, uptime) => {
        expect(formatUptime(status)).toBe(uptime);
    });
});

describe("formatPorts", () => {
    it("removes the wildcard host and the IPv6 twin", () => {
        expect(formatPorts("0.0.0.0:8080->80/tcp, :::8080->80/tcp")).toBe("8080->80/tcp");
        expect(formatPorts("[::]:443->443/tcp, *:443->443/tcp")).toBe("443->443/tcp");
    });

    it("keeps a specific bind address", () => {
        expect(formatPorts("127.0.0.1:5432->5432/tcp")).toBe("127.0.0.1:5432->5432/tcp");
    });

    it("gives an empty text for no ports", () => {
        expect(formatPorts("")).toBe("");
    });
});

describe("formatBytes", () => {
    it.each([
        [ 0, "0 B" ],
        [ 1023, "1023 B" ],
        [ 1024, "1.0 KiB" ],
        [ 2147483648, "2.0 GiB" ],
        [ 102400, "100 KiB" ],
        [ 1048064, "1.0 MiB" ],
        [ 1048570, "1.0 MiB" ],
        [ -1, "-" ],
        [ NaN, "-" ],
    ])("%s gives %s", (bytes, text) => {
        expect(formatBytes(bytes)).toBe(text);
    });
});

describe("parseDockerSize", () => {
    it.each([
        [ "1.53GB", 1.53e9 ],
        [ "1.5GiB", 1.5 * 1024 * 1024 * 1024 ],
        [ "512kB", 512000 ],
        [ "100B", 100 ],
        [ "7MB", 7e6 ],
        [ "", 0 ],
        [ "abc", 0 ],
    ])("%j gives %s", (size, bytes) => {
        expect(parseDockerSize(size)).toBeCloseTo(bytes);
    });
});

describe("isSimpleList", () => {
    it.each([
        [ undefined, true ],
        [ null, true ],
        [[], true ],
        [[ "a", 1 ], true ],
        [[ null ], false ],
        [[{ target: 80 }], false ],
        [{ a: 1 }, false ],
        [ "text", false ],
    ])("%j is %s", (value, simple) => {
        expect(isSimpleList(value)).toBe(simple);
    });
});
