import { promises as fsAsync } from "fs";
import os from "os";
import path from "path";
import { log } from "./log";
import { CachedCall } from "./utils/cached-call";

/** Accept both multi-platform indexes and single-image manifests. */
const ACCEPT_MANIFEST = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
].join(",");

/** Some registries refuse requests without a user agent. */
const USER_AGENT = "dockge-mod";

/** The API host of Docker Hub */
export const DOCKER_HUB_HOST = "registry-1.docker.io";

/** The legacy key that config.json uses for Docker Hub */
export const DOCKER_HUB_CONFIG_KEY = "https://index.docker.io/v1/";

/**
 * Docker Hub hosts. Its token service has a different host than its
 * registry, so credentials may be sent between any of these.
 */
const DOCKER_HUB_HOSTS = new Set([
    DOCKER_HUB_HOST,
    "index.docker.io",
    "docker.io",
    "auth.docker.io",
]);

/** A sha256 image digest */
export const DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

/** The characters that docker accepts in a repository name */
const REPOSITORY_REGEX = /^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*(\/[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*)*$/;

/** The characters that docker accepts in a tag */
const TAG_REGEX = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * A host name or bracketed IPv6 address, with an optional port. It goes
 * into a URL, so characters like # or ? that would change the path are refused.
 */
const HOST_REGEX = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*)(:[0-9]{1,5})?$/;

/** The parts of an image name. */
export interface ImageRef {
    /** e.g. ghcr.io */
    registry : string;
    /** e.g. library/nginx */
    repository : string;
    /** e.g. latest */
    tag : string;
    /** The digest if the name has one, e.g. sha256:abc */
    digest : string | null;
}

/**
 * Split an image name using docker's rules: a first segment with a dot,
 * a colon, or "localhost" is the registry. No registry means Docker Hub,
 * and a bare name gets the library/ prefix.
 * @param image The image name from a compose file
 * @returns The parts of the name
 */
export function parseImageRef(image : string) : ImageRef {
    let rest = (image ?? "").trim();
    if (rest === "") {
        throw new Error("The image name is empty");
    }

    let digest : string | null = null;
    const at = rest.lastIndexOf("@");
    if (at >= 0) {
        const text = rest.slice(at + 1);
        // A non-digest after @ is left as null; later checks refuse the name.
        digest = DIGEST_REGEX.test(text) ? text : null;
        rest = rest.slice(0, at);
    }

    let registry = "";
    let remainder = rest;
    const slash = rest.indexOf("/");
    if (slash >= 0) {
        const head = rest.slice(0, slash);
        if (head === "localhost" || head.includes(".") || head.includes(":")) {
            registry = head;
            remainder = rest.slice(slash + 1);
        }
    }

    let tag = "";
    const colon = remainder.lastIndexOf(":");
    if (colon >= 0 && !remainder.slice(colon + 1).includes("/")) {
        tag = remainder.slice(colon + 1);
        remainder = remainder.slice(0, colon);
    }

    if (remainder === "") {
        throw new Error("The image name has no repository");
    }

    if (registry === "" || registry === "docker.io" || registry === "index.docker.io") {
        registry = DOCKER_HUB_HOST;
        if (!remainder.includes("/")) {
            remainder = "library/" + remainder;
        }
    }

    return {
        registry,
        repository: remainder,
        tag: tag === "" ? "latest" : tag,
        digest,
    };
}

/**
 * The full registry/repository:tag name. Different spellings of one
 * image give the same text, so it works as a lookup key.
 * @param ref The parts of the name
 * @returns The full name
 */
export function canonicalRef(ref : ImageRef) : string {
    return ref.registry + "/" + ref.repository + ":" + ref.tag;
}

/** A parsed WWW-Authenticate header. */
export interface AuthChallenge {
    /** Lowercase scheme, e.g. bearer */
    scheme : string;
    /** Parameters, with lowercase names */
    params : Record<string, string>;
}

/**
 * Parse a WWW-Authenticate header, e.g. Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
 * @param header The value of the header
 * @returns The scheme and the parameters, or null for an empty header
 */
export function parseAuthChallenge(header : string) : AuthChallenge | null {
    const text = (header ?? "").trim();
    if (text === "") {
        return null;
    }

    const space = text.indexOf(" ");
    const scheme = (space < 0 ? text : text.slice(0, space)).toLowerCase();
    const params : Record<string, string> = {};

    if (space >= 0) {
        const body = text.slice(space + 1);
        const regex = /([A-Za-z0-9_-]+)="([^"]*)"/g;
        let match = regex.exec(body);
        while (match !== null) {
            params[match[1].toLowerCase()] = match[2];
            match = regex.exec(body);
        }
    }

    return {
        scheme,
        params,
    };
}

