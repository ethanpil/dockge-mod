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

    /** How far the check that runs now is */
    static progress : { running : boolean, checked : number, total : number } = {
        running: false,
        checked: 0,
        total: 0,
    };

    /** The time between two progress events, in milliseconds */
    static readonly PROGRESS_INTERVAL = 500;

    /** The longest time between two checks of one image, in milliseconds */
    static readonly MAX_BACKOFF = 72 * 60 * 60 * 1000;

    /**
     * True when a check must examine this image now.
     *
     * The time of the next check comes from the end of the last check,
     * and the checks run at each interval. The end of a check is always
     * after the start of the interval, thus a comparison without a
     * window would make each image wait one more interval.
     * @param previous The last result of this image, or undefined
     * @param now The time now
     * @param force True for a check that the user starts
     * @returns True when the check examines this image
     */
    static isDue(previous : ImageUpdate | undefined, now : number, force : boolean) : boolean {
        if (force || !previous?.nextCheck) {
            return true;
        }

        const time = new Date(previous.nextCheck).getTime();

        // A value that is not a time, or a time that is too far away
        // because the clock of the host was wrong, must not stop the
        // checks of this image for ever.
        if (!Number.isFinite(time) || time - now > ImageUpdateChecker.MAX_BACKOFF) {
            return true;
        }

        return time - now <= ImageUpdateChecker.INTERVAL / 2;
    }

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
     * The fields of the last check that the next check needs. The read
     * does not use getAll, thus the answer of the socket API and the
     * rule of the schedule stay apart.
     * @returns The last result of each image, by the image name
     */
    protected static async readPrevious() : Promise<Map<string, ImageUpdate>> {
        const rows = await R.knex("mod_image_update").select("image", "update_available", "failures", "next_check");
        const map = new Map<string, ImageUpdate>();
        for (const row of rows) {
            map.set(row.image, {
                image: row.image,
                localDigest: null,
                remoteDigest: null,
                updateAvailable: Boolean(row.update_available),
                checkedAt: null,
                error: null,
                failures: Number(row.failures ?? 0),
                nextCheck: (row.next_check as string) ?? null,
            });
        }
        return map;
    }

    /**
     * Check a set of images. The progress goes to the clients while the
     * check runs.
     * @param images The images to check
     * @param previous The last result of each image
     * @param force True for a check that the user starts
     * @returns The images with a new version, and the images that did
     * not have one before
     */
    private async runChecks(images : Set<string>, previous : Map<string, ImageUpdate>, force : boolean) : Promise<{ updated : Set<string>, newUpdates : string[] }> {
        const updated = new Set<string>();
        const newUpdates : string[] = [];

        ImageUpdateChecker.progress = {
            running: true,
            checked: 0,
            total: images.size,
        };
        this.server.sendImageUpdateProgress();

        const localDigests = await ImageUpdateChecker.readLocalDigests([ ...images ]);
        const queue = [ ...images ];
        let lastEvent = Date.now();

        const worker = async () => {
            for (let image = queue.shift(); image !== undefined; image = queue.shift()) {
                const row = await this.check(image, localDigests.get(ImageUpdateChecker.key(image)), previous.get(image), force);
                if (row.updateAvailable) {
                    updated.add(image);
                    if (!ImageUpdateChecker.available.has(image)) {
                        newUpdates.push(image);
                    }
                }

                ImageUpdateChecker.progress.checked++;
                const now = Date.now();
                if (now - lastEvent >= ImageUpdateChecker.PROGRESS_INTERVAL) {
                    lastEvent = now;
                    this.server.sendImageUpdateProgress();
                }
            }
        };
        await Promise.all(Array.from({ length: ImageUpdateChecker.CONCURRENCY }, worker));

        return {
            updated,
            newUpdates,
        };
    }

    /**
     * Check the images of one stack. The user starts this check on the
     * page of the stack, thus it examines each image of that stack.
     * @param stackName The name of the stack
     * @returns The count of the images that the check examined
     */
    async checkStack(stackName : string) : Promise<{ started : boolean, count : number }> {
        if (this.running) {
            // The client shows a message. A check that runs is not an error.
            return {
                started: false,
                count: 0,
            };
        }
        this.running = true;
        try {
            // A registry that had a problem gets a new try, the same as
            // in a check of each image
            this.registry.reset();

            const stack = await Stack.getStack(this.server, stackName);
            const images = new Set(stack.images.filter((image) => {
                try {
                    return parseImageRef(image).digest === null;
                } catch (e) {
                    return false;
                }
            }));

            log.info("imageUpdate", "Check " + images.size + " images of the stack " + stackName);

            const previous = await ImageUpdateChecker.readPrevious();
            const result = await this.runChecks(images, previous, true);

            // Only the images of this stack change. The images of the
            // other stacks keep the result of their last check.
            const next = new Set(ImageUpdateChecker.available);
            for (const image of images) {
                next.delete(image);
            }
            for (const image of result.updated) {
                next.add(image);
            }
            ImageUpdateChecker.available = next;

            if (result.newUpdates.length > 0) {
                await Notifier.send("image_update", "New image versions", "A new version is available for: " + result.newUpdates.join(", "));
            }

            this.server.sendStackList(true).catch(() => undefined);
            return {
                started: true,
                count: images.size,
            };
        } finally {
            this.running = false;
            this.endProgress();
        }
    }

    /**
     * Tell the clients that no check runs. This also goes out when a
     * check failed before its first image, thus a client does not wait
     * for an end that does not come.
     */
    private endProgress() {
        ImageUpdateChecker.progress.running = false;
        this.server.sendImageUpdateProgress();
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
            const previous = await ImageUpdateChecker.readPrevious();
            const now = Date.now();
            const due = new Set([ ...images ].filter((image) => ImageUpdateChecker.isDue(previous.get(image), now, force)));

            log.info("imageUpdate", "Check " + due.size + " of " + images.size + " images");

            // The new set replaces the old set at the end, thus a stack
            // list that goes out during the check shows the old result,
            // not a mix of both.
            const next = new Set<string>();
            const newUpdates : string[] = [];

            // An image that this check leaves out keeps its last result
            for (const image of images) {
                if (!due.has(image) && previous.get(image)?.updateAvailable) {
                    next.add(image);
                }
            }

            const result = await this.runChecks(due, previous, force);
            for (const image of result.updated) {
                next.add(image);
            }
            newUpdates.push(...result.newUpdates);

            // Remove the rows of images that no stack uses now. A list
            // without images comes from a stacks directory that is not
            // ready, thus the rows and their counts stay.
            if (images.size > 0) {
                await R.knex("mod_image_update").whereNotIn("image", [ ...images ]).del();
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
            this.endProgress();
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
    async check(image : string, repoDigests : string[] | undefined, previous? : ImageUpdate, force = false) : Promise<ImageUpdate> {
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

        // True when the image is not on this host. Such an image has no
        // problem with its registry, thus the wait does not grow.
        let localMiss = false;

        try {
            if (repoDigests === undefined) {
                // The batch gives the images by their tags. An image
                // without the tag of the compose file is not in that map,
                // thus one process reads this image again.
                const single = await ImageUpdateChecker.readLocalDigests([ image ]);
                repoDigests = single.get(ImageUpdateChecker.key(image));
            }

            if (repoDigests === undefined) {
                // A stack that never started has no image on the host.
                // The last result stays, thus the badge does not go away
                // and no message goes out at the next start.
                result.error = "The image is not on this host";
                result.updateAvailable = previous?.updateAvailable ?? false;
                localMiss = true;
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
            result.updateAvailable = previous?.updateAvailable ?? false;
            log.debug("imageUpdate", image + ": " + result.error);
        }

        if (result.error === null) {
            // The image has an answer, thus the usual time comes back
            result.failures = 0;
            result.nextCheck = null;
        } else if (localMiss) {
            // The image is not on this host. The count stays as it was.
            result.failures = previous?.failures ?? 0;
            result.nextCheck = previous?.nextCheck ?? null;
        } else {
            // A check that the user starts must not make the wait longer
            result.failures = force
                ? Math.max(previous?.failures ?? 0, 1)
                : (previous?.failures ?? 0) + 1;
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
