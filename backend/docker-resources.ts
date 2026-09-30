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

/** Built-in docker networks, which cannot be removed */
const PREDEFINED_NETWORKS = new Set([ "bridge", "host", "none" ]);

/** Label that docker compose puts on the resources of a project */
const PROJECT_LABEL = "com.docker.compose.project";

/** Label that docker puts on a volume it named itself */
const ANONYMOUS_LABEL = "com.docker.volume.anonymous";

/** One resource that a prune can remove. */
export interface PruneCandidate {
    /** Argument for the remove command */
    id : string;
    /** Display name */
    name : string;
    /** Extra display text, for example the size */
    detail : string;
}

/** What a prune removes, and how many resources it keeps. */
export interface PrunePlan {
    candidates : PruneCandidate[];
    /** Count of resources kept because this server protects them */
    kept : number;
}

/**
 * Resources a prune must keep. A stopped stack still needs its images, volumes, and networks.
 */
export interface ProtectedResources {
    /** Compose projects of this server's stacks */
    projects : Set<string>;
    /** Images named in those stacks' compose files */
    images : Set<string>;
    /** Repositories to keep regardless of tag: digest-pinned and built images have no tag to compare. */
    repositories : Set<string>;
}

/**
 * Resources used by any container. Stopped containers count too, because
 * docker's own prune does not keep their networks.
 */
export interface ResourcesInUse {
    /** Short image ids */
    images : Set<string>;
    /** Volume names */
    volumes : Set<string>;
    /** Network names */
    networks : Set<string>;
}

/** Result of a container scan. */
export interface ContainerScan {
    used : ResourcesInUse;
    /** Compose project of each volume, from the containers */
    owners : Map<string, string>;
    /** False when docker did not answer for every container. Do not prune then: resources of missed containers look free. */
    complete : boolean;
}

/**
 * True when a name is safe to pass to docker as an argument. Image names can
 * hold a registry, path, tag, and digest; a leading dash would be an option.
 * @param name The name from the client
 * @returns True when the name is safe as an argument
 */
export function isDockerResourceName(name : string) : boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*$/.test(name) && name.length <= 500;
}

/**
 * Parse `--format json` output, which has one object per line.
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
            // Skip non-JSON lines, such as warnings
        }
    }
    return list;
}

/**
 * Value of one label. Inspect gives labels as an object; `image ls` gives one
 * "a=1,b=2" string, which cannot hold a comma in a value, so prefer the object.
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
 * True when docker named this volume itself (image VOLUME or compose short
 * form), so the user never named it. Docker's own prune checks the same label.
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
 * Short image id without the algorithm prefix. Docker gives ids in several forms.
 * @param id The id
 * @returns The short form
 */
export function shortImageId(id : unknown) : string {
    return String(id ?? "").replace(/^sha256:/, "").slice(0, 12);
}

/**
 * True when the image is dangling. Same test as docker: repository and tag are
 * both empty. An image with a repository but no tag was pulled by digest.
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
 * Repository part of an image name, without tag or digest, as the repository
 * column of `docker image ls` shows it.
 * @param image The image name from a compose file
 * @returns The repository, or an empty text when the name is empty
 */
export function refRepository(image : string) : string {
    let rest = (image ?? "").trim();
    const at = rest.lastIndexOf("@");
    if (at > 0) {
        rest = rest.slice(0, at);
    }
    // A colon after the last slash is a tag; one before it is a registry port.
    const colon = rest.lastIndexOf(":");
    if (colon > rest.lastIndexOf("/")) {
        rest = rest.slice(0, colon);
    }
    return normalizeRepository(rest);
}

/**
 * The repository as `docker image ls` shows it: Docker Hub names lose the
 * registry and the `library/` prefix, so `docker.io/library/postgres`
 * becomes `postgres`.
 * @param repository A repository name
 * @returns The short name
 */
export function normalizeRepository(repository : string) : string {
    let rest = repository.toLowerCase();
    for (const prefix of [ "docker.io/", "index.docker.io/", "registry-1.docker.io/" ]) {
        if (rest.startsWith(prefix)) {
            rest = rest.slice(prefix.length);
            break;
        }
    }
    if (rest.startsWith("library/") && rest.indexOf("/", "library/".length) === -1) {
        rest = rest.slice("library/".length);
    }
    return rest;
}

/**
 * Parse the output of the container scan.
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
 * Volumes a prune can remove. Kept: named volumes (user data; docker also keeps
 * them without --all), volumes of any container, and volumes of this server's
 * stacks, also after a down, because the owner table recorded their project.
 * @param rows The volumes of docker
 * @param used The resources that a container uses
 * @param projects The compose projects of this server
 * @param owners The project of each volume, from the owner table
 * @returns The candidates and the count kept
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
 * Networks a prune can remove. Kept: networks of any container (also stopped),
 * networks of this server's stacks (also when not running), and built-in networks.
 * @param rows The networks of docker
 * @param used The resources that a container uses
 * @param projects The compose projects of this server
 * @returns The candidates and the count kept
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
 * Images a prune can remove. Kept: images of any container (also stopped) and
 * images named in this server's compose files (also when the stack is down).
 * Digest-pinned and built images have no tag, so they match by repository.
 * @param rows The images of docker
 * @param used The resources that a container uses
 * @param resources The images of the compose files of this server
 * @param danglingOnly True to keep every image that has a name
 * @returns The candidates and the count kept
 */