/**
 * The config.json keys a registry may be stored under. Docker stores Docker
 * Hub credentials under a legacy key, not the API host.
 * @param registry The host of the registry
 * @returns The keys to try, in order
 */
export function credentialKeys(registry : string) : string[] {
    if (registry === DOCKER_HUB_HOST) {
        return [
            DOCKER_HUB_CONFIG_KEY,
            "index.docker.io",
            "docker.io",
            DOCKER_HUB_HOST,
        ];
    }
    return [
        registry,
        "https://" + registry,
        "http://" + registry,
    ];
}

/**
 * True if a registry's credentials may be sent to this token service. The
 * registry names the service itself, so a hostile one could point elsewhere.
 * @param registry The host of the registry
 * @param realmHost The host of the token service
 * @returns True if the credentials may be sent
 */
export function realmAcceptsCredential(registry : string, realmHost : string) : boolean {
    // The URL parser lowercases the host and drops the default port
    if (registry.toLowerCase().replace(/:443$/, "") === realmHost.toLowerCase()) {
        return true;
    }
    return DOCKER_HUB_HOSTS.has(registry) && DOCKER_HUB_HOSTS.has(realmHost);
}

/** One entry of "auths" in config.json */
export interface DockerAuthEntry {
    auth? : string;
    username? : string;
    password? : string;
    identitytoken? : string;
}

/** The fields of ~/.docker/config.json used here */
export interface DockerConfig {
    auths? : Record<string, DockerAuthEntry>;
    credsStore? : string;
    credHelpers? : Record<string, string>;
}

/** A credential lookup result. Helper secrets live outside config.json and cannot be read here. */
export type CredentialLookup =
    | { kind : "none" }
    | { kind : "basic", username : string, password : string }
    | { kind : "helper", helper : string };

/**
 * Find a registry's credentials in config.json.
 * @param config The content of config.json
 * @param registry The host of the registry
 * @returns The credentials, or the name of the helper that holds them
 */
export function findCredential(config : DockerConfig, registry : string) : CredentialLookup {
    const keys = credentialKeys(registry);

    for (const key of keys) {
        const helper = config.credHelpers?.[key];
        if (helper) {
            return {
                kind: "helper",
                helper,
            };
        }
    }

    for (const key of keys) {
        const entry = config.auths?.[key];
        if (!entry) {
            continue;
        }

        // Identity tokens need an OAuth exchange, which is not supported
        if (entry.identitytoken) {
            return {
                kind: "helper",
                helper: "identitytoken",
            };
        }

        if (typeof entry.auth === "string" && entry.auth !== "") {
            const text = Buffer.from(entry.auth, "base64").toString("utf-8");
            const colon = text.indexOf(":");
            if (colon > 0) {
                return {
                    kind: "basic",
                    username: text.slice(0, colon),
                    password: text.slice(colon + 1),
                };
            }
        }

        if (entry.username && entry.password) {
            return {
                kind: "basic",
                username: entry.username,
                password: entry.password,
            };
        }

        // An entry without a secret means the credsStore helper holds it
        if (config.credsStore) {
            return {
                kind: "helper",
                helper: config.credsStore,
            };
        }
    }

    return {
        kind: "none",
    };
}

/**
 * The registry did not give a digest. A registry-wide error (unreachable,
 * rate limited, unsupported auth) skips that registry's remaining images
 * for the rest of the check, so one bad registry cannot stall it or keep
 * hitting a rate limit.
 */
export class RegistryError extends Error {
    readonly registryWide : boolean;

    /** True if not tried because of an earlier registry-wide error */
    readonly skipped : boolean;

    constructor(message : string, registryWide = false, skipped = false) {
        super(message);
        this.registryWide = registryWide;
        this.skipped = skipped;
    }
}

/**
 * Reads image digests with a HEAD request on the manifest. Docker Hub does
 * not count a HEAD against the pull limit; a GET (as used by `docker
 * manifest inspect` and `buildx imagetools`) counts as a pull.
 */
export class RegistryClient {

    /** Per-request timeout, in milliseconds */
    static readonly TIMEOUT = 15000;

    /** How long config.json stays cached */
    static readonly CONFIG_TTL = 5 * 60 * 1000;

    private tokens : Map<string, { token : string, expires : number }> = new Map();

    private configCache = new CachedCall(() => RegistryClient.readConfig(), RegistryClient.CONFIG_TTL);

    /** Registry-wide errors in the current check, by registry */
    private failedRegistries : Map<string, string> = new Map();

    /** Start a new check, so every registry is tried again. */
    reset() {
        this.failedRegistries.clear();
        this.tokens.clear();
        this.configCache.invalidate();
    }

