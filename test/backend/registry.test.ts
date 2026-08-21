import { describe, expect, it } from "vitest";
import {
    canonicalRef,
    credentialKeys,
    DOCKER_HUB_CONFIG_KEY,
    DOCKER_HUB_HOST,
    findCredential,
    parseAuthChallenge,
    parseImageRef,
} from "../../backend/registry";

/**
 * The base64 of a user and a password, as docker writes it.
 * @param user The user
 * @param password The password
 * @returns The base64 text
 */
function auth(user : string, password : string) : string {
    return Buffer.from(user + ":" + password, "utf-8").toString("base64");
}

describe("parseImageRef", () => {
    it.each([
        [ "nginx", DOCKER_HUB_HOST, "library/nginx", "latest", null ],
        [ "nginx:alpine", DOCKER_HUB_HOST, "library/nginx", "alpine", null ],
        [ "user/app", DOCKER_HUB_HOST, "user/app", "latest", null ],
        [ "user/app:1.2", DOCKER_HUB_HOST, "user/app", "1.2", null ],
        [ "docker.io/library/nginx:alpine", DOCKER_HUB_HOST, "library/nginx", "alpine", null ],
        [ "index.docker.io/user/app", DOCKER_HUB_HOST, "user/app", "latest", null ],
        [ "ghcr.io/org/app:v1", "ghcr.io", "org/app", "v1", null ],
        [ "quay.io/prometheus/node-exporter:v1.8.2", "quay.io", "prometheus/node-exporter", "v1.8.2", null ],
        [ "localhost:5000/app", "localhost:5000", "app", "latest", null ],
        [ "registry.example.com:5000/a/b/c:tag", "registry.example.com:5000", "a/b/c", "tag", null ],
        [ "registry.example.com/a/b/c", "registry.example.com", "a/b/c", "latest", null ],
    ])("reads %j", (image, registry, repository, tag, digest) => {
        expect(parseImageRef(image)).toEqual({
            registry,
            repository,
            tag,
            digest,
        });
    });

    it("reads a name with a digest", () => {
        const sha = "sha256:" + "a".repeat(64);
        expect(parseImageRef("nginx@" + sha)).toEqual({
            registry: DOCKER_HUB_HOST,
            repository: "library/nginx",
            tag: "latest",
            digest: sha,
        });
        expect(parseImageRef("ghcr.io/org/app:v1@" + sha).digest).toBe(sha);
    });

    it("keeps the space out of the name", () => {
        expect(parseImageRef("  nginx:alpine  ").repository).toBe("library/nginx");
    });

    it.each([
        "",
        "   ",
    ])("refuses %j", (image) => {
        expect(() => parseImageRef(image)).toThrow();
    });
});

describe("canonicalRef", () => {
    it("gives the same text for two names of one image", () => {
        const a = canonicalRef(parseImageRef("nginx:alpine"));
        const b = canonicalRef(parseImageRef("docker.io/library/nginx:alpine"));
        expect(a).toBe(b);
        expect(a).toBe(DOCKER_HUB_HOST + "/library/nginx:alpine");
    });

    it("keeps two different images apart", () => {
        expect(canonicalRef(parseImageRef("nginx:alpine")))
            .not.toBe(canonicalRef(parseImageRef("nginx:latest")));
        expect(canonicalRef(parseImageRef("ghcr.io/org/app:v1")))
            .not.toBe(canonicalRef(parseImageRef("org/app:v1")));
    });
});

describe("parseAuthChallenge", () => {
    it("reads the parameters of a bearer challenge", () => {
        const header = "Bearer realm=\"https://auth.docker.io/token\",service=\"registry.docker.io\",scope=\"repository:library/nginx:pull\"";
        expect(parseAuthChallenge(header)).toEqual({
            scheme: "bearer",
            params: {
                realm: "https://auth.docker.io/token",
                service: "registry.docker.io",
                scope: "repository:library/nginx:pull",
            },
        });
    });

    it("reads a basic challenge", () => {
        expect(parseAuthChallenge("Basic realm=\"Registry\"")).toEqual({
            scheme: "basic",
            params: { realm: "Registry" },
        });
    });

    it("reads a scheme without parameters", () => {
        expect(parseAuthChallenge("Negotiate")).toEqual({
            scheme: "negotiate",
            params: {},
        });
    });

    it("gives null for an empty header", () => {
        expect(parseAuthChallenge("")).toBeNull();
        expect(parseAuthChallenge("   ")).toBeNull();
    });
});

describe("credentialKeys", () => {
    it("gives the old key of Docker Hub first", () => {
        expect(credentialKeys(DOCKER_HUB_HOST)[0]).toBe(DOCKER_HUB_CONFIG_KEY);
    });

    it("gives the host and the URL forms of a different registry", () => {
        const keys = credentialKeys("ghcr.io");
        expect(keys).toContain("ghcr.io");
        expect(keys).toContain("https://ghcr.io");
    });
});

describe("findCredential", () => {
    it("reads a base64 auth entry", () => {
        const config = {
            auths: {
                "ghcr.io": { auth: auth("user", "pass") },
            },
        };
        expect(findCredential(config, "ghcr.io")).toEqual({
            kind: "basic",
            username: "user",
            password: "pass",
        });
    });

    it("keeps a colon of the password", () => {
        const config = {
            auths: {
                "ghcr.io": { auth: auth("user", "a:b:c") },
            },
        };
        expect(findCredential(config, "ghcr.io")).toMatchObject({ password: "a:b:c" });
    });

    it("finds Docker Hub under its old key", () => {
        const config = {
            auths: {
                [DOCKER_HUB_CONFIG_KEY]: { auth: auth("user", "pass") },
            },
        };
        expect(findCredential(config, DOCKER_HUB_HOST)).toMatchObject({
            kind: "basic",
            username: "user",
        });
    });

    it("reads a username and a password without base64", () => {
        const config = {
            auths: {
                "ghcr.io": {
                    username: "user",
                    password: "pass",
                },
            },
        };
        expect(findCredential(config, "ghcr.io")).toEqual({
            kind: "basic",
            username: "user",
            password: "pass",
        });
    });

    it.each([
        [ "credsStore", {
            auths: { "ghcr.io": {} },
            credsStore: "pass",
        }],
        [ "credHelpers", {
            credHelpers: { "ghcr.io": "ecr-login" },
        }],
        [ "identitytoken", {
            auths: { "ghcr.io": { identitytoken: "abc" } },
        }],
    ])("says that a %s holds the secret", (name, config) => {
        expect(findCredential(config, "ghcr.io").kind).toBe("helper");
    });

    it("gives none for a registry without an entry", () => {
        expect(findCredential({}, "ghcr.io")).toEqual({ kind: "none" });
        expect(findCredential({ credsStore: "pass" }, "ghcr.io")).toEqual({ kind: "none" });
    });
});
