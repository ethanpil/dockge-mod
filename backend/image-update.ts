import { R } from "redbean-node";
import childProcessAsync from "promisify-child-process";
import { log } from "./log";
import { DOCKER_SPAWN_OPTIONS, errorMessage, stderrOf } from "./util-server";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";
import { Notifier } from "./notification";
import { canonicalRef, DIGEST_REGEX, parseImageRef, RegistryClient, RegistryFallbackError } from "./registry";

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
    /** How many checks of this image failed, one after the other */
    failures : number;
    /** The time of the next check, for an image that fails */
    nextCheck : string | null;
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

    /** The longest time between two checks of one image, in milliseconds */
    static readonly MAX_BACKOFF = 72 * 60 * 60 * 1000;

    /**
     * How long an image that fails waits for its next check. The time
     * doubles with each failure, one after the other.
     * @param failures The count of the failures
     * @returns The time, in milliseconds
     */
    static backoff(failures : number) : number {
        if (failures < 1) {
            return 0;
        }
        const time = ImageUpdateChecker.INTERVAL * Math.pow(2, failures - 1);
        return Math.min(time, ImageUpdateChecker.MAX_BACKOFF);
    }

    /** How many images the check reads from the registry at one time */
    static readonly CONCURRENCY = 4;

    private server : DockgeServer;
    private registry = new RegistryClient();
    private running = false;
    private timer? : NodeJS.Timeout;
    private firstTimer? : NodeJS.Timeout;

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
        this.firstTimer = setTimeout(() => {
            this.checkAll().catch((e) => {
                log.warn("imageUpdate", "Check failed: " + errorMessage(e));
            });
        }, 2 * 60 * 1000);
    }

    stop() {
        clearInterval(this.timer);
        clearTimeout(this.firstTimer);
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
            failures: Number(row.failures ?? 0),
            nextCheck: (row.next_check as string) ?? null,
        }));
    }

    /**
     * Check each image of the managed stacks. One check runs at a time.
     * @returns True when the check ran, false when one was in progress
     */
    async checkAll(force = false) : Promise<boolean> {
        if (this.running) {
            return false;
        }
        this.running = true;
        try {
            // A registry that had a problem in the last run gets a new try
            this.registry.reset();

            const images = await this.collectImages();

            // An image that fails each time waits longer for its next
            // check. A check that the user starts examines each image.
            const previous = new Map((await ImageUpdateChecker.getAll()).map((row) => [ row.image, row ]));
            const now = Date.now();
            const due = new Set([ ...images ].filter((image) => {
                if (force) {
                    return true;
                }
                const nextCheck = previous.get(image)?.nextCheck;
                return !nextCheck || new Date(nextCheck).getTime() <= now;
            }));

            log.info("imageUpdate", "Check " + due.size + " of " + images.size + " images");

            // The new set replaces the old set at the end, thus a stack
            // list that goes out during the check shows the old result,
            // not a mix of both.
            const next = new Set<string>();
            const newUpdates : string[] = [];

            // An image that this check leaves out keeps its last result
            for (const image of images) {
                if (!due.has(image) && ImageUpdateChecker.available.has(image)) {
                    next.add(image);
                }
            }

            const localDigests = await ImageUpdateChecker.readLocalDigests([ ...due ]);

            // No answer for any image means that docker did not answer,
            // not that the host has no image. The last results stay, thus
            // the badges do not go away and no message goes out.
            if (due.size > 0 && localDigests.size === 0) {
                log.warn("imageUpdate", "docker gave no image data, thus the check stops and the last results stay");
                return false;
            }

            const queue = [ ...due ];
            const worker = async () => {
                for (let image = queue.shift(); image !== undefined; image = queue.shift()) {
                    const row = await this.check(image, localDigests.get(ImageUpdateChecker.key(image)), previous.get(image));
                    if (row.updateAvailable) {
                        next.add(image);
                        if (!ImageUpdateChecker.available.has(image)) {
                            newUpdates.push(image);
                        }
                    }
                }
            };
            await Promise.all(Array.from({ length: ImageUpdateChecker.CONCURRENCY }, worker));

            // Remove the rows of images that no stack uses now
            if (images.size > 0) {
                await R.knex("mod_image_update").whereNotIn("image", [ ...images ]).del();
            } else {
                await R.knex("mod_image_update").del();
            }
            ImageUpdateChecker.available = next;

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
                try {
                    // A name with a digest names one image for ever. There
                    // is no tag to compare, thus there is nothing to check.
                    if (parseImageRef(image).digest !== null) {
                        continue;
                    }
                } catch (e) {
                    // A name that docker cannot read gets no check
                    continue;
                }
                images.add(image);
            }
        }
        return images;
    }

    /**
     * The key of an image in the map of readLocalDigests. Two names of
     * one image give the same key.
     * @param image The image name from a compose file
     * @returns The key, or the name when docker cannot read it
     */
    static key(image : string) : string {
        try {
            return canonicalRef(parseImageRef(image));
        } catch (e) {
            return image;
        }
    }

    /**
     * The repo digests of each image that is on this host. One docker
     * process reads all the images. An image that is not on the host is
     * not in the map.
     * @param images The image names
     * @returns The repo digests, by the key of the image
     */
    static async readLocalDigests(images : string[]) : Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        if (images.length === 0) {
            return map;
        }

        const parse = (out : string) => {
            for (const line of out.split("\n")) {
                const [ rawTags, rawDigests ] = line.split("\t");
                if (!rawTags || !rawDigests) {
                    continue;
                }
                try {
                    const tags : string[] = JSON.parse(rawTags) ?? [];
                    const digests : string[] = JSON.parse(rawDigests) ?? [];
                    for (const tag of tags) {
                        map.set(ImageUpdateChecker.key(tag), digests);
                    }
                } catch (e) {
                    // A line that is not JSON is not an image
                }
            }
        };

        // The two dashes end the flags of docker. An image name from a
        // compose file can start with a dash, and docker would read such
        // a name as a flag.
        const format = "{{json .RepoTags}}\t{{json .RepoDigests}}";
        try {
            const res = await childProcessAsync.spawn("docker", [ "image", "inspect", "--format", format, "--", ...images ], DOCKER_SPAWN_OPTIONS);
            parse(res.stdout?.toString() ?? "");
        } catch (e) {
            // An image that is not on the host makes docker exit with an
            // error, but the images that it found are still in the output.
            const partial = (e as { stdout ?: string | Buffer })?.stdout;
            if (partial) {
                parse(partial.toString());
            } else {
                log.debug("imageUpdate", "docker image inspect failed: " + errorMessage(e));
            }
        }

        return map;
    }

    /**
     * The digest that the registry has for the tag of an image. The
     * request goes to the registry, because a HEAD there does not count
     * in the pull limit of Docker Hub. The docker CLI does a GET, thus
     * it is the second method only.
     * @param image The image name
     * @returns The digest
     */
    private async remoteDigest(image : string) : Promise<string> {
        try {
            return await this.registry.getDigest(image);
        } catch (e) {
            if (!(e instanceof RegistryFallbackError)) {
                throw e;
            }
            log.debug("imageUpdate", image + ": " + e.message + ", the docker CLI does this one");
        }

        // This method reads a slow registry, for example one with a
        // private certificate, thus it gets more time than a usual
        // docker command.
        const remote = await childProcessAsync.spawn("docker", [ "buildx", "imagetools", "inspect", "--format", "{{.Manifest.Digest}}", "--", image ], {
            ...DOCKER_SPAWN_OPTIONS,
            timeout: 60000,
        });
        return remote.stdout?.toString().trim() ?? "";
    }

    /**
     * Check one image and write the result.
     * @param image The image name, with or without a tag
     * @param repoDigests The repo digests of the image on this host, or
     * undefined when the image is not on the host
     * @returns The result
     */
    async check(image : string, repoDigests : string[] | undefined, previous? : ImageUpdate) : Promise<ImageUpdate> {
        const result : ImageUpdate = {
            image,
            localDigest: null,
            remoteDigest: null,
            updateAvailable: false,
            checkedAt: new Date().toISOString(),
            error: null,
            failures: 0,
            nextCheck: null,
        };

        try {
            if (repoDigests === undefined) {
                // The batch gives the images by their tags. An image
                // without the tag of the compose file is not in that map,
                // thus one process reads this image again.
                const single = await ImageUpdateChecker.readLocalDigests([ image ]);
                repoDigests = single.get(ImageUpdateChecker.key(image));
            }

            if (repoDigests === undefined) {
                // A stack that never started has no image on the host
                result.error = "The image is not on this host";
            } else if (repoDigests.length === 0) {
                // A local build has no repo digest, and no registry version
                result.error = "The image has no registry digest";
            } else {
                result.localDigest = digestOf(repoDigests[0]);

                // The digest of the index, or of the manifest for an image
                // without an index. A pull by tag puts this digest in the
                // RepoDigests, on the classic store and on the containerd
                // store. The per-platform manifest digest is different,
                // thus it cannot be the comparison.
                const remoteDigest = await this.remoteDigest(image);
                if (!DIGEST_REGEX.test(remoteDigest)) {
                    result.error = "The registry gave no digest";
                } else {
                    result.remoteDigest = remoteDigest;
                    result.updateAvailable = !digestsMatch(repoDigests, remoteDigest);

                    if (result.updateAvailable) {
                        // A check of many images takes time. A pull during
                        // that time makes the digest of the batch old, and
                        // the image would show an update that it has.
                        const fresh = (await ImageUpdateChecker.readLocalDigests([ image ])).get(ImageUpdateChecker.key(image));
                        if (fresh !== undefined && fresh.length > 0) {
                            result.localDigest = digestOf(fresh[0]);
                            result.updateAvailable = !digestsMatch(fresh, remoteDigest);
                        }
                    }
                }
            }
        } catch (e) {
            // For example, a private registry without credentials, or no
            // network. The error text goes to the interface. The last
            // result stays, thus a short outage of the registry does not
            // remove the badges and does not send the message again.
            result.error = (stderrOf(e) || errorMessage(e) || "Check failed").split("\n")[0].slice(0, 500);
            result.updateAvailable = ImageUpdateChecker.available.has(image);
            log.debug("imageUpdate", image + ": " + result.error);
        }

        // An image with an error waits longer for its next check. An
        // image without an error goes back to the usual time.
        if (result.error !== null) {
            result.failures = (previous?.failures ?? 0) + 1;
            result.nextCheck = new Date(Date.now() + ImageUpdateChecker.backoff(result.failures)).toISOString();
        }

        await R.knex("mod_image_update").insert({
            image: result.image,
            local_digest: result.localDigest,
            remote_digest: result.remoteDigest,
            update_available: result.updateAvailable,
            checked_at: result.checkedAt,
            error: result.error,
            failures: result.failures,
            next_check: result.nextCheck,
        }).onConflict("image").merge();

        return result;
    }
}
