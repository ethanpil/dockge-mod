import { describe, expect, it } from "vitest";
import {
    isAnonymousVolume,
    isDockerResourceName,
    labelValue,
    parseJSONLines,
    ResourcesInUse,
    selectImageCandidates,
    selectNetworkCandidates,
    selectVolumeCandidates,
    shortImageId,
} from "../../backend/docker-resources";

/**
 * An empty set of resources in use.
 * @param over The sets that the test needs
 * @returns The resources in use
 */
function inUse(over : Partial<Record<keyof ResourcesInUse, string[]>> = {}) : ResourcesInUse {
    return {
        images: new Set(over.images ?? []),
        volumes: new Set(over.volumes ?? []),
        networks: new Set(over.networks ?? []),
    };
}

/** The name of a volume that docker made */
const ANON = "a".repeat(64);

describe("labelValue", () => {
    it("reads one label of the text of docker", () => {
        const labels = "com.docker.compose.project=web,com.docker.compose.volume=data";
        expect(labelValue(labels, "com.docker.compose.project")).toBe("web");
        expect(labelValue(labels, "com.docker.compose.volume")).toBe("data");
    });

    it("gives null for a label that is not there", () => {
        expect(labelValue("a=1", "b")).toBeNull();
        expect(labelValue("", "a")).toBeNull();
        expect(labelValue(undefined, "a")).toBeNull();
    });
});

describe("isAnonymousVolume", () => {
    it("reads the label of docker", () => {
        expect(isAnonymousVolume("pgdata", "com.docker.volume.anonymous=")).toBe(true);
        expect(isAnonymousVolume(ANON, "com.docker.compose.project=web")).toBe(false);
    });

    it.each([
        [ ANON, true ],
        [ "pgdata", false ],
        [ "web_pgdata", false ],
        [ "a".repeat(63), false ],
        [ "A".repeat(64), false ],
    ])("reads the form of the name of an older docker: %j is %s", (name, expected) => {
        expect(isAnonymousVolume(name, "")).toBe(expected);
    });
});

describe("shortImageId", () => {
    it("removes the algorithm and keeps twelve characters", () => {
        expect(shortImageId("sha256:0123456789abcdef")).toBe("0123456789ab");
        expect(shortImageId("0123456789abcdef")).toBe("0123456789ab");
        expect(shortImageId(undefined)).toBe("");
    });
});

describe("selectVolumeCandidates", () => {
    const rows = [
        { Name: ANON,
            Driver: "local",
            Labels: "com.docker.volume.anonymous=" },
        { Name: "pgdata",
            Driver: "local",
            Labels: "" },
        { Name: "b".repeat(64),
            Driver: "local",
            Labels: "com.docker.volume.anonymous=,com.docker.compose.project=web" },
        { Name: "c".repeat(64),
            Driver: "local",
            Labels: "com.docker.volume.anonymous=,com.docker.compose.project=other" },
    ];

    it("removes only a volume that docker named", () => {
        const plan = selectVolumeCandidates(rows, inUse(), new Set([ "web" ]));
        expect(plan.candidates.map((c) => c.name)).toEqual([ ANON, "c".repeat(64) ]);
        expect(plan.kept).toBe(2);
    });

    it("keeps a volume with a name, thus the data of a database stays", () => {
        const plan = selectVolumeCandidates(rows, inUse(), new Set());
        expect(plan.candidates.map((c) => c.name)).not.toContain("pgdata");
    });

    it("keeps a volume of a stack of this server that is not running", () => {
        const plan = selectVolumeCandidates(rows, inUse(), new Set([ "web" ]));
        expect(plan.candidates.map((c) => c.name)).not.toContain("b".repeat(64));
    });

    it("keeps a volume that a container uses", () => {
        const plan = selectVolumeCandidates(rows, inUse({ volumes: [ ANON ] }), new Set());
        expect(plan.candidates.map((c) => c.name)).not.toContain(ANON);
    });
});