    /**
     * Get the registry's digest for an image tag.
     * @param image The image name from a compose file
     * @returns The digest, e.g. sha256:abc
     * @throws RegistryError if the registry gives no digest
     */
    async getDigest(image : string) : Promise<string> {
        const ref = parseImageRef(image);

        if (ref.digest !== null) {
            throw new Error("The image name holds a digest");
        }
        if (!HOST_REGEX.test(ref.registry)) {
            throw new Error("The registry name is not correct");
        }
        if (!REPOSITORY_REGEX.test(ref.repository) || !TAG_REGEX.test(ref.tag)) {
            throw new Error("The image name is not correct");
        }
        const earlier = this.failedRegistries.get(ref.registry);
        if (earlier !== undefined) {
            throw new RegistryError("Skipped after an earlier error: " + earlier, false, true);
        }

        // Make sure the parsed URL host matches the registry name, so the
        // credentials and token cannot go to a different host.
        const url = new URL("https://" + ref.registry + "/v2/" + ref.repository + "/manifests/" + ref.tag);
        // The URL parser drops the default port, so registry:443 is registry
        const expectedHost = ref.registry.toLowerCase().replace(/:443$/, "");
        if (url.host !== expectedHost || url.username !== "" || url.search !== "" || url.hash !== "") {
            throw new Error("The registry name is not correct");
        }

        try {
            return await this.readDigest(ref, url.toString());
        } catch (e) {
            if (e instanceof RegistryError && e.registryWide) {
                this.failedRegistries.set(ref.registry, e.message);
            }
            throw e;
        }
    }

    /**
     * Ask the registry for the digest. The caller validates the name.
     * @param ref The parts of the image name
     * @param url The full URL of the manifest
     * @returns The digest
     */
    private async readDigest(ref : ImageRef, url : string) : Promise<string> {
        let res = await this.head(ref, url);

        if (res.status === 401) {
            const challenge = parseAuthChallenge(res.headers.get("www-authenticate") ?? "");
            let credential = await this.credential(ref.registry);

            // Credential helpers are not supported (their binaries are not in
            // the image). Try anonymously, and report the helper only if refused.
            const helper = credential.kind === "helper" ? credential.helper : null;
            if (credential.kind === "helper") {
                credential = { kind: "none" };
            }
            const helperError = () => new RegistryError("The credentials of " + ref.registry + " are in the credential helper " + helper + ", which is not supported");

            if (challenge === null) {
                throw new RegistryError(ref.registry + " gave no authentication challenge", true);
            }

            if (challenge.scheme === "bearer") {
                let token : string;
                try {
                    token = await this.bearerToken(ref, challenge, credential);
                } catch (e) {
                    if (helper !== null && e instanceof RegistryError && !e.registryWide) {
                        throw helperError();
                    }
                    throw e;
                }
                res = await this.head(ref, url, "Bearer " + token);
            } else if (challenge.scheme === "basic" && credential.kind === "basic") {
                res = await this.head(ref, url, "Basic " + basic(credential.username, credential.password));
            } else if (helper !== null) {
                throw helperError();
            } else {
                throw new RegistryError(ref.registry + " needs the unsupported authentication scheme " + challenge.scheme, true);
            }

            if (helper !== null && [ 401, 403, 404 ].includes(res.status)) {
                throw helperError();
            }
        }

        if (res.status === 429) {
            throw new RegistryError(ref.registry + " rate limit reached (HTTP 429)", true);
        }
        if (!res.ok) {
            throw new RegistryError(ref.registry + " answered with HTTP " + res.status);
        }

        const digest = res.headers.get("docker-content-digest") ?? "";
        if (!DIGEST_REGEX.test(digest)) {
            throw new RegistryError(ref.registry + " gave no digest header", true);
        }

        return digest;
    }

    /**
     * HEAD request. Network and certificate failures are registry-wide.
     * For a private CA, set NODE_EXTRA_CA_CERTS.
     * @param ref The parts of the image name
     * @param url The full URL
     * @param authorization The value of the Authorization header
     * @returns The response
     */
    private async head(ref : ImageRef, url : string, authorization? : string) : Promise<Response> {
        const headers : Record<string, string> = {
            "Accept": ACCEPT_MANIFEST,
            "User-Agent": USER_AGENT,
        };
        if (authorization !== undefined) {
            headers.Authorization = authorization;
        }

        try {
            return await this.fetchWithTimeout(url, {
                method: "HEAD",
                headers,
                redirect: "follow",
            }, true);
        } catch (e) {
            throw new RegistryError("Cannot reach " + ref.registry + ": " + (e as Error).message, true);
        }
    }

