import { R } from "redbean-node";
import childProcessAsync from "promisify-child-process";
import { log } from "./log";
import { DOCKER_SPAWN_OPTIONS, errorMessage, stderrOf } from "./util-server";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";
import { Notifier } from "./notification";
import { canonicalRef, DIGEST_REGEX, parseImageRef, RegistryClient, RegistryError } from "./registry";

/** One mod_image_update row, as sent to the client. */
export interface ImageUpdate {
    image : string;
    localDigest : string | null;
    remoteDigest : string | null;
    updateAvailable : boolean;
    checkedAt : string | null;
    error : string | null;
    /** Consecutive failed checks */
    failures : number;
    /** When a failing image is checked next */
    nextCheck : string | null;
}

/**
 * The digest part of a repo digest such as "nginx@sha256:abc".
 * @param repoDigest The repo digest from docker image inspect
 * @returns The digest, or the full text if it has no @
 */
function digestOf(repoDigest : string) : string {
    const at = repoDigest.indexOf("@");
    return at >= 0 ? repoDigest.slice(at + 1) : repoDigest;
}

/**
 * True if the local image matches the registry. A local image can have
 * several repo digests, e.g. one per tag.
 * @param localRepoDigests RepoDigests from docker image inspect
 * @param remoteDigest The registry digest
 * @returns True if any local digest equals the remote digest
 */
export function digestsMatch(localRepoDigests : string[], remoteDigest : string) : boolean {
    return localRepoDigests.some((repoDigest) => digestOf(repoDigest) === remoteDigest);
}

/**
 * Checks for new image versions by comparing each managed stack image's
 * registry digest with the local one. Results go to mod_image_update; an
 * in-memory set feeds the stack list counts.
 */
export class ImageUpdateChecker {

    /** Time between checks, in milliseconds */
    static readonly INTERVAL = 6 * 60 * 60 * 1000;

    /** Images with a new version, from the last check */
    static available : Set<string> = new Set();

    /** Progress of the running check */
    static progress : { running : boolean, checked : number, total : number } = {
        running: false,
        checked: 0,
        total: 0,
    };

    /** Minimum time between progress events, in milliseconds */
    static readonly PROGRESS_INTERVAL = 500;

    /** Maximum backoff for one image, in milliseconds */
    static readonly MAX_BACKOFF = 72 * 60 * 60 * 1000;

    /**
     * True if this image is due for a check now.
     *
     * nextCheck is set from when the last check ended, which is always after
     * the interval started, so without a tolerance window every image would
     * wait one extra interval.
     * @param previous The last result of this image, or undefined
     * @param now The current time
     * @param force True for a user-started check
     * @returns True if the image should be checked
     */
    static isDue(previous : ImageUpdate | undefined, now : number, force : boolean) : boolean {
        if (force || !previous?.nextCheck) {
            return true;
        }

        const time = new Date(previous.nextCheck).getTime();

        // An invalid time, or one too far ahead (e.g. from a wrong host
        // clock), must not block checks of this image forever.
        if (!Number.isFinite(time) || time - now > ImageUpdateChecker.MAX_BACKOFF) {
            return true;
        }

        return time - now <= ImageUpdateChecker.INTERVAL / 2;
    }

    /**
     * Backoff for a failing image, doubling with each consecutive failure.
     * @param failures The number of consecutive failures
     * @returns The wait, in milliseconds
     */
    static backoff(failures : number) : number {
        if (failures < 1) {
            return 0;
        }
        const time = ImageUpdateChecker.INTERVAL * Math.pow(2, failures - 1);
        return Math.min(time, ImageUpdateChecker.MAX_BACKOFF);
    }

    /** How many registry requests run in parallel */
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
     * Load the last results, then check at each interval. The first check
     * waits two minutes so server startup stays fast.
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

    /**
     * Clear the update flag of images whose local digest now matches the last
     * registry digest, without registry requests. Runs after a pull and at
     * the end of a check, since a pull can happen during a check.
     * @param images The images to reconcile
     */
    static async afterPull(images : string[]) : Promise<void> {
        const pending = [ ...new Set(images) ];
        if (pending.length === 0) {
            return;
        }
        const rows = await R.knex("mod_image_update").whereIn("image", pending).whereNotNull("remote_digest").select("image", "remote_digest");
        if (rows.length === 0) {
            return;
        }
        const local = await ImageUpdateChecker.readLocalDigests(rows.map((row : { image : string }) => row.image));
        for (const row of rows as { image : string, remote_digest : string | null }[]) {
            const repoDigests = local.get(ImageUpdateChecker.key(row.image));
            if (row.remote_digest && repoDigests && repoDigests.length > 0 && digestsMatch(repoDigests, row.remote_digest)) {
                await R.knex("mod_image_update").where({ image: row.image }).update({
                    update_available: false,
                    local_digest: digestOf(repoDigests[0]),
                });
                ImageUpdateChecker.available.delete(row.image);
            }
        }
    }

