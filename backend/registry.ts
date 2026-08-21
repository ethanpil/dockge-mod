import { promises as fsAsync } from "fs";
import os from "os";
import path from "path";
import { log } from "./log";

/**
 * The media types that a manifest request accepts. A registry gives the
 * index of a multi-platform image, or the manifest of a single image.
 */
const ACCEPT_MANIFEST = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
].join(",");

/** The API host of Docker Hub */
export const DOCKER_HUB_HOST = "registry-1.docker.io";

/** The key of Docker Hub in the configuration file. It is an old form. */
export const DOCKER_HUB_CONFIG_KEY = "https://index.docker.io/v1/";

/** A digest is a hash algorithm and a hexadecimal value */
const DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

/** The characters that docker accepts in a repository name */
const REPOSITORY_REGEX = /^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*(\/[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*)*$/;

/** The characters that docker accepts in a tag */
const TAG_REGEX = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * The parts of an image name.
 */
export interface ImageRef {
    /** The host of the registry, for example ghcr.io */
    registry : string;
    /** The path in the registry, for example library/nginx */
    repository : string;
    /** The tag, for example latest */
    tag : string;
    /** The digest when the name holds one, for example sha256:abc */
    digest : string | null;
}

/**
 * Divide an image name into its parts. The rules are the rules of
 * docker: a first part with a dot, a colon, or the name localhost is a
 * registry. A name without a registry is a name of Docker Hub, and a
 * name without a path gets the library path.
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
        digest = rest.slice(at + 1);
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

    if (registry === "" || registry === "docker.io" || registry === "index.docker.io") {
        registry = DOCKER_HUB_HOST;
        if (!remainder.includes("/")) {
            remainder = "library/" + remainder;
        }
    }

    if (remainder === "") {
        throw new Error("The image name has no repository");
    }

    return {
        registry,
        repository: remainder,
        tag: tag === "" ? "latest" : tag,
        digest,
    };
}

/**
 * The full name of an image, with the registry and the tag. Two names
 * of one image give the same text, thus a lookup can use it as a key.
 * @param ref The parts of the name
 * @returns The full name
 */
export function canonicalRef(ref : ImageRef) : string {
    return ref.registry + "/" + ref.repository + ":" + ref.tag;
}

/**
 * The scheme and the parameters of a WWW-Authenticate header.
 */
export interface AuthChallenge {
    /** The scheme in lower case, for example bearer */
    scheme : string;
    /** The parameters, with the names in lower case */
    params : Record<string, string>;
}

/**
 * Read a WWW-Authenticate header.
 * An example is: Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
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
        const regex = /([A-Za-z0-9_-]+)="([^"]*)"/g;
        let match = regex.exec(text.slice(space + 1));
        while (match !== null) {
            params[match[1].toLowerCase()] = match[2];
            match = regex.exec(text.slice(space + 1));
        }
    }

    return {
        scheme,
        params,
    };
}

/**
 * The names of a registry in the configuration file. Docker writes the
 * credentials of Docker Hub with an old key, thus a lookup with the API
 * host finds nothing.
 * @param registry The host of the registry
 * @returns The keys to examine, in sequence
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

/** One entry of the auths object of the configuration file */
export interface DockerAuthEntry {
    auth? : string;
    username? : string;
    password? : string;
    identitytoken? : string;
}

/** The parts of ~/.docker/config.json that this file reads */
export interface DockerConfig {
    auths? : Record<string, DockerAuthEntry>;
    credsStore? : string;
    credHelpers? : Record<string, string>;
}

/**
 * The result of a credential lookup. A helper keeps its secret outside
 * the configuration file, thus this process cannot read it.
 */
export type CredentialLookup =
    | { kind : "none" }
    | { kind : "basic", username : string, password : string }
    | { kind : "helper", helper : string };

/**
 * Find the credentials of a registry in the configuration file.
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

        // An identity token is a token of an OAuth exchange. The exchange
        // is not in this file.
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

        // An entry without a secret comes with a helper that holds it
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
 * The registry cannot answer this request, but a different method can.
 * The caller then runs the docker CLI, which has its own credentials
 * and its own trust for a registry with a private certificate.
 */
export class RegistryFallbackError extends Error {}

/**
 * A client that reads the digest of an image from its registry.
 *
 * The request is a HEAD of the manifest, and the answer holds the
 * digest in a header. Docker Hub does not count a HEAD in the pull
 * limit of the address, and a GET of the same manifest costs one pull.
 * The docker CLI makes a GET, thus a check of many images used the
 * limit of the user.
 */
export class RegistryClient {

    /** How long one request can take, in milliseconds */
    static readonly TIMEOUT = 15000;

    /** How long the content of config.json stays in memory */
    static readonly CONFIG_TTL = 5 * 60 * 1000;

    private tokens : Map<string, { token : string, expires : number }> = new Map();
    private config? : { data : DockerConfig, time : number };

    /** The registries that need the docker CLI. A failure marks one. */
    private fallbackRegistries : Set<string> = new Set();

    /**
     * Read the digest that the registry has for the tag of an image.
     * @param image The image name from a compose file
     * @returns The digest, for example sha256:abc
     * @throws RegistryFallbackError when the docker CLI must do this
     */
    async getDigest(image : string) : Promise<string> {
        const ref = parseImageRef(image);

        if (ref.digest !== null) {
            throw new Error("The image name holds a digest");
        }
        if (!REPOSITORY_REGEX.test(ref.repository) || !TAG_REGEX.test(ref.tag)) {
            throw new Error("The image name is not correct");
        }
        if (this.fallbackRegistries.has(ref.registry)) {
            throw new RegistryFallbackError("An earlier request to " + ref.registry + " needed the docker CLI");
        }

        const url = "https://" + ref.registry + "/v2/" + ref.repository + "/manifests/" + ref.tag;

        let res = await this.head(ref.registry, url);

        if (res.status === 401) {
            const challenge = parseAuthChallenge(res.headers.get("www-authenticate") ?? "");
            const credential = await this.credential(ref.registry);

            if (credential.kind === "helper") {
                throw new RegistryFallbackError("The credentials of " + ref.registry + " are in the helper " + credential.helper);
            }
            if (challenge === null) {
                throw new RegistryFallbackError(ref.registry + " gave no authentication challenge");
            }

            if (challenge.scheme === "bearer") {
                const token = await this.bearerToken(ref, challenge, credential);
                res = await this.head(ref.registry, url, "Bearer " + token);
            } else if (challenge.scheme === "basic" && credential.kind === "basic") {
                res = await this.head(ref.registry, url, "Basic " + basic(credential.username, credential.password));
            } else {
                throw new RegistryFallbackError(ref.registry + " needs the authentication scheme " + challenge.scheme);
            }
        }

        if (res.status === 404) {
            throw new Error("The registry does not have this image");
        }
        if (!res.ok) {
            this.fallbackRegistries.add(ref.registry);
            throw new RegistryFallbackError(ref.registry + " answered with the status " + res.status);
        }

        const digest = res.headers.get("docker-content-digest") ?? "";
        if (!DIGEST_REGEX.test(digest)) {
            this.fallbackRegistries.add(ref.registry);
            throw new RegistryFallbackError(ref.registry + " gave no digest header");
        }

        return digest;
    }

    /**
     * Make a HEAD request. A failure of the network or of the
     * certificate needs the docker CLI, which can trust a private
     * certificate and can use a mirror.
     * @param registry The host, for the fallback list
     * @param url The full URL
     * @param authorization The value of the Authorization header
     * @returns The answer
     */
    private async head(registry : string, url : string, authorization? : string) : Promise<Response> {
        const headers : Record<string, string> = {
            "Accept": ACCEPT_MANIFEST,
        };
        if (authorization !== undefined) {
            headers.Authorization = authorization;
        }

        try {
            return await this.fetchWithTimeout(url, {
                method: "HEAD",
                headers,
            });
        } catch (e) {
            this.fallbackRegistries.add(registry);
            throw new RegistryFallbackError("Cannot reach " + registry + ": " + (e as Error).message);
        }
    }

    /**
     * Get a bearer token for one repository. A token stays in memory
     * until it expires, thus one check of many images of one registry
     * makes few token requests.
     * @param ref The parts of the image name
     * @param challenge The answer of the registry
     * @param credential The credentials, or none for a public image
     * @returns The token
     */
    private async bearerToken(ref : ImageRef, challenge : AuthChallenge, credential : CredentialLookup) : Promise<string> {
        const realm = challenge.params.realm;
        if (!realm || !/^https:\/\//.test(realm)) {
            throw new RegistryFallbackError(ref.registry + " gave no realm for the token");
        }

        const scope = challenge.params.scope ?? ("repository:" + ref.repository + ":pull");
        const service = challenge.params.service ?? "";
        const key = realm + "|" + service + "|" + scope + "|" + (credential.kind === "basic" ? credential.username : "");

        const cached = this.tokens.get(key);
        if (cached && cached.expires > Date.now()) {
            return cached.token;
        }

        const url = new URL(realm);
        url.searchParams.set("scope", scope);
        if (service !== "") {
            url.searchParams.set("service", service);
        }

        const headers : Record<string, string> = {};
        if (credential.kind === "basic") {
            headers.Authorization = "Basic " + basic(credential.username, credential.password);
        }

        let res : Response;
        try {
            res = await this.fetchWithTimeout(url.toString(), {
                method: "GET",
                headers,
            });
        } catch (e) {
            this.fallbackRegistries.add(ref.registry);
            throw new RegistryFallbackError("Cannot reach the token service of " + ref.registry + ": " + (e as Error).message);
        }

        if (!res.ok) {
            throw new RegistryFallbackError("The token service of " + ref.registry + " answered with the status " + res.status);
        }

        const body = await res.json().catch(() => null) as { token? : string, access_token? : string, expires_in? : number } | null;
        const token = body?.token ?? body?.access_token;
        if (!token) {
            throw new RegistryFallbackError("The token service of " + ref.registry + " gave no token");
        }

        // A short life keeps the token good for the rest of the check
        const seconds = typeof body?.expires_in === "number" && body.expires_in > 30 ? body.expires_in : 60;
        this.tokens.set(key, {
            token,
            expires: Date.now() + (seconds - 10) * 1000,
        });

        // A large map cannot grow without a limit
        if (this.tokens.size > 500) {
            this.tokens.clear();
        }

        return token;
    }

    /**
     * A fetch with a time limit. The limit stops a registry that accepts
     * the connection and then gives no answer.
     * @param url The full URL
     * @param init The request options
     * @returns The answer
     */
    private async fetchWithTimeout(url : string, init : RequestInit) : Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RegistryClient.TIMEOUT);
        try {
            const res = await fetch(url, {
                ...init,
                signal: controller.signal,
                redirect: "follow",
            });
            // A HEAD has no body, but a token answer does. An unread body
            // keeps the connection out of the pool.
            if (init.method !== "GET") {
                await res.arrayBuffer().catch(() => undefined);
            }
            return res;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * The credentials of a registry from the configuration file.
     * @param registry The host of the registry
     * @returns The credentials, or the name of the helper, or none
     */
    private async credential(registry : string) : Promise<CredentialLookup> {
        return findCredential(await this.loadConfig(), registry);
    }

    /**
     * Read ~/.docker/config.json. A file that is not there gives an
     * empty configuration, thus a public image needs no file.
     * @returns The configuration
     */
    private async loadConfig() : Promise<DockerConfig> {
        const now = Date.now();
        if (this.config && now - this.config.time < RegistryClient.CONFIG_TTL) {
            return this.config.data;
        }

        const dir = process.env.DOCKER_CONFIG || path.join(os.homedir(), ".docker");
        let data : DockerConfig = {};

        try {
            data = JSON.parse(await fsAsync.readFile(path.join(dir, "config.json"), "utf-8"));
        } catch (e) {
            if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
                log.debug("registry", "Cannot read the docker configuration: " + (e as Error).message);
            }
            data = {};
        }

        this.config = {
            data,
            time: now,
        };
        return data;
    }
}

/**
 * The value of a Basic authorization header.
 * @param username The user
 * @param password The password
 * @returns The base64 text
 */
function basic(username : string, password : string) : string {
    return Buffer.from(username + ":" + password, "utf-8").toString("base64");
}
