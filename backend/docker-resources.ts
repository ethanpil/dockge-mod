import childProcessAsync from "promisify-child-process";
import { DOCKER_SPAWN_OPTIONS, ValidationError } from "./util-server";

/** The kinds of resources that the resources page shows */
export const RESOURCE_KINDS = [ "images", "volumes", "networks" ] as const;
export type ResourceKind = typeof RESOURCE_KINDS[number];

/** The prune operations */
export const PRUNE_KINDS = [ "images", "images-all", "volumes", "networks", "build-cache" ] as const;
export type PruneKind = typeof PRUNE_KINDS[number];

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
        const res = await childProcessAsync.spawn("docker", [ command[kind], "rm", name ], DOCKER_SPAWN_OPTIONS);
        return res.stdout?.toString() ?? "";
    }

    /**
     * Remove the resources that nothing uses.
     * @param kind The prune operation
     * @returns The output of docker, with the space that is free now
     */
    static async prune(kind : PruneKind) : Promise<string> {
        const args : Record<PruneKind, string[]> = {
            "images": [ "image", "prune", "-f" ],
            "images-all": [ "image", "prune", "-a", "-f" ],
            "volumes": [ "volume", "prune", "-f" ],
            "networks": [ "network", "prune", "-f" ],
            "build-cache": [ "builder", "prune", "-f" ],
        };
        const res = await childProcessAsync.spawn("docker", args[kind], {
            ...DOCKER_SPAWN_OPTIONS,
            // A prune of many images can take a while
            timeout: 10 * 60 * 1000,
        });
        return res.stdout?.toString() ?? "";
    }
}
