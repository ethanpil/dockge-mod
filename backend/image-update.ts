import { R } from "redbean-node";
import childProcessAsync from "promisify-child-process";
import { log } from "./log";
import { DOCKER_SPAWN_OPTIONS, errorMessage } from "./util-server";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";
import { Notifier } from "./notification";

/**
 * One row of the mod_image_update table, for the interface.
 */
export interface ImageUpdate {
    image : string;
    localDigest : string | null;
    remoteDigest : string | null;
    updateAvailable : boolean;
    checkedAt : string | null;
    error : string | null;
}

/**
 * The digest part of a repo digest such as "nginx@sha256:abc".
 * @param repoDigest The repo digest from docker image inspect
 * @returns The digest, or the full text when it has no @
 */
function digestOf(repoDigest : string) : string {
    const at = repoDigest.indexOf("@");
    return at >= 0 ? repoDigest.slice(at + 1) : repoDigest;
}

/**
 * True when the local image is the image of the registry. A local image
 * can have more than one repo digest, for example one for each tag.
 * @param localRepoDigests The RepoDigests of docker image inspect
 * @param remoteDigest The digest of docker manifest inspect
 * @returns True when one local digest is the remote digest
 */
export function digestsMatch(localRepoDigests : string[], remoteDigest : string) : boolean {
    return localRepoDigests.some((repoDigest) => digestOf(repoDigest) === remoteDigest);
}

/**
 * Read the digest of the registry from `docker manifest inspect -v`. The
 * output is one object for a single image, or a list for a manifest
 * list. Each object has a Descriptor with the digest. For a list, the
 * digest of the list itself is not in the output, thus the result is
 * the digest of the first entry. A pull with the same platform gives
 * this digest in the RepoDigests too, thus the comparison is correct
 * for the platform of the host.
 * @param output The output of docker manifest inspect -v
 * @param platform The platform of the host, for example linux/amd64
 * @returns The digest, or null when the output has none
 */
export function parseManifestDigest(output : string, platform? : string) : string | null {
    let data : unknown;
    try {
        data = JSON.parse(output);
    } catch (e) {
        return null;
    }

    type Entry = { Descriptor? : { digest? : string, platform? : { os? : string, architecture? : string, variant? : string } } };
    const entries : Entry[] = Array.isArray(data) ? data : [ data as Entry ];

    if (platform) {
        const [ os, architecture, variant ] = platform.split("/");
        const match = entries.find((entry) => {
            const p = entry.Descriptor?.platform;
            return p && p.os === os && p.architecture === architecture && (!variant || !p.variant || p.variant === variant);
        });
        if (match?.Descriptor?.digest) {
            return match.Descriptor.digest;
        }
    }

    return entries[0]?.Descriptor?.digest ?? null;
}

/**
 * The check for new image versions. It reads the digest of each image of
 * the managed stacks from the registry and compares it with the local
 * image. The results go in the mod_image_update table, and a set in
 * memory gives the stack list its count.
 */
export class ImageUpdateChecker {

    /** The time between two checks, in milliseconds */
    static readonly INTERVAL = 6 * 60 * 60 * 1000;

    /** The images with a new version, from the last check */
    static available : Set<string> = new Set();

    private server : DockgeServer;
    private running = false;
    private timer? : NodeJS.Timeout;
    private platform? : string;

    constructor(server : DockgeServer) {
        this.server = server;
    }

    /**
     * Load the last results from the table, then check at each interval.
     * The first check comes two minutes after the start, thus the start
     * of the server stays fast.
     */
    async start() {
        await this.loadAvailable();
        this.timer = setInterval(() => {
            this.checkAll().catch((e) => {
                log.warn("imageUpdate", "Check failed: " + errorMessage(e));
            });
        }, ImageUpdateChecker.INTERVAL);
        setTimeout(() => {
            this.checkAll().catch((e) => {
                log.warn("imageUpdate", "Check failed: " + errorMessage(e));
            });
        }, 2 * 60 * 1000);
    }

    stop() {
        clearInterval(this.timer);
    }

    isRunning() : boolean {
        return this.running;
    }

    async loadAvailable() {
        const rows = await R.knex("mod_image_update").where({ update_available: true }).select("image");
        ImageUpdateChecker.available = new Set(rows.map((row : { image : string }) => row.image));
    }