    /**
     * Account for pulls made during the check, then notify about images
     * that still have an update.
     * @param newUpdates Images that had no update before this check
     */
    private async finishCheck(newUpdates : string[]) {
        await ImageUpdateChecker.afterPull([ ...ImageUpdateChecker.available ]).catch((e) => {
            log.warn("imageUpdate", "Cannot reconcile the update state: " + errorMessage(e));
        });
        const still = newUpdates.filter((image) => ImageUpdateChecker.available.has(image));
        if (still.length > 0) {
            await Notifier.send("image_update", "New image versions", "A new version is available for: " + still.join(", "));
        }
        this.server.sendStackList(true);
    }

    async loadAvailable() {
        const rows = await R.knex("mod_image_update").where({ update_available: true }).select("image");
        ImageUpdateChecker.available = new Set(rows.map((row : { image : string }) => row.image));
    }

    /**
     * The results of the last check.
     * @returns One entry per image
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
     * The fields the scheduler needs from the last check. Kept separate from
     * getAll so the socket API and the scheduling rules stay decoupled.
     * @returns The last result of each image, by image name
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
     * Check a set of images, sending progress to clients.
     * @param images The images to check
     * @param previous The last result of each image
     * @param force True for a user-started check
     * @returns The images with a new version, and those that did not
     * have one before
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
     * Check every image of one stack (user-started from the stack page).
     * @param stackName The name of the stack
     * @returns The number of images checked
     */
    async checkStack(stackName : string) : Promise<{ started : boolean, count : number }> {
        // started: false tells the client a check is already running
        return this.exclusive<{ started : boolean, count : number }>({
            started: false,
            count: 0,
        }, async () => {
            const stack = await Stack.getStack(this.server, stackName);
            const images = new Set(stack.images.filter(ImageUpdateChecker.isCheckable));

            log.info("imageUpdate", "Check " + images.size + " images of the stack " + stackName);

            const previous = await ImageUpdateChecker.readPrevious();
            const result = await this.runChecks(images, previous, true);

            // Only this stack's images change; others keep their last result
            const next = new Set(ImageUpdateChecker.available);
            for (const image of images) {
                next.delete(image);
            }
            for (const image of result.updated) {
                next.add(image);
            }
            ImageUpdateChecker.available = next;
            await this.finishCheck(result.newUpdates);
            return {
                started: true,
                count: images.size,
            };
        });
    }

    /**
     * Run one check at a time. Resets registry errors from the last check,
     * and always tells clients when the check ends, even if it fails early.
     * @param busy The result if a check is already running
     * @param run The check
     * @returns The result of the check, or busy
     */
    private async exclusive<T>(busy : T, run : () => Promise<T>) : Promise<T> {
        if (this.running) {
            return busy;
        }
        this.running = true;
        try {
            this.registry.reset();
            return await run();
        } finally {
            this.running = false;
            this.endProgress();
        }
    }

    /**
     * True if the image can be checked. A digest-pinned name never changes,
     * and an unparseable name is skipped.
     * @param image The image name
     * @returns True if the image gets a check
     */
    static isCheckable(image : string) : boolean {
        try {
            return parseImageRef(image).digest === null;
        } catch (e) {
            return false;
        }
    }

    /**
     * Tell clients no check is running. Also sent when a check fails before
     * its first image, so clients do not wait forever.
     */
    private endProgress() {
        ImageUpdateChecker.progress.running = false;
        this.server.sendImageUpdateProgress();
    }

    /**
     * Check each image of the managed stacks. One check runs at a time.
     * @returns True if the check ran, false if one was in progress
     */
    async checkAll(force = false) : Promise<boolean> {
        return this.exclusive<boolean>(false, async () => {
            const { images, complete } = await this.collectImages();

            // Failing images back off; a user-started check ignores backoff
            const previous = await ImageUpdateChecker.readPrevious();
            const now = Date.now();
            const due = new Set([ ...images ].filter((image) => ImageUpdateChecker.isDue(previous.get(image), now, force)));

            log.info("imageUpdate", "Check " + due.size + " of " + images.size + " images");

            // Swapped in at the end, so a stack list sent mid-check shows
            // the old result, not a mix.
            const next = new Set<string>();

            // Images skipped by this check keep their last result
            for (const image of images) {
                if (!due.has(image) && previous.get(image)?.updateAvailable) {
                    next.add(image);
                }
            }

            const result = await this.runChecks(due, previous, force);
            for (const image of result.updated) {
                next.add(image);
            }

            // Remove rows of images no stack uses. An empty list likely means
            // the stacks directory is not ready, so keep the rows then.
            if (images.size > 0 && complete) {
                await R.knex("mod_image_update").whereNotIn("image", [ ...images ]).del();
            }
            ImageUpdateChecker.available = next;
            await this.finishCheck(result.newUpdates);
            return true;
        });
    }