export function selectImageCandidates(rows : Record<string, unknown>[], used : ResourcesInUse, resources : ProtectedResources, danglingOnly : boolean) : PrunePlan {
    const canonical = new Set<string>();
    for (const image of resources.images) {
        try {
            canonical.add(canonicalRef(parseImageRef(image)));
        } catch (e) {
            // An unparsable name protects nothing
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
            // Digest-pinned or built images in a compose file have no tag, so match by repository
            keep = resources.repositories.has(normalizeRepository(repository));
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
            // Untagged images need the id; "repository:<none>" cannot be removed by name
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

/** Images, volumes, and networks on the host. */
export class DockerResources {

    /**
     * List the resources of one kind. Volumes and networks come from inspect,
     * so their labels are an object and commas in label values are safe.
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

        // Depending on the docker version, inspect gives one array or one object per line
        try {
            const data = JSON.parse(text);
            if (Array.isArray(data)) {
                return data as Record<string, unknown>[];
            }
        } catch (e) {
            // One object per line
        }
        return parseJSONLines(text);
    }

    /**
     * List the resources of one kind and set inUse when any container (also
     * stopped) uses it. After an incomplete scan inUse is left out, so the UI
     * never shows a resource as free when the server does not know.
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

        // The scan is fresh, so use it to refresh the volume owner records
        await DockerResources.recordVolumeOwners(scan.owners);

        return rows;
    }

    /**
     * Scan all containers. A container can go away between ps and inspect,
     * which makes docker fail; one retry helps on hosts with short-lived containers.
     * @returns The resources in use, the project of each volume, and whether the scan is complete
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
                // A removed container gives an error, but stdout still holds the others
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
     * Record the project of each volume in use now, so a later prune knows the
     * owner after the stack's containers are gone.
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
     * Scan the containers and record the volume owners. Called after container
     * changes, so the record exists before the stack goes down. Errors are only
     * logged; the next call writes the records again.
     */
    static async syncVolumeOwners() : Promise<void> {
        // Deploys and restart loops cause many event batches. Run one scan at a
        // time; batches that arrive meanwhile share one follow-up scan.
        if (DockerResources.volumeSync) {
            DockerResources.volumeSyncAgain = true;
            return DockerResources.volumeSync;
        }
        DockerResources.volumeSync = (async () => {
            do {
                DockerResources.volumeSyncAgain = false;
                try {
                    const scan = await DockerResources.scanContainers();
                    await DockerResources.recordVolumeOwners(scan.owners);
                } catch (e) {
                    log.warn("dockerResources", "Cannot read the projects of the volumes: " + errorMessage(e));
                }
            } while (DockerResources.volumeSyncAgain);
        })().finally(() => {
            DockerResources.volumeSync = undefined;
        });
        return DockerResources.volumeSync;
    }

    private static volumeSync? : Promise<void>;
    private static volumeSyncAgain = false;

    /**
     * Delete owner records of volumes no longer on the host, for example after
     * a stack comes back under a new name.
     * @param rows The volumes of docker
     */
    static async forgetGoneVolumes(rows : Record<string, unknown>[]) : Promise<void> {
        try {
            const present = new Set(rows.map((row) => String(row.Name ?? "")));
            const known = await R.knex("mod_volume_owner").select("volume");
            const gone = known
                .map((row : { volume : string }) => String(row.volume))
                .filter((volume : string) => !present.has(volume));
            if (gone.length > 0) {
                await R.knex("mod_volume_owner").whereIn("volume", gone).delete();
            }
        } catch (e) {
            log.warn("dockerResources", "Cannot clean the projects of the volumes: " + errorMessage(e));
        }
    }

    /**
     * Project of each volume, from the owner table plus the current containers.
     * @param fromContainers The projects that the container scan found
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
            // Without this table we cannot tell which stack made a volume, so do not prune any
            log.warn("dockerResources", "Cannot read the projects of the volumes: " + errorMessage(e));
            throw new Error("Cannot read the projects of the volumes. Try again.");
        }
        for (const [ volume, project ] of fromContainers) {
            owners.set(volume, project);
        }
        return owners;
    }

    /**
     * What a prune of this kind removes and keeps. The user reviews it before the prune runs.
     * @param kind The prune operation
     * @param resources The resources that the removal must keep
     * @returns The plan
     */
    static async planPrune(kind : PruneKind, resources : ProtectedResources) : Promise<PrunePlan> {
        const scan = await DockerResources.scanContainers();

        // An incomplete scan makes resources of missed containers look free, so refuse
        if (!scan.complete) {
            throw new Error("Docker did not answer for each container. Try again.");
        }

        await DockerResources.recordVolumeOwners(scan.owners);

        if (kind === "volumes") {
            const rows = await DockerResources.list("volumes");
            await DockerResources.forgetGoneVolumes(rows);
            const owners = await DockerResources.volumeOwners(scan.owners);
            return selectVolumeCandidates(rows, scan.used, resources.projects, owners);
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
     * Remove the resources the user accepted, one by one.
     *
     * Docker's own prune is not used: it removes networks of stopped stacks and
     * images of stacks that are down, and shows no list first.
     *
     * Only resources the user saw that are also in a fresh plan are removed.
     * A resource that became free after the user read the list waits for the next prune.
     * @param kind The prune operation
     * @param resources The resources that the removal must keep
     * @param accepted The ids that the user accepted
     * @returns The removed resources, the failures, and the count of accepted
     * ids missing from the fresh plan
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
                // Another process may have removed it since the plan; report a failure only
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
