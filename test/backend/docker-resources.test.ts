import { describe, expect, it } from "vitest";
import {
    isAnonymousVolume,
    isDanglingImage,
    isDockerResourceName,
    labelValue,
    parseContainerScan,
    parseJSONLines,
    ProtectedResources,
    refRepository,
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

/**
 * The images that a removal must keep.
 * @param over The names that the test needs
 * @returns The protected resources
 */
function protectedResources(over : { projects ?: string[], images ?: string[], repositories ?: string[] } = {}) : ProtectedResources {
    return {
        projects: new Set(over.projects ?? []),
        images: new Set(over.images ?? []),
        repositories: new Set(over.repositories ?? []),
    };
}

/** The name that docker gives to a volume that it named itself */
const ANON = "a".repeat(64);
/** The name of a second volume that docker named itself */
const ANON2 = "b".repeat(64);

/** The labels that docker puts on a volume that it named itself */
const ANON_LABELS = { "com.docker.volume.anonymous": "" };

describe("labelValue", () => {
    it("reads one label of the object of an inspect", () => {
        const labels = {
            "com.docker.compose.project": "web",
            "com.docker.compose.volume": "data",
        };
        expect(labelValue(labels, "com.docker.compose.project")).toBe("web");
        expect(labelValue(labels, "com.docker.compose.volume")).toBe("data");
        expect(labelValue(labels, "other")).toBeNull();
    });

    it("keeps a value that holds a comma, thus a description cannot move a label", () => {
        const labels = {
            description: "a, b, other=x",
            "com.docker.compose.project": "web",
        };
        expect(labelValue(labels, "com.docker.compose.project")).toBe("web");
        expect(labelValue(labels, "other")).toBeNull();
    });

    it("reads one label of the text of the image list", () => {
        expect(labelValue("com.docker.compose.project=web,other=1", "com.docker.compose.project")).toBe("web");
    });

    it("gives null for a label that is not there", () => {
        expect(labelValue("a=1", "b")).toBeNull();
        expect(labelValue("", "a")).toBeNull();
        expect(labelValue(undefined, "a")).toBeNull();
        expect(labelValue(null, "a")).toBeNull();
    });
});

describe("isAnonymousVolume", () => {
    it("reads the label of docker, also with an empty value", () => {
        expect(isAnonymousVolume(ANON_LABELS)).toBe(true);
        expect(isAnonymousVolume({ "com.docker.compose.project": "web" })).toBe(false);
        expect(isAnonymousVolume({})).toBe(false);
        expect(isAnonymousVolume(null)).toBe(false);
    });

    it("gives false for a volume with a name, thus the data of a user stays", () => {
        expect(isAnonymousVolume({ "com.docker.compose.project": "web",
            "com.docker.compose.volume": "pgdata" })).toBe(false);
    });
});

describe("shortImageId", () => {
    it("removes the algorithm and keeps twelve characters", () => {
        expect(shortImageId("sha256:0123456789abcdef")).toBe("0123456789ab");
        expect(shortImageId("0123456789abcdef")).toBe("0123456789ab");
        expect(shortImageId(undefined)).toBe("");
    });
});

describe("isDanglingImage", () => {
    it("asks for a repository and a tag that are both empty, the same as docker", () => {
        expect(isDanglingImage("<none>", "<none>")).toBe(true);
        expect(isDanglingImage("", "")).toBe(true);
        expect(isDanglingImage("nginx", "alpine")).toBe(false);
    });

    it("gives false for an image that a pull with a digest brought in", () => {
        // Docker shows the repository of such an image, and no tag. It
        // is not dangling, and a remove of it can break a stack.
        expect(isDanglingImage("ghcr.io/org/app", "<none>")).toBe(false);
    });
});

describe("refRepository", () => {
    it.each([
        [ "nginx:alpine", "nginx" ],
        [ "nginx", "nginx" ],
        [ "ghcr.io/org/app@sha256:" + "a".repeat(64), "ghcr.io/org/app" ],
        [ "ghcr.io/org/app:v1@sha256:" + "a".repeat(64), "ghcr.io/org/app" ],
        [ "localhost:5000/app", "localhost:5000/app" ],
        [ "localhost:5000/app:v1", "localhost:5000/app" ],
    ])("reads the repository of %j", (image, expected) => {
        expect(refRepository(image)).toBe(expected);
    });
});

describe("parseContainerScan", () => {
    it("reads the image, the volumes, the networks, and the project", () => {
        const scan = parseContainerScan("sha256:111111111111aaaa|" + ANON + ",pgdata,|web_default,|web\n");
        expect([ ...scan.used.images ]).toEqual([ "111111111111" ]);
        expect([ ...scan.used.volumes ].sort()).toEqual([ ANON, "pgdata" ].sort());
        expect([ ...scan.used.networks ]).toEqual([ "web_default" ]);
        expect(scan.owners.get(ANON)).toBe("web");
    });

    it("gives no project for a container that docker compose did not start", () => {
        const scan = parseContainerScan("sha256:111111111111aaaa|" + ANON + ",||<no value>\n");
        expect(scan.used.volumes.has(ANON)).toBe(true);
        expect(scan.owners.has(ANON)).toBe(false);
    });

    it("skips a line that is not complete", () => {
        const scan = parseContainerScan("sha256:111111111111aaaa|x\n\n");
        expect(scan.used.images.size).toBe(0);
    });
});

describe("selectVolumeCandidates", () => {
    // Docker puts only the anonymous label on a volume that it named
    // itself. It puts no project label on such a volume, also when
    // docker compose made it.
    const rows = [
        { Name: ANON,
            Driver: "local",
            Labels: ANON_LABELS },
        { Name: ANON2,
            Driver: "local",
            Labels: ANON_LABELS },
        { Name: "pgdata",
            Driver: "local",
            Labels: {} },
        { Name: "web_data",
            Driver: "local",
            Labels: { "com.docker.compose.project": "web" } },
    ];

    it("keeps a volume with a name, thus the data of a database stays", () => {
        const plan = selectVolumeCandidates(rows, inUse(), new Set(), new Map());
        const names = plan.candidates.map((c) => c.name);
        expect(names).not.toContain("pgdata");
        expect(names).not.toContain("web_data");
    });

    it("keeps a volume that a container uses", () => {
        const plan = selectVolumeCandidates(rows, inUse({ volumes: [ ANON ] }), new Set(), new Map());
        expect(plan.candidates.map((c) => c.name)).not.toContain(ANON);
    });

    it("keeps a volume of a stack of this server that is down", () => {
        // The stack is down, thus no container holds the volume and the
        // volume has no project label. The record of the server says
        // which stack made it.
        const owners = new Map([[ ANON, "web" ]]);
        const plan = selectVolumeCandidates(rows, inUse(), new Set([ "web" ]), owners);
        expect(plan.candidates.map((c) => c.name)).not.toContain(ANON);
    });

    it("removes a volume of a project that this server does not manage", () => {
        const owners = new Map([[ ANON, "web" ], [ ANON2, "other" ]]);
        const plan = selectVolumeCandidates(rows, inUse(), new Set([ "web" ]), owners);
        expect(plan.candidates.map((c) => c.name)).toEqual([ ANON2 ]);
        expect(plan.kept).toBe(3);
    });

    it("removes a volume that docker named and that no record holds", () => {
        const plan = selectVolumeCandidates(rows, inUse(), new Set([ "web" ]), new Map());
        expect(plan.candidates.map((c) => c.name)).toEqual([ ANON, ANON2 ]);
    });
});

describe("selectNetworkCandidates", () => {
    const rows = [
        { Name: "bridge",
            Driver: "bridge",
            Labels: {} },
        { Name: "host",
            Driver: "host",
            Labels: {} },
        { Name: "none",
            Driver: "null",
            Labels: {} },
        { Name: "web_default",
            Driver: "bridge",
            Labels: { "com.docker.compose.project": "web" } },
        { Name: "other_default",
            Driver: "bridge",
            Labels: { "com.docker.compose.project": "other" } },
        { Name: "manual-net",
            Driver: "bridge",
            Labels: {} },
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
        { ID: "sha256:555555555555aaaa",
            Repository: "ghcr.io/org/pinned",
            Tag: "<none>",
            Size: "30MB" },
        { ID: "sha256:666666666666aaaa",
            Repository: "web-api",
            Tag: "latest",
            Size: "40MB" },
    ];

    it("removes only the images without a repository and without a tag", () => {
        const plan = selectImageCandidates(rows, inUse(), protectedResources(), true);
        expect(plan.candidates.map((c) => c.name)).toEqual([ "<none>:<none>" ]);
        expect(plan.kept).toBe(5);
    });

    it("keeps an image that a pull with a digest brought in", () => {
        // Such an image has a repository and no tag. Docker does not
        // call it dangling, thus this server must not remove it.
        const plan = selectImageCandidates(rows, inUse(), protectedResources(), true);
        expect(plan.candidates.map((c) => c.name)).not.toContain("ghcr.io/org/pinned:<none>");
    });

    it("keeps an image that a compose file names with a digest", () => {
        const resources = protectedResources({ repositories: [ "ghcr.io/org/pinned" ] });
        const plan = selectImageCandidates(rows, inUse(), resources, false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("ghcr.io/org/pinned:<none>");
    });

    it("keeps an image that a compose file builds", () => {
        const resources = protectedResources({ repositories: [ "web-api" ] });
        const plan = selectImageCandidates(rows, inUse(), resources, false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("web-api:latest");
    });

    it("keeps an image that a compose file of this server names", () => {
        const plan = selectImageCandidates(rows, inUse(), protectedResources({ images: [ "nginx:alpine" ] }), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("nginx:alpine");
    });

    it("reads the name of an image of a different registry", () => {
        const plan = selectImageCandidates(rows, inUse(), protectedResources({ images: [ "ghcr.io/org/app:v1" ] }), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("ghcr.io/org/app:v1");
    });

    it("gives one name to two forms of one image", () => {
        const plan = selectImageCandidates(rows, inUse(), protectedResources({ images: [ "docker.io/library/nginx:alpine" ] }), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("nginx:alpine");
    });

    it("keeps an image that a container uses, also a container that is stopped", () => {
        const plan = selectImageCandidates(rows, inUse({ images: [ "333333333333" ] }), protectedResources(), false);
        expect(plan.candidates.map((c) => c.name)).not.toContain("redis:7");
    });

    it("removes an image that no container and no compose file uses", () => {
        const resources = protectedResources({
            images: [ "nginx:alpine" ],
            repositories: [ "ghcr.io/org/pinned", "web-api" ],
        });
        const plan = selectImageCandidates(rows, inUse(), resources, false);
        expect(plan.candidates.map((c) => c.name)).toEqual([ "<none>:<none>", "redis:7", "ghcr.io/org/app:v1" ]);
    });

    it("gives the id of an image without a tag to the remove command", () => {
        const plan = selectImageCandidates(rows, inUse(), protectedResources(), false);
        const dangling = plan.candidates.find((c) => c.name === "<none>:<none>");
        const pinned = plan.candidates.find((c) => c.name === "ghcr.io/org/pinned:<none>");
        expect(dangling?.id).toBe("111111111111");
        expect(pinned?.id).toBe("555555555555");
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