    /**
     * The images of the managed stacks, with variables resolved from each
     * stack's .env file.
     * @returns The unique image names
     */
    async collectImages() : Promise<{ images : Set<string>, complete : boolean }> {
        const images = new Set<string>();
        let complete = true;
        // Not the cached list: its stacks keep the compose content they read
        // first, so an edit outside dockge-mod would never be checked
        const stackList = await Stack.getStackList(this.server);
        for (const stack of stackList.values()) {
            if (!stack.isManagedByDockge) {
                continue;
            }
            // An unreadable compose file (e.g. half written) gives no images,
            // which must not delete its rows
            if (!stack.composeInfo.ok) {
                complete = false;
            }
            for (const image of stack.images.filter(ImageUpdateChecker.isCheckable)) {
                images.add(image);
            }
        }
        return {
            images,
            complete,
        };
    }

    /**
     * The readLocalDigests map key. Different spellings of one image give
     * the same key.
     * @param image The image name from a compose file
     * @returns The key, or the name if it cannot be parsed
     */
    static key(image : string) : string {
        try {
            return canonicalRef(parseImageRef(image));
        } catch (e) {
            return image;
        }
    }

    /**
     * The repo digests of the given images on this host, read with one
     * docker call. Images not on the host are missing from the map.
     * @param images The image names
     * @returns The repo digests, by image key
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
                    // Skip lines that are not JSON
                }
            }
        };

        // "--" ends the flags, so an image name starting with a dash is not
        // read as a flag.
        const format = "{{json .RepoTags}}\t{{json .RepoDigests}}";
        try {
            const res = await childProcessAsync.spawn("docker", [ "image", "inspect", "--format", format, "--", ...images ], DOCKER_SPAWN_OPTIONS);
            parse(res.stdout?.toString() ?? "");
        } catch (e) {
            // docker exits with an error if any image is missing, but the
            // output still has the ones it found.
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
     * Check one image and write the result.
     * @param image The image name, with or without a tag
     * @param repoDigests The local repo digests, or undefined if the
     * image is not on this host
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

        // Set when the image is not on this host, or was skipped after a
        // registry-wide error. The backoff does not grow then.
        let keepSchedule = false;

        try {
            if (repoDigests === undefined) {
                // The batch is keyed by local tags, so an image without the
                // compose file's tag is missing. Look it up by name.
                const single = await ImageUpdateChecker.readLocalDigests([ image ]);
                repoDigests = single.get(ImageUpdateChecker.key(image));
            }

            if (repoDigests === undefined) {
                // E.g. a stack that never started. Keep the last result so
                // the badge stays and no repeat notification goes out.
                result.error = "The image is not on this host";
                result.updateAvailable = previous?.updateAvailable ?? false;
                keepSchedule = true;
            } else if (repoDigests.length === 0) {
                // A local build has no repo digest and no registry version
                result.error = "The image has no registry digest";
            } else {
                result.localDigest = digestOf(repoDigests[0]);

                // The index digest (or manifest digest if there is no index).
                // A pull by tag stores this one in RepoDigests on both the
                // classic and containerd stores; the per-platform digest differs.
                const remoteDigest = await this.registry.getDigest(image);
                if (!DIGEST_REGEX.test(remoteDigest)) {
                    result.error = "The registry gave no digest";
                } else {
                    result.remoteDigest = remoteDigest;
                    result.updateAvailable = !digestsMatch(repoDigests, remoteDigest);

                    if (result.updateAvailable) {
                        // A pull during a long check makes the batch digest
                        // stale, so re-read it before reporting an update.
                        const fresh = (await ImageUpdateChecker.readLocalDigests([ image ])).get(ImageUpdateChecker.key(image));
                        if (fresh !== undefined && fresh.length > 0) {
                            result.localDigest = digestOf(fresh[0]);
                            result.updateAvailable = !digestsMatch(fresh, remoteDigest);
                        }
                    }
                }
            }
        } catch (e) {
            // E.g. a private registry without credentials, or no network.
            // Keep the last result so a short outage does not clear badges
            // or repeat the notification.
            result.error = (stderrOf(e) || errorMessage(e) || "Check failed").split("\n")[0].slice(0, 500);
            result.updateAvailable = previous?.updateAvailable ?? false;
            keepSchedule = e instanceof RegistryError && e.skipped;
            log.debug("imageUpdate", image + ": " + result.error);
        }

        if (result.error === null) {
            // Success resets the backoff
            result.failures = 0;
            result.nextCheck = null;
        } else if (keepSchedule) {
            // Not really tried, so keep the schedule as it was
            result.failures = previous?.failures ?? 0;
            result.nextCheck = previous?.nextCheck ?? null;
        } else {
            // A user-started check must not increase the backoff
            result.failures = force
                ? Math.max(previous?.failures ?? 0, 1)
                : (previous?.failures ?? 0) + 1;
            result.nextCheck = new Date(Date.now() + ImageUpdateChecker.backoff(result.failures)).toISOString();
        }

        // Do not reject the worker: Promise.all would end the check while
        // other workers still run
        try {
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
        } catch (e) {
            log.warn("imageUpdate", "Cannot save the result of " + image + ": " + errorMessage(e));
        }

        return result;
    }
}
