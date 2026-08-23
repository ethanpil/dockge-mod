import childProcessAsync from "promisify-child-process";
import { DOCKER_SPAWN_OPTIONS, errorMessage, ValidationError } from "./util-server";
import { canonicalRef, parseImageRef } from "./registry";
import { log } from "./log";

/** The kinds of resources that the resources page shows */
export const RESOURCE_KINDS = [ "images", "volumes", "networks" ] as const;
export type ResourceKind = typeof RESOURCE_KINDS[number];

/** The prune operations */
export const PRUNE_KINDS = [ "images", "images-all", "volumes", "networks" ] as const;
export type PruneKind = typeof PRUNE_KINDS[number];

/** The networks that docker makes itself. A remove is not possible. */
const PREDEFINED_NETWORKS = new Set([ "bridge", "host", "none" ]);

/** The label that docker compose puts on the resources of a project */
const PROJECT_LABEL = "com.docker.compose.project";

/** The label that docker puts on a volume that it named itself */
const ANONYMOUS_LABEL = "com.docker.volume.anonymous";

/**
 * One resource that a prune can remove.
 */
export interface PruneCandidate {
    /** The text that the remove command uses */
    id : string;
    /** The name for the user */
    name : string;
    /** More text for the user, for example the size */
    detail : string;
}

/**
 * What a prune removes, and how many resources it keeps.
 */
export interface PrunePlan {
    candidates : PruneCandidate[];
    /** How many resources stay because a stack of this server uses them */
    kept : number;
}

/**
 * The resources that a prune must keep. A stack that is not running
 * still needs its images, its volumes, and its networks.
 */
export interface ProtectedResources {
    /** The compose projects of the stacks of this server */
    projects : Set<string>;
    /** The images that the compose files of those stacks name */
    images : Set<string>;
}

/**
 * The resources that a container uses now. A container that is stopped
 * counts, because docker prune does not keep the network of such a
 * container.
 */
export interface ResourcesInUse {
    /** The short ids of the images */
    images : Set<string>;
    /** The names of the volumes */
    volumes : Set<string>;
    /** The names of the networks */
    networks : Set<string>;
}

/**
 * True when a name can go to docker as an argument. An image name can
 * hold a registry, a path, a tag, and a digest. A name that starts with
 * a dash is an option.
 * @param name The name from the client
 * @returns True when the name is safe as an argument
 */
export function isDockerResourceName(name : string) : boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*$/.test(name) && name.length <= 500;
}

/**
 * Read the lines of a `--format json` output. Docker gives one object
 * for each line.
 * @param output The output
 * @returns The objects
 */
export function parseJSONLines(output : string) : Record<string, unknown>[] {
    const list : Record<string, unknown>[] = [];
    if (!output) {
        return list;
    }
    for (const line of output.split("\n")) {
        const text = line.trim();
        if (!text) {
            continue;
        }
        try {
            list.push(JSON.parse(text));
        } catch (e) {
            // A warning line is not JSON
        }
    }
    return list;
}

/**
 * The value of one label. Docker gives the labels of a resource as one
 * text, for example "com.docker.compose.project=web,other=1".
 * @param labels The text of the labels
 * @param key The name of the label
 * @returns The value, or null when the label is not there
 */
export function labelValue(labels : unknown, key : string) : string | null {
    if (typeof labels !== "string") {
        return null;
    }
    for (const part of labels.split(",")) {
        const equals = part.indexOf("=");
        if (equals > 0 && part.slice(0, equals).trim() === key) {
            return part.slice(equals + 1).trim();
        }
    }
    return null;
}

/**
 * True when docker made the name of this volume. Such a volume comes
 * from an image that asks for a volume, and the compose file gives no
 * name for it.
 *
 * Docker puts a label on such a volume, and its own prune reads that
 * label. A volume without labels comes from an older docker, thus the
 * form of the name gives the answer for that volume.
 * @param name The name of the volume
 * @param labels The text of the labels
 * @returns True when docker made the name
 */
export function isAnonymousVolume(name : string, labels : unknown) : boolean {
    const text = typeof labels === "string" ? labels : "";
    if (text !== "") {
        return text.split(",").some((part) => part.split("=")[0].trim() === ANONYMOUS_LABEL);
    }
    return /^[0-9a-f]{64}$/.test(name);
}

/**
 * The first characters of an image id, without the algorithm. Docker
 * gives the id in more than one form.
 * @param id The id
 * @returns The short form
 */
export function shortImageId(id : unknown) : string {
    return String(id ?? "").replace(/^sha256:/, "").slice(0, 12);
}