    /**
     * Get a bearer token for one repository. Tokens are cached until they
     * expire, so checking many images on one registry needs few requests.
     * @param ref The parts of the image name
     * @param challenge The registry's auth challenge
     * @param credential The credentials, or none for a public image
     * @returns The token
     */
    private async bearerToken(ref : ImageRef, challenge : AuthChallenge, credential : CredentialLookup) : Promise<string> {
        const realm = challenge.params.realm ?? "";
        let realmURL : URL;
        try {
            realmURL = new URL(realm);
        } catch (e) {
            throw new RegistryError(ref.registry + " gave no realm for the token", true);
        }
        if (realmURL.protocol !== "https:") {
            throw new RegistryError(ref.registry + " gave a realm that is not https", true);
        }

        // The registry picks the token service, so do not send its
        // credentials to an unrelated host.
        let sendCredential = credential;
        if (credential.kind === "basic" && !realmAcceptsCredential(ref.registry, realmURL.host)) {
            log.warn("registry", ref.registry + " asks for the credentials at " + realmURL.host + ", thus this request goes without them");
            sendCredential = { kind: "none" };
        }

        const scope = challenge.params.scope ?? ("repository:" + ref.repository + ":pull");
        const service = challenge.params.service ?? "";
        const key = [
            ref.registry,
            realmURL.host,
            service,
            scope,
            sendCredential.kind === "basic" ? sendCredential.username : "",
        ].join("|");

        const cached = this.tokens.get(key);
        if (cached && cached.expires > Date.now()) {
            return cached.token;
        }

        realmURL.searchParams.set("scope", scope);
        if (service !== "") {
            realmURL.searchParams.set("service", service);
        }

        const headers : Record<string, string> = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        };
        if (sendCredential.kind === "basic") {
            headers.Authorization = "Basic " + basic(sendCredential.username, sendCredential.password);
        }

        let res : Response;
        try {
            // Do not follow redirects, so the credentials cannot be sent elsewhere
            res = await this.fetchWithTimeout(realmURL.toString(), {
                method: "GET",
                headers,
                redirect: "manual",
            }, false);
        } catch (e) {
            throw new RegistryError("Cannot reach the token service of " + ref.registry + ": " + (e as Error).message, true);
        }

        if (!res.ok) {
            // Drain the body so the connection returns to the pool
            await res.arrayBuffer().catch(() => undefined);
            throw new RegistryError("The token service of " + ref.registry + " answered with HTTP " + res.status, res.status === 429);
        }

        const body = await res.json().catch(() => null) as { token? : string, access_token? : string, expires_in? : number } | null;
        const token = body?.token ?? body?.access_token;
        if (!token) {
            throw new RegistryError("The token service of " + ref.registry + " gave no token", true);
        }

        // Default to 60s, and expire 10s early so the token does not lapse mid-request
        const seconds = typeof body?.expires_in === "number" && body.expires_in > 30 ? body.expires_in : 60;
        this.tokens.set(key, {
            token,
            expires: Date.now() + (seconds - 10) * 1000,
        });

        // Keep the cache bounded
        if (this.tokens.size > 500) {
            this.tokens.clear();
        }

        return token;
    }

    /**
     * fetch with a timeout, for registries that accept the connection
     * but never answer.
     * @param url The full URL
     * @param init The request options
     * @param drain True to read and discard the response body here
     * @returns The response
     */
    private async fetchWithTimeout(url : string, init : RequestInit, drain : boolean) : Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RegistryClient.TIMEOUT);
        try {
            const res = await fetch(url, {
                ...init,
                signal: controller.signal,
            });
            // An unread body keeps its connection out of the pool until GC
            if (drain) {
                await res.arrayBuffer().catch(() => undefined);
            }
            return res;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * A registry's credentials from config.json.
     * @param registry The host of the registry
     * @returns The credentials, the helper name, or none
     */
    private async credential(registry : string) : Promise<CredentialLookup> {
        return findCredential(await this.configCache.get(), registry);
    }

    /**
     * Read ~/.docker/config.json. A missing file gives an empty config,
     * which is fine for public images.
     * @returns The configuration
     */
    private static async readConfig() : Promise<DockerConfig> {
        const dir = process.env.DOCKER_CONFIG || path.join(os.homedir(), ".docker");

        try {
            return JSON.parse(await fsAsync.readFile(path.join(dir, "config.json"), "utf-8"));
        } catch (e) {
            // JSON errors quote part of the file, which may be a credential,
            // so only log the error code or name.
            const code = (e as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") {
                log.debug("registry", "Cannot read the docker configuration: " + (code ?? (e as Error).name));
            }
            return {};
        }
    }
}

/**
 * A Basic authorization header value.
 * @param username The user
 * @param password The password
 * @returns The base64 text
 */
function basic(username : string, password : string) : string {
    return Buffer.from(username + ":" + password, "utf-8").toString("base64");
}
