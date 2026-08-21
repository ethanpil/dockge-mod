import { describe, expect, it } from "vitest";
import { digestsMatch, parseManifestDigest } from "../../backend/image-update";
import { buildRequest, checkNotification, Notification } from "../../backend/notification";
import { isDockerResourceName, parseJSONLines } from "../../backend/docker-resources";
import { parseContainerChange } from "../../backend/docker-events";
import { ValidationError } from "../../backend/util-server";

describe("digestsMatch", () => {
    it("compares the digest part of a repo digest", () => {
        expect(digestsMatch([ "nginx@sha256:aaa" ], "sha256:aaa")).toBe(true);
        expect(digestsMatch([ "nginx@sha256:aaa", "docker.io/library/nginx@sha256:bbb" ], "sha256:bbb")).toBe(true);
        expect(digestsMatch([ "nginx@sha256:aaa" ], "sha256:bbb")).toBe(false);
        expect(digestsMatch([], "sha256:bbb")).toBe(false);
    });
});

describe("parseManifestDigest", () => {
    it("reads the digest of a single image", () => {
        const output = JSON.stringify({
            Ref: "nginx:latest",
            Descriptor: { digest: "sha256:one" },
        });
        expect(parseManifestDigest(output)).toBe("sha256:one");
    });

    it("selects the platform of the host in a manifest list", () => {
        const output = JSON.stringify([
            {
                Descriptor: {
                    digest: "sha256:arm",
                    platform: { os: "linux",
                        architecture: "arm64" },
                },
            },
            {
                Descriptor: {
                    digest: "sha256:amd",
                    platform: { os: "linux",
                        architecture: "amd64" },
                },
            },
        ]);
        expect(parseManifestDigest(output, "linux/amd64")).toBe("sha256:amd");
        expect(parseManifestDigest(output, "linux/arm64")).toBe("sha256:arm");
        // An unknown platform gives the first entry
        expect(parseManifestDigest(output, "linux/s390x")).toBe("sha256:arm");
    });

    it("gives null for a text that is not JSON", () => {
        expect(parseManifestDigest("no such manifest")).toBeNull();
    });
});

describe("buildRequest", () => {
    const base : Omit<Notification, "type"> = {
        name: "t",
        url: "https://example.com/hook",
        events: [],
        active: true,
    };

    it("makes a JSON body for a webhook", () => {
        const req = buildRequest({ ...base,
            type: "webhook" }, "image_update", "Title", "Message");
        expect(req.url).toBe(base.url);
        const body = JSON.parse(req.init.body as string);
        expect(body).toMatchObject({
            event: "image_update",
            title: "Title",
            message: "Message",
        });
    });

    it("puts the title in a header for ntfy", () => {
        const req = buildRequest({ ...base,
            type: "ntfy" }, "container_exited", "Title", "Message");
        expect((req.init.headers as Record<string, string>).Title).toBe("Title");
        expect(req.init.body).toBe("Message");
    });

    it("makes the body of apprise", () => {
        const req = buildRequest({ ...base,
            type: "apprise" }, "x", "Title", "Message");
        expect(JSON.parse(req.init.body as string)).toEqual({
            title: "Title",
            body: "Message",
            type: "info",
        });
    });
});

describe("checkNotification", () => {
    it("accepts a correct target", () => {
        const target = checkNotification({
            name: " Alerts ",
            type: "ntfy",
            url: "https://ntfy.sh/topic",
            events: [ "image_update", "image_update" ],
        });
        expect(target).toEqual({
            id: undefined,
            name: "Alerts",
            type: "ntfy",
            url: "https://ntfy.sh/topic",
            events: [ "image_update" ],
            active: true,
        });
    });

    it.each([
        [ { type: "ntfy",
            url: "https://x",
            events: [] } ],
        [ { name: "a",
            type: "mail",
            url: "https://x",
            events: [] } ],
        [ { name: "a",
            type: "ntfy",
            url: "ftp://x",
            events: [] } ],
        [ { name: "a",
            type: "ntfy",
            url: "https://x",
            events: [ "nope" ] } ],
    ])("refuses %j", (data) => {
        expect(() => checkNotification(data)).toThrow(ValidationError);
    });
});

describe("isDockerResourceName", () => {
    it.each([
        [ "nginx", true ],
        [ "nginx:1.25", true ],
        [ "ghcr.io/org/app:v1", true ],
        [ "nginx@sha256:abc", true ],
        [ "abc123def456", true ],
        [ "", false ],
        [ "-f", false ],
        [ "--all", false ],
        [ "a b", false ],
        [ "a;b", false ],
    ])("%j is %s", (name, ok) => {
        expect(isDockerResourceName(name)).toBe(ok);
    });
});

describe("parseJSONLines", () => {
    it("reads one object for each line and skips other lines", () => {
        const out = "{\"a\":1}\nWARNING: x\n{\"a\":2}\n\n";
        expect(parseJSONLines(out)).toEqual([{ a: 1 }, { a: 2 }]);
    });
});

describe("parseContainerChange with details", () => {
    it("reads the name and the exit code of a die", () => {
        const line = JSON.stringify({
            Type: "container",
            Action: "die",
            Actor: {
                Attributes: {
                    "name": "web-1",
                    "exitCode": "137",
                    "com.docker.compose.project": "demo",
                },
            },
        });
        expect(parseContainerChange(line)).toEqual({
            project: "demo",
            action: "die",
            name: "web-1",
            exitCode: 137,
        });
    });
});