/**
 * The volumes that a prune can remove.
 *
 * A volume with a name stays. Such a volume holds the data of a user,
 * and docker itself also keeps it without the --all option. A volume
 * of a stack of this server stays, also when the stack is not running.
 * @param rows The output of docker volume ls
 * @param used The resources that a container uses
 * @param projects The compose projects of this server
 * @returns The candidates, and the count of the volumes that stay
 */
export function selectVolumeCandidates(rows : Record<string, unknown>[], used : ResourcesInUse, projects : Set<string>) : PrunePlan {
    const candidates : PruneCandidate[] = [];
    let kept = 0;

    for (const row of rows) {
        const name = String(row.Name ?? "");
        if (name === "") {
            continue;
        }

        const project = labelValue(row.Labels, PROJECT_LABEL);
        const keep = used.volumes.has(name)
            || !isAnonymousVolume(name, row.Labels)
            || (project !== null && projects.has(project));

        if (keep) {
            kept++;
            continue;
        }

        candidates.push({
            id: name,
            name,
            detail: String(row.Driver ?? ""),
        });
    }

    return {
        candidates,
        kept,
    };
}

/**
 * The networks that a prune can remove.
 *
 * A network of a container stays, also when the container is stopped.
 * A network of a stack of this server stays, thus a stack that is not
 * running keeps its network. The networks of docker itself stay.
 * @param rows The output of docker network ls
 * @param used The resources that a container uses
 * @param projects The compose projects of this server
 * @returns The candidates, and the count of the networks that stay
 */
export function selectNetworkCandidates(rows : Record<string, unknown>[], used : ResourcesInUse, projects : Set<string>) : PrunePlan {
    const candidates : PruneCandidate[] = [];
    let kept = 0;

    for (const row of rows) {
        const name = String(row.Name ?? "");
        if (name === "") {
            continue;
        }

        const project = labelValue(row.Labels, PROJECT_LABEL);
        const keep = PREDEFINED_NETWORKS.has(name)
            || used.networks.has(name)
            || (project !== null && projects.has(project));

        if (keep) {
            kept++;
            continue;
        }

        candidates.push({
            id: name,
            name,
            detail: String(row.Driver ?? ""),
        });
    }

    return {
        candidates,
        kept,
    };
}

/**
 * The images that a prune can remove.
 *
 * An image of a container stays, also when the container is stopped.
 * An image that a compose file of this server names stays, thus a
 * stack that is down keeps its images.
 * @param rows The output of docker image ls
 * @param used The resources that a container uses
 * @param protectedImages The images of the compose files of this server
 * @param danglingOnly True to keep each image that has a tag
 * @returns The candidates, and the count of the images that stay
 */
export function selectImageCandidates(rows : Record<string, unknown>[], used : ResourcesInUse, protectedImages : Set<string>, danglingOnly : boolean) : PrunePlan {
    const canonical = new Set<string>();
    for (const image of protectedImages) {
        try {
            canonical.add(canonicalRef(parseImageRef(image)));
        } catch (e) {
            // A name that docker cannot read protects nothing
        }
    }

    const candidates : PruneCandidate[] = [];
    let kept = 0;

    for (const row of rows) {
        const id = shortImageId(row.ID);
        if (id === "") {
            continue;
        }

        const repository = String(row.Repository ?? "");
        const tag = String(row.Tag ?? "");
        const dangling = repository === "" || repository === "<none>" || tag === "" || tag === "<none>";
        const name = dangling ? "<none>:<none>" : repository + ":" + tag;

        let keep = used.images.has(id);

        if (!keep && danglingOnly && !dangling) {
            keep = true;
        }

        if (!keep && !dangling) {
            try {
                keep = canonical.has(canonicalRef(parseImageRef(name)));
            } catch (e) {
                keep = false;
            }
        }

        if (keep) {
            kept++;
            continue;
        }

        candidates.push({
            id: dangling ? id : name,
            name,
            detail: String(row.Size ?? ""),
        });
    }

    return {
        candidates,
        kept,
    };
}

/**
 * The images, the volumes, and the networks of the host.
 */
export class DockerResources {

    /**
     * List the resources of one kind.
     * @param kind The kind
     * @returns The objects of docker, one for each resource
     */
    static async list(kind : ResourceKind) : Promise<Record<string, unknown>[]> {
        const args : Record<ResourceKind, string[]> = {
            images: [ "image", "ls", "--format", "json" ],
            volumes: [ "volume", "ls", "--format", "json" ],
            networks: [ "network", "ls", "--format", "json" ],
        };
        const res = await childProcessAsync.spawn("docker", args[kind], DOCKER_SPAWN_OPTIONS);
        return parseJSONLines(res.stdout?.toString() ?? "");
    }