    /**
     * The results of the last check.
     * @returns One entry for each image
     */
    static async getAll() : Promise<ImageUpdate[]> {
        const rows = await R.knex("mod_image_update").orderBy("image").select();
        return rows.map((row : Record<string, unknown>) => ({
            image: row.image as string,
            localDigest: (row.local_digest as string) ?? null,
            remoteDigest: (row.remote_digest as string) ?? null,
            updateAvailable: Boolean(row.update_available),
            checkedAt: (row.checked_at as string) ?? null,
            error: (row.error as string) ?? null,
        }));
    }

    /**
     * Check each image of the managed stacks. One check runs at a time.
     * @returns True when the check ran, false when one was in progress
     */
    async checkAll() : Promise<boolean> {
        if (this.running) {
            return false;
        }
        this.running = true;
        try {
            const images = await this.collectImages();
            log.info("imageUpdate", "Check " + images.size + " images");

            const newUpdates : string[] = [];
            for (const image of images) {
                const wasAvailable = ImageUpdateChecker.available.has(image);
                const row = await this.check(image);
                if (row.updateAvailable) {
                    ImageUpdateChecker.available.add(image);
                    if (!wasAvailable) {
                        newUpdates.push(image);
                    }
                } else {
                    ImageUpdateChecker.available.delete(image);
                }
            }

            // Remove the rows of images that no stack uses now
            if (images.size > 0) {
                await R.knex("mod_image_update").whereNotIn("image", [ ...images ]).del();
            } else {
                await R.knex("mod_image_update").del();
            }
            for (const image of [ ...ImageUpdateChecker.available ]) {
                if (!images.has(image)) {
                    ImageUpdateChecker.available.delete(image);
                }
            }

            if (newUpdates.length > 0) {
                await Notifier.send("image_update", "New image versions", "A new version is available for: " + newUpdates.join(", "));
            }

            // The stack list shows the count
            this.server.sendStackList(true).catch(() => undefined);
            return true;
        } finally {
            this.running = false;
        }
    }

    /**
     * The images of the managed stacks. An image with a variable in its
     * name gets the value from the .env file of the stack.
     * @returns The unique image names
     */
    async collectImages() : Promise<Set<string>> {
        const images = new Set<string>();
        const stackList = await Stack.getStackList(this.server, true);
        for (const stack of stackList.values()) {
            if (!stack.isManagedByDockge) {
                continue;
            }
            for (const image of stack.images) {
                images.add(image);
            }
        }
        return images;
    }

    /**
     * Check one image and write the result.
     * @param image The image name, with or without a tag
     * @returns The result
     */
    async check(image : string) : Promise<ImageUpdate> {
        const result : ImageUpdate = {
            image,
            localDigest: null,
            remoteDigest: null,
            updateAvailable: false,
            checkedAt: new Date().toISOString(),
            error: null,
        };

        try {
            const local = await childProcessAsync.spawn("docker", [ "image", "inspect", "--format", "{{json .RepoDigests}}", image ], DOCKER_SPAWN_OPTIONS);
            const repoDigests : string[] = JSON.parse(local.stdout?.toString().trim() || "[]");

            if (repoDigests.length === 0) {
                // A local build has no repo digest, and no registry version
                result.error = "The image has no registry digest";
            } else {
                result.localDigest = digestOf(repoDigests[0]);

                if (!this.platform) {
                    const info = await childProcessAsync.spawn("docker", [ "version", "--format", "{{.Server.Os}}/{{.Server.Arch}}" ], DOCKER_SPAWN_OPTIONS);
                    this.platform = info.stdout?.toString().trim() || undefined;
                }

                const remote = await childProcessAsync.spawn("docker", [ "manifest", "inspect", "-v", image ], {
                    ...DOCKER_SPAWN_OPTIONS,
                    timeout: 60000,
                });
                const remoteDigest = parseManifestDigest(remote.stdout?.toString() ?? "", this.platform);
                if (!remoteDigest) {
                    result.error = "The registry gave no digest";
                } else {
                    result.remoteDigest = remoteDigest;
                    result.updateAvailable = !digestsMatch(repoDigests, remoteDigest);
                }
            }
        } catch (e) {
            // For example, a private registry without credentials, or no
            // network. The error text goes to the interface.
            result.error = (errorMessage(e) || "Check failed").split("\n")[0].slice(0, 500);
            log.debug("imageUpdate", image + ": " + result.error);
        }

        await R.knex("mod_image_update").insert({
            image: result.image,
            local_digest: result.localDigest,
            remote_digest: result.remoteDigest,
            update_available: result.updateAvailable,
            checked_at: result.checkedAt,
            error: result.error,
        }).onConflict("image").merge();

        return result;
    }
}