describe("selectNetworkCandidates", () => {
    const rows = [
        { Name: "bridge",
            Driver: "bridge",
            Labels: "" },
        { Name: "host",
            Driver: "host",
            Labels: "" },
        { Name: "none",
            Driver: "null",
            Labels: "" },
        { Name: "web_default",
            Driver: "bridge",
            Labels: "com.docker.compose.project=web" },
        { Name: "other_default",
            Driver: "bridge",
            Labels: "com.docker.compose.project=other" },
        { Name: "manual-net",
            Driver: "bridge",
            Labels: "" },
    ];

    it("keeps the networks of docker itself", () => {
        const plan = selectNetworkCandidates(rows, inUse(), new Set());
        const names = plan.candidates.map((c) => c.name);
        expect(names).not.toContain("bridge");
        expect(names).not.toContain("host");
        expect(names).not.toContain("none");
    });

    it("keeps the network of a stack of this server that is stopped", () => {
        const plan = selectNetworkCandidates(rows, inUse(), new Set([ "web" ]));
        expect(plan.candidates.map((c) => c.name)).not.toContain("web_default");
    });

    it("keeps a network that a container uses, also a container that is stopped", () => {
        const plan = selectNetworkCandidates(rows, inUse({ networks: [ "manual-net" ] }), new Set());
        expect(plan.candidates.map((c) => c.name)).not.toContain("manual-net");
    });

    it("removes a network that no container and no stack of this server uses", () => {
        const plan = selectNetworkCandidates(rows, inUse(), new Set([ "web" ]));
        expect(plan.candidates.map((c) => c.name)).toEqual([ "other_default", "manual-net" ]);
    });
});

describe("selectImageCandidates", () => {
    const rows = [
        { ID: "sha256:111111111111aaaa",
            Repository: "<none>",
            Tag: "<none>",
            Size: "10MB" },
        { ID: "sha256:222222222222aaaa",
            Repository: "nginx",
            Tag: "alpine",
            Size: "90MB" },
        { ID: "sha256:333333333333aaaa",
            Repository: "redis",
            Tag: "7",
            Size: "50MB" },
        { ID: "sha256:444444444444aaaa",
            Repository: "ghcr.io/org/app",
            Tag: "v1",
            Size: "20MB" },
    ];

    it("removes only the images without a tag for the dangling prune", () => {
        const plan = selectImageCandidates(rows, inUse(), new Set(), true);
        expect(plan.candidates.map((c) => c.name)).toEqual([ "<none>:<none>" ]);
        expect(plan.kept).toBe(3);
    });

    it("keeps an image that a compose file of this server names", () => {
        const plan = selectImageCandidates(rows, inUse(), new Set([ "nginx:alpine" ]), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("nginx:alpine");
    });

    it("reads the name of an image of a different registry", () => {
        const plan = selectImageCandidates(rows, inUse(), new Set([ "ghcr.io/org/app:v1" ]), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("ghcr.io/org/app:v1");
    });

    it("gives one name to two forms of one image", () => {
        const plan = selectImageCandidates(rows, inUse(), new Set([ "docker.io/library/nginx:alpine" ]), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("nginx:alpine");
    });

    it("keeps an image that a container uses, also a container that is stopped", () => {
        const plan = selectImageCandidates(rows, inUse({ images: [ "333333333333" ] }), new Set(), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("redis:7");
    });

    it("removes an image that no container and no compose file uses", () => {
        const plan = selectImageCandidates(rows, inUse(), new Set([ "nginx:alpine" ]), false);
        expect(plan.candidates.map((c) => c.name)).toEqual([ "<none>:<none>", "redis:7", "ghcr.io/org/app:v1" ]);
    });

    it("gives the id of an image without a tag to the remove command", () => {
        const plan = selectImageCandidates(rows, inUse(), new Set(), true);
        expect(plan.candidates[0].id).toBe("111111111111");
    });
});

describe("parseJSONLines", () => {
    it("reads one object for each line and skips other lines", () => {
        expect(parseJSONLines("{\"a\":1}\nWARNING: x\n{\"a\":2}\n\n")).toEqual([{ a: 1 }, { a: 2 }]);
        expect(parseJSONLines("")).toEqual([]);
    });
});

describe("isDockerResourceName", () => {
    it.each([
        [ "nginx:1.25", true ],
        [ "ghcr.io/org/app:v1", true ],
        [ "abc123", true ],
        [ "-f", false ],
        [ "", false ],
        [ "a b", false ],
    ])("%j is %s", (name, ok) => {
        expect(isDockerResourceName(name)).toBe(ok);
    });
});