    /**
     * List the resources of one kind, and say for each one if a
     * container uses it. A container that is stopped counts.
     * @param kind The kind
     * @returns The objects of docker, each with the field inUse
     */
    static async listWithUsage(kind : ResourceKind) : Promise<Record<string, unknown>[]> {
        const [ rows, used ] = await Promise.all([
            DockerResources.list(kind),
            DockerResources.inUse(),
        ]);

        for (const row of rows) {
            if (kind === "images") {
                row.inUse = used.images.has(shortImageId(row.ID));
            } else if (kind === "volumes") {
                row.inUse = used.volumes.has(String(row.Name ?? ""));
            } else {
                const name = String(row.Name ?? "");
                row.inUse = used.networks.has(name) || PREDEFINED_NETWORKS.has(name);
            }
        }

        return rows;
    }

    /**
     * The images, the volumes, and the networks that a container uses.
     * A container that is stopped counts. The prune of docker does not
     * keep the network of a container that is stopped, thus this server
     * reads the containers itself.
     * @returns The resources in use
     */
    static async inUse() : Promise<ResourcesInUse> {
        const result : ResourcesInUse = {
            images: new Set<string>(),
            volumes: new Set<string>(),
            networks: new Set<string>(),
        };

        const list = await childProcessAsync.spawn("docker", [ "ps", "-a", "--format", "{{.ID}}" ], DOCKER_SPAWN_OPTIONS);
        const ids = (list.stdout?.toString() ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
        if (ids.length === 0) {
            return result;
        }

        const format = "{{.Image}}|{{range .Mounts}}{{.Name}},{{end}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}";
        const res = await childProcessAsync.spawn("docker", [ "inspect", "--format", format, "--", ...ids ], DOCKER_SPAWN_OPTIONS);

        for (const line of (res.stdout?.toString() ?? "").split("\n")) {
            const parts = line.trim().split("|");
            if (parts.length < 3) {
                continue;
            }
            const image = shortImageId(parts[0]);
            if (image !== "") {
                result.images.add(image);
            }
            for (const name of parts[1].split(",")) {
                if (name.trim() !== "") {
                    result.volumes.add(name.trim());
                }
            }
            for (const name of parts[2].split(",")) {
                if (name.trim() !== "") {
                    result.networks.add(name.trim());
                }
            }
        }

        return result;
    }

    /**
     * What a prune of this kind removes, and how many resources it
     * keeps. The user reads this list before the prune runs.
     * @param kind The prune operation
     * @param resources The resources that the prune must keep
     * @returns The plan
     */
    static async planPrune(kind : PruneKind, resources : ProtectedResources) : Promise<PrunePlan> {
        const used = await DockerResources.inUse();

        if (kind === "volumes") {
            return selectVolumeCandidates(await DockerResources.list("volumes"), used, resources.projects);
        }
        if (kind === "networks") {
            return selectNetworkCandidates(await DockerResources.list("networks"), used, resources.projects);
        }
        return selectImageCandidates(await DockerResources.list("images"), used, resources.images, kind === "images");
    }

    /**
     * Remove one resource.
     * @param kind The kind
     * @param name The name or id
     * @returns The output of docker
     */
    static async remove(kind : ResourceKind, name : string) : Promise<string> {
        if (!isDockerResourceName(name)) {
            throw new ValidationError("Invalid name");
        }
        const command : Record<ResourceKind, string> = {
            images: "image",
            volumes: "volume",
            networks: "network",
        };
        const res = await childProcessAsync.spawn("docker", [ command[kind], "rm", "--", name ], DOCKER_SPAWN_OPTIONS);
        return res.stdout?.toString() ?? "";
    }

    /**
     * Remove the resources of the plan, one after the other.
     *
     * This server does not use the prune command of docker. That
     * command removes the network of a stack that is stopped, and it
     * removes the images of a stack that is down. It also gives no
     * list of the resources before it removes them.
     * @param kind The prune operation
     * @param resources The resources that the prune must keep
     * @returns The resources that went away, and the failures
     */
    static async prune(kind : PruneKind, resources : ProtectedResources) : Promise<{ removed : PruneCandidate[], failed : { name : string, error : string }[] }> {
        const plan = await DockerResources.planPrune(kind, resources);
        const removed : PruneCandidate[] = [];
        const failed : { name : string, error : string }[] = [];

        const kindOfResource : ResourceKind = kind === "volumes" ? "volumes" : (kind === "networks" ? "networks" : "images");

        for (const candidate of plan.candidates) {
            try {
                await DockerResources.remove(kindOfResource, candidate.id);
                removed.push(candidate);
            } catch (e) {
                // A resource that a different process took in the time
                // between the plan and the remove gives a failure only
                const message = (errorMessage(e) || "Cannot remove").split("\n")[0].slice(0, 300);
                failed.push({
                    name: candidate.name,
                    error: message,
                });
                log.debug("dockerResources", "Cannot remove " + candidate.name + ": " + message);
            }
        }

        return {
            removed,
            failed,
        };
    }
}
