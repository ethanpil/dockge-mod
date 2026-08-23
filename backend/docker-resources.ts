import childProcessAsync from "promisify-child-process";
import { R } from "redbean-node";
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
 * One resource that a removal can take.
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
 * What a removal takes, and how many resources stay.
 */
export interface PrunePlan {
    candidates : PruneCandidate[];
    /** How many resources stay because this server keeps them */
    kept : number;
}

/**
 * The resources that a removal must keep. A stack that is not running
 * still needs its images, its volumes, and its networks.
 */
export interface ProtectedResources {
    /** The compose projects of the stacks of this server */
    projects : Set<string>;
    /** The images that the compose files of those stacks name */
    images : Set<string>;
    /**
     * The repositories that a removal must keep without a tag. A compose
     * file that names an image with a digest, and a compose file that
     * builds an image, give no tag for a comparison.
     */
    repositories : Set<string>;
}

/**
 * The resources that a container uses now. A container that is stopped
 * counts, because the prune of docker does not keep the network of such
 * a container.
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
 * What a read of the containers found.
 */
export interface ContainerScan {
    used : ResourcesInUse;
    /** The compose project of each volume, from the containers */
    owners : Map<string, string>;
    /**
     * False when docker did not answer for each container. A removal
     * must not run with such a result, because a resource of a container
     * that this read missed looks free.
     */
    complete : boolean;
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
 * The value of one label. An inspect gives the labels as an object. The
 * list of the images gives them as one text, for example "a=1,b=2". A
 * text cannot hold a comma in a value, thus the object is the better
 * source.
 * @param labels The labels
 * @param key The name of the label
 * @returns The value, or null when the label is not there
 */
export function labelValue(labels : unknown, key : string) : string | null {
    if (labels !== null && typeof labels === "object") {
        const value = (labels as Record<string, unknown>)[key];
        return value === undefined ? null : String(value);
    }
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
 * from an image that asks for a volume, or from a short form in a
 * compose file, and no name of a user is on it.
 *
 * Docker puts a label on such a volume, and its own prune reads that
 * label. The labels come from an inspect, thus a value with a comma
 * cannot give a wrong answer.
 * @param labels The labels of the volume
 * @returns True when docker made the name
 */
export function isAnonymousVolume(labels : unknown) : boolean {
    if (labels === null || typeof labels !== "object") {
        return false;
    }
    return ANONYMOUS_LABEL in (labels as Record<string, unknown>);
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
 * True when docker has no name for this image. Docker itself calls such
 * an image dangling, and it makes the same test: the repository and the
 * tag must both be empty. An image with a repository and without a tag
 * comes from a pull with a digest, and it is not dangling.
 * @param repository The repository of the row
 * @param tag The tag of the row
 * @returns True when the image has no name
 */
export function isDanglingImage(repository : string, tag : string) : boolean {
    const noRepository = repository === "" || repository === "<none>";
    const noTag = tag === "" || tag === "<none>";
    return noRepository && noTag;
}

/**
 * The repository part of an image name, without the tag and without the
 * digest. The list of docker shows this text in the repository column,
 * thus a comparison with that column is possible.
 * @param image The image name from a compose file
 * @returns The repository, or an empty text when the name is empty
 */
export function refRepository(image : string) : string {
    let rest = (image ?? "").trim();
    const at = rest.lastIndexOf("@");
    if (at > 0) {
        rest = rest.slice(0, at);
    }
    // A colon after the last slash is a tag. A colon before it is the
    // port of the registry.
    const colon = rest.lastIndexOf(":");
    if (colon > rest.lastIndexOf("/")) {
        rest = rest.slice(0, colon);
    }
    return rest;
}

/**
 * Read the output of the container read.
 * @param output The output of docker inspect
 * @returns The resources in use, and the project of each volume
 */
export function parseContainerScan(output : string) : { used : ResourcesInUse, owners : Map<string, string> } {
    const used : ResourcesInUse = {
        images: new Set<string>(),
        volumes: new Set<string>(),
        networks: new Set<string>(),
    };
    const owners = new Map<string, string>();

    for (const raw of (output ?? "").split("\n")) {
        const line = raw.trim();
        if (line === "") {
            continue;
        }
        const parts = line.split("|");
        if (parts.length < 4) {
            continue;
        }

        const image = shortImageId(parts[0]);
        if (image !== "") {
            used.images.add(image);
        }

        const project = parts[3].trim();
        const hasProject = project !== "" && project !== "<no value>";

        for (const name of parts[1].split(",")) {
            const volume = name.trim();
            if (volume === "") {
                continue;
            }
            used.volumes.add(volume);
            if (hasProject) {
                owners.set(volume, project);
            }
        }

        for (const name of parts[2].split(",")) {
            if (name.trim() !== "") {
                used.networks.add(name.trim());
            }
        }
    }

    return {
        used,
        owners,
    };
}

/**
 * The volumes that a removal can take.
 *
 * A volume with a name of a user stays. Such a volume holds the data of
 * that user, and docker itself also keeps it without the --all option.
 * A volume of a container stays. A volume that a stack of this server
 * made stays, also after a down of that stack, because the server wrote
 * the project of that volume while a container of the stack existed.
 * @param rows The volumes of docker
 * @param used The resources that a container uses
 * @param projects The compose projects of this server
 * @param owners The project of each volume, from the table of the server
 * @returns The candidates, and the count of the volumes that stay
 */
export function selectVolumeCandidates(rows : Record<string, unknown>[], used : ResourcesInUse, projects : Set<string>, owners : Map<string, string>) : PrunePlan {
    const candidates : PruneCandidate[] = [];
    let kept = 0;

    for (const row of rows) {
        const name = String(row.Name ?? "");
        if (name === "") {
            continue;
        }

        const owner = owners.get(name) ?? labelValue(row.Labels, PROJECT_LABEL);
        const keep = used.volumes.has(name)
            || !isAnonymousVolume(row.Labels)
            || (owner !== null && projects.has(owner));

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
 * The networks that a removal can take.
 *
 * A network of a container stays, also when the container is stopped.
 * A network of a stack of this server stays, thus a stack that is not
 * running keeps its network. The networks of docker itself stay.
 * @param rows The networks of docker
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
 * The images that a removal can take.
 *
 * An image of a container stays, also when the container is stopped.
 * An image that a compose file of this server names stays, thus a stack
 * that is down keeps its images. A compose file that names an image
 * with a digest, and a compose file that builds an image, keep the
 * repository of that image, because such a name has no tag.
 * @param rows The images of docker
 * @param used The resources that a container uses
 * @param resources The images of the compose files of this server
 * @param danglingOnly True to keep each image that has a name
 * @returns The candidates, and the count of the images that stay
 */
export function selectImageCandidates(rows : Record<string, unknown>[], used : ResourcesInUse, resources : ProtectedResources, danglingOnly : boolean) : PrunePlan {
    const canonical = new Set<string>();
    for (const image of resources.images) {
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
        const dangling = isDanglingImage(repository, tag);
        const noTag = tag === "" || tag === "<none>";
        const name = dangling ? "<none>:<none>" : repository + ":" + tag;

        let keep = used.images.has(id);

        if (!keep && danglingOnly && !dangling) {
            keep = true;
        }

        if (!keep && !dangling) {
            // A compose file can name this repository with a digest, or
            // it can build the image. Such a name has no tag.
            keep = resources.repositories.has(repository);
        }

        if (!keep && !dangling && !noTag) {
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
            // An image without a tag needs its id. A remove of the name
            // "repository:<none>" cannot work.
            id: noTag ? id : name,
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
     * List the resources of one kind. The volumes and the networks come
     * from an inspect, thus their labels are an object. A label value
     * with a comma cannot give a wrong answer then.
     * @param kind The kind
     * @returns The objects of docker, one for each resource
     */
    static async list(kind : ResourceKind) : Promise<Record<string, unknown>[]> {
        if (kind === "images") {
            const res = await childProcessAsync.spawn("docker", [ "image", "ls", "--format", "json" ], DOCKER_SPAWN_OPTIONS);
            return parseJSONLines(res.stdout?.toString() ?? "");
        }

        const command = kind === "volumes" ? "volume" : "network";
        const list = await childProcessAsync.spawn("docker", [ command, "ls", "-q" ], DOCKER_SPAWN_OPTIONS);
        const names = (list.stdout?.toString() ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
        if (names.length === 0) {
            return [];
        }

        const res = await childProcessAsync.spawn("docker", [ command, "inspect", "--format", "json", "--", ...names ], DOCKER_SPAWN_OPTIONS);
        const text = (res.stdout?.toString() ?? "").trim();
        if (text === "") {
            return [];
        }

        // An inspect gives one array, or one object for each line. Both
        // forms come from the docker versions that this server meets.
        try {
            const data = JSON.parse(text);
            if (Array.isArray(data)) {
                return data as Record<string, unknown>[];
            }
        } catch (e) {
            // The output holds one object for each line
        }
        return parseJSONLines(text);
    }

    /**
     * List the resources of one kind, and say for each one if a
     * container uses it. A container that is stopped counts. A read of
     * the containers that is not complete gives no answer in this field,
     * thus the interface does not say that a resource is free when the
     * server does not know.
     * @param kind The kind
     * @returns The objects of docker, each with the field inUse
     */
    static async listWithUsage(kind : ResourceKind) : Promise<Record<string, unknown>[]> {
        const [ rows, scan ] = await Promise.all([
            DockerResources.list(kind),
            DockerResources.scanContainers(),
        ]);

        if (!scan.complete) {
            return rows;
        }

        for (const row of rows) {
            if (kind === "images") {
                row.inUse = scan.used.images.has(shortImageId(row.ID));
            } else if (kind === "volumes") {
                row.inUse = scan.used.volumes.has(String(row.Name ?? ""));
            } else {
                const name = String(row.Name ?? "");
                row.inUse = scan.used.networks.has(name) || PREDEFINED_NETWORKS.has(name);
            }
        }

        // The projects of the volumes come from the containers that are
        // there now. A page that lists the volumes keeps that record new.
        await DockerResources.recordVolumeOwners(scan.owners);

        return rows;
    }

    /**
     * Read the containers. A container can go away between the list and
     * the inspect, and docker then exits with an error. One more try
     * gives the correct answer on a host that runs short containers.
     * @returns The resources in use, the project of each volume, and a
     * flag that says if the read is complete
     */
    static async scanContainers() : Promise<ContainerScan> {
        const format = "{{.Image}}|{{range .Mounts}}{{.Name}},{{end}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}|{{index .Config.Labels \"com.docker.compose.project\"}}";
        let last = {
            used: {
                images: new Set<string>(),
                volumes: new Set<string>(),
                networks: new Set<string>(),
            },
            owners: new Map<string, string>(),
        };

        for (let attempt = 0; attempt < 2; attempt++) {
            const list = await childProcessAsync.spawn("docker", [ "ps", "-a", "--format", "{{.ID}}" ], DOCKER_SPAWN_OPTIONS);
            const ids = (list.stdout?.toString() ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
            if (ids.length === 0) {
                return {
                    used: last.used,
                    owners: last.owners,
                    complete: true,
                };
            }

            let output = "";
            let failed = false;
            try {
                const res = await childProcessAsync.spawn("docker", [ "inspect", "--format", format, "--", ...ids ], DOCKER_SPAWN_OPTIONS);
                output = res.stdout?.toString() ?? "";
            } catch (e) {
                // A container that went away gives an error, and the
                // output still holds the other containers
                output = ((e as { stdout ?: string | Buffer })?.stdout ?? "").toString();
                failed = true;
            }

            last = parseContainerScan(output);
            if (!failed) {
                return {
                    used: last.used,
                    owners: last.owners,
                    complete: true,
                };
            }
        }

        log.warn("dockerResources", "Docker did not answer for each container, thus the list of the resources in use is not complete");
        return {
            used: last.used,
            owners: last.owners,
            complete: false,
        };
    }

    /**
     * Write the project of each volume that a container holds now. A
     * removal reads this table later, when the container of the stack is
     * not there.
     * @param owners The project of each volume
     */
    static async recordVolumeOwners(owners : Map<string, string>) : Promise<void> {
        if (owners.size === 0) {
            return;
        }
        const seenAt = new Date().toISOString();
        try {
            for (const [ volume, project ] of owners) {
                await R.knex("mod_volume_owner")
                    .insert({
                        volume,
                        project,
                        seen_at: seenAt,
                    })
                    .onConflict("volume")
                    .merge([ "project", "seen_at" ]);
            }
        } catch (e) {
            log.warn("dockerResources", "Cannot write the projects of the volumes: " + errorMessage(e));
        }
    }

    /**
     * The project of each volume, from the table and from the containers
     * that are there now.
     * @param fromContainers The projects that the container read found
     * @returns The project of each volume
     */
    static async volumeOwners(fromContainers : Map<string, string>) : Promise<Map<string, string>> {
        const owners = new Map<string, string>();
        try {
            const rows = await R.knex("mod_volume_owner").select("volume", "project");
            for (const row of rows) {
                owners.set(String(row.volume), String(row.project));
            }
        } catch (e) {
            // Without this table the server does not know which stack
            // made a volume, thus a removal must not take one.
            log.warn("dockerResources", "Cannot read the projects of the volumes: " + errorMessage(e));
            throw new Error("Cannot read the projects of the volumes. Try again.");
        }
        for (const [ volume, project ] of fromContainers) {
            owners.set(volume, project);
        }
        return owners;
    }

    /**
     * What a removal of this kind takes, and how many resources stay.
     * The user reads this list before the removal runs.
     * @param kind The prune operation
     * @param resources The resources that the removal must keep
     * @returns The plan
     */
    static async planPrune(kind : PruneKind, resources : ProtectedResources) : Promise<PrunePlan> {
        const scan = await DockerResources.scanContainers();

        // A read that is not complete makes a resource of a container
        // that the read missed look free. A removal must not run then.
        if (!scan.complete) {
            throw new Error("Docker did not answer for each container. Try again.");
        }

        await DockerResources.recordVolumeOwners(scan.owners);

        if (kind === "volumes") {
            const owners = await DockerResources.volumeOwners(scan.owners);
            return selectVolumeCandidates(await DockerResources.list("volumes"), scan.used, resources.projects, owners);
        }
        if (kind === "networks") {
            return selectNetworkCandidates(await DockerResources.list("networks"), scan.used, resources.projects);
        }
        return selectImageCandidates(await DockerResources.list("images"), scan.used, resources, kind === "images");
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
     * Remove the resources that the user accepted, one after the other.
     *
     * This server does not use the prune command of docker. That command
     * removes the network of a stack that is stopped, and the images of
     * a stack that is down. It also gives no list of the resources
     * before it removes them.
     *
     * The removal takes only a resource that the user saw and that the
     * new plan also holds. A resource that became free after the user
     * read the list stays for the next removal.
     * @param kind The prune operation
     * @param resources The resources that the removal must keep
     * @param accepted The ids that the user accepted
     * @returns The resources that went away, the failures, and the count
     * of the accepted ids that the new plan does not hold
     */
    static async prune(kind : PruneKind, resources : ProtectedResources, accepted : string[]) : Promise<{ removed : PruneCandidate[], failed : { name : string, error : string }[], skipped : number }> {
        const plan = await DockerResources.planPrune(kind, resources);
        const acceptedIds = new Set(accepted);
        const removed : PruneCandidate[] = [];
        const failed : { name : string, error : string }[] = [];

        const targets = plan.candidates.filter((candidate) => acceptedIds.has(candidate.id));
        const skipped = acceptedIds.size - targets.length;

        const kindOfResource : ResourceKind = kind === "volumes" ? "volumes" : (kind === "networks" ? "networks" : "images");

        for (const candidate of targets) {
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
            skipped,
        };
    }
}
