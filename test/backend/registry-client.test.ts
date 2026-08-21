import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { RegistryClient, RegistryFallbackError } from "../../backend/registry";

const DIGEST = "sha256:" + "a".repeat(64);
const OTHER_DIGEST = "sha256:" + "b".repeat(64);

/**
 * Make an answer of a registry.
 * @param status The HTTP status
 * @param headers The headers
 * @param body The body, for a token answer
 * @returns The answer
 */
function answer(status : number, headers : Record<string, string> = {}, body? : object) : Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers,
    });
}

/** An answer with a digest header */
const digestAnswer = () => answer(200, { "docker-content-digest": DIGEST });

/** A challenge of a registry that needs a bearer token */
const challengeAnswer = (realm : string, service = "reg") => answer(401, {
    "www-authenticate": "Bearer realm=\"" + realm + "\",service=\"" + service + "\",scope=\"repository:o/a:pull\"",
});

/** An answer of a token service */
const tokenAnswer = (token = "tok", expiresIn = 300) => answer(200, { "content-type": "application/json" }, {
    token,
    expires_in: expiresIn,
});

describe("RegistryClient", () => {
    let calls : { url : string, init : RequestInit }[];
    let configDir : string;

    beforeEach(() => {
        calls = [];
        configDir = fs.mkdtempSync(path.join(os.tmpdir(), "dockge-cfg-"));
        process.env.DOCKER_CONFIG = configDir;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.DOCKER_CONFIG;
        fs.rmSync(configDir, {
            recursive: true,
            force: true,
        });
    });

    /**
     * Answer each request with the next item of the list.
     * @param answers The answers, in sequence
     */
    function stubFetch(answers : (Response | Error)[]) {
        let index = 0;
        vi.stubGlobal("fetch", vi.fn(async (url : string, init : RequestInit) => {
            calls.push({
                url: url.toString(),
                init,
            });
            const next = answers[index++];
            if (next === undefined) {
                throw new Error("No answer for the request " + url);
            }
            if (next instanceof Error) {
                throw next;
            }
            return next;
        }));
    }

    /**
     * Write a configuration file for the tests.
     * @param config The content
     */
    function writeConfig(config : object) {
        fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(config));
    }

    it("reads the digest of a public image", async () => {
        stubFetch([ digestAnswer() ]);
        const client = new RegistryClient();

        expect(await client.getDigest("ghcr.io/o/a:v1")).toBe(DIGEST);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://ghcr.io/v2/o/a/manifests/v1");
        expect(calls[0].init.method).toBe("HEAD");

        const headers = calls[0].init.headers as Record<string, string>;
        expect(headers.Accept).toContain("application/vnd.oci.image.index.v1+json");
        expect(headers.Accept).toContain("application/vnd.docker.distribution.manifest.list.v2+json");
        expect(headers["User-Agent"]).toBeTruthy();
        expect(headers.Authorization).toBeUndefined();
    });

    it("gets a token after a challenge and asks again", async () => {
        stubFetch([
            challengeAnswer("https://ghcr.io/token"),
            tokenAnswer(),
            digestAnswer(),
        ]);
        const client = new RegistryClient();

        expect(await client.getDigest("ghcr.io/o/a:v1")).toBe(DIGEST);
        expect(calls).toHaveLength(3);

        const tokenURL = new URL(calls[1].url);
        expect(tokenURL.host).toBe("ghcr.io");
        expect(tokenURL.searchParams.get("scope")).toBe("repository:o/a:pull");
        expect(tokenURL.searchParams.get("service")).toBe("reg");
        expect((calls[2].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    });

    it("uses one token for two images of one registry", async () => {
        stubFetch([
            challengeAnswer("https://ghcr.io/token"),
            tokenAnswer(),
            digestAnswer(),
            challengeAnswer("https://ghcr.io/token"),
            answer(200, { "docker-content-digest": OTHER_DIGEST }),
        ]);
        const client = new RegistryClient();

        expect(await client.getDigest("ghcr.io/o/a:v1")).toBe(DIGEST);
        expect(await client.getDigest("ghcr.io/o/a:v2")).toBe(OTHER_DIGEST);

        // One token request for the two images
        const tokenCalls = calls.filter((call) => call.url.includes("/token"));
        expect(tokenCalls).toHaveLength(1);
    });

    it("does not give the token of one registry to a different registry", async () => {
        // The second registry answers with the same challenge as the first
        stubFetch([
            challengeAnswer("https://auth.example.com/token", "svc"),
            tokenAnswer("secret-token"),
            digestAnswer(),
            challengeAnswer("https://auth.example.com/token", "svc"),
            tokenAnswer("other-token"),
            answer(200, { "docker-content-digest": OTHER_DIGEST }),
        ]);
        const client = new RegistryClient();

        await client.getDigest("first.example.com/o/a:v1");
        await client.getDigest("second.example.com/o/a:v1");

        const tokenCalls = calls.filter((call) => call.url.includes("/token"));
        expect(tokenCalls).toHaveLength(2);
        // The second registry gets its own token, not the first one
        expect((calls[5].init.headers as Record<string, string>).Authorization).toBe("Bearer other-token");
    });

    it("keeps the credentials away from a token service of a different host", async () => {
        writeConfig({
            auths: {
                "evil.example.com": { auth: Buffer.from("user:pass").toString("base64") },
            },
        });
        stubFetch([
            challengeAnswer("https://attacker.example/token"),
            tokenAnswer(),
            digestAnswer(),
        ]);
        const client = new RegistryClient();

        await client.getDigest("evil.example.com/o/a:v1");

        // The token request goes out, but without the password
        expect((calls[1].init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it("gives the credentials to the token service of Docker Hub", async () => {
        writeConfig({
            auths: {
                "https://index.docker.io/v1/": { auth: Buffer.from("user:pass").toString("base64") },
            },
        });
        stubFetch([
            challengeAnswer("https://auth.docker.io/token", "registry.docker.io"),
            tokenAnswer(),
            digestAnswer(),
        ]);
        const client = new RegistryClient();

        await client.getDigest("user/app:v1");

        const headers = calls[1].init.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Basic " + Buffer.from("user:pass").toString("base64"));
    });

    it("goes to the docker CLI when a helper holds the credentials", async () => {
        writeConfig({
            auths: { "ghcr.io": {} },
            credsStore: "pass",
        });
        stubFetch([ challengeAnswer("https://ghcr.io/token") ]);
        const client = new RegistryClient();

        await expect(client.getDigest("ghcr.io/o/a:v1")).rejects.toThrow(RegistryFallbackError);
        // The client does not ask for a token that it cannot get
        expect(calls).toHaveLength(1);
    });

    it("goes to the docker CLI for a status that hides a private image", async () => {
        stubFetch([ answer(404) ]);
        const client = new RegistryClient();
        await expect(client.getDigest("ghcr.io/o/a:v1")).rejects.toThrow(RegistryFallbackError);
    });

    it("goes to the docker CLI when the answer has no digest header", async () => {
        stubFetch([ answer(200) ]);
        const client = new RegistryClient();
        await expect(client.getDigest("ghcr.io/o/a:v1")).rejects.toThrow(/no digest header/);
    });

    it("keeps a registry that cannot answer away from the next images", async () => {
        stubFetch([
            new Error("getaddrinfo ENOTFOUND"),
            digestAnswer(),
        ]);
        const client = new RegistryClient();

        await expect(client.getDigest("down.example.com/o/a:v1")).rejects.toThrow(RegistryFallbackError);
        // The second image of that registry makes no request
        await expect(client.getDigest("down.example.com/o/b:v1")).rejects.toThrow(/needed the docker CLI/);
        expect(calls).toHaveLength(1);
    });

    it("gives a registry with one bad answer a new try", async () => {
        stubFetch([
            answer(500),
            digestAnswer(),
        ]);
        const client = new RegistryClient();

        await expect(client.getDigest("ghcr.io/o/a:v1")).rejects.toThrow(RegistryFallbackError);
        // A status of the server is not a property of the registry
        expect(await client.getDigest("ghcr.io/o/b:v1")).toBe(DIGEST);
    });

    it("forgets the registries of the last check after a reset", async () => {
        stubFetch([
            new Error("connect ECONNREFUSED"),
            digestAnswer(),
        ]);
        const client = new RegistryClient();

        await expect(client.getDigest("down.example.com/o/a:v1")).rejects.toThrow(RegistryFallbackError);
        client.reset();
        expect(await client.getDigest("down.example.com/o/a:v1")).toBe(DIGEST);
    });

    it.each([
        [ "a name with a digest", "ghcr.io/o/a@" + DIGEST ],
        [ "a registry with a fragment", "evil.example.com#x/o/a" ],
        [ "a repository in upper case", "ghcr.io/O/A:v1" ],
        [ "a tag with a variable", "ghcr.io/o/a:${TAG}" ],
    ])("refuses %s without a request", async (name, image) => {
        stubFetch([ digestAnswer() ]);
        const client = new RegistryClient();

        const error = await client.getDigest(image).catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(RegistryFallbackError);
        expect(calls).toHaveLength(0);
    });
});
