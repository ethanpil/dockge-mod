import { AgentSocketHandler } from "../agent-socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, errorMessage, isOneOf, ValidationError } from "../util-server";
import { Stack } from "../stack";
import { AgentSocket } from "../../common/agent-socket";
import { log } from "../log";
import { ImageUpdateChecker } from "../image-update";
import { StackBackup } from "../stack-backup";
import { DockerResources, normalizeRepository, PRUNE_KINDS, ProtectedResources, refRepository, RESOURCE_KINDS } from "../docker-resources";
import { Terminal } from "../terminal";
import { getComposeTerminalName } from "../../common/util-common";

/**
 * Normalize the arguments of a save event. A client without override support
 * sends four arguments, so the callback arrives in the override position.
 * @param composeOverrideYAML Argument in the override position
 * @param callback Argument in the acknowledge position
 * @returns The two arguments in their correct positions
 */
function acceptSaveArgs(composeOverrideYAML : unknown, callback : unknown) {
    if (typeof composeOverrideYAML === "function" && callback === undefined) {
        return {
            composeOverrideYAML: undefined,
            callback: composeOverrideYAML,
        };
    }
    return {
        composeOverrideYAML,
        callback,
    };
}

/**
 * Check that the content arguments of a save or validation have the correct types.
 * @param name Name of the stack
 * @param composeYAML Content of the compose file
 * @param composeENV Content of the .env file
 * @param composeOverrideYAML Content of the override file, or null
 */
function checkComposeStrings(name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown) {
    if (typeof(name) !== "string") {
        throw new ValidationError("Name must be a string");
    }
    if (typeof(composeYAML) !== "string") {
        throw new ValidationError("Compose YAML must be a string");
    }
    if (typeof(composeENV) !== "string") {
        throw new ValidationError("Compose ENV must be a string");
    }
    if (composeOverrideYAML !== undefined && composeOverrideYAML !== null && typeof(composeOverrideYAML) !== "string") {
        throw new ValidationError("Compose override YAML must be a string");
    }
}

/**
 * Images, volumes, and networks a prune must keep. This server's stacks keep
 * their resources even when not running; docker does not know which stacks
 * this server manages, so its own prune cannot keep them.
 *
 * An unreadable compose file stops the prune, because an incomplete list
 * could let a stack's resource go away.
 * @param server The server, for the list of the stacks
 * @returns The compose projects and the images of the stacks
 */
async function protectedResources(server : DockgeServer) : Promise<ProtectedResources> {
    const projects = new Set<string>();
    const images = new Set<string>();
    const repositories = new Set<string>();

    // Read from disk, not the cache, so compose files changed outside this server are still protected
    const stackList = await Stack.getStackList(server, false);
    for (const stack of stackList.values()) {
        if (!stack.isManagedByDockge) {
            continue;
        }

        const info = stack.composeInfo;
        if (!info.ok) {
            throw new Error("Cannot read the compose file of the stack " + stack.name + ". Repair that file, then try again.");
        }

        projects.add(stack.name);
        for (const project of info.projectNames) {
            projects.add(project);
        }
        for (const image of info.images) {
            images.add(image);
            // `docker image ls` shows no tag for an image pulled by digest, so compare by repository
            if (image.includes("@")) {
                repositories.add(refRepository(image));
            }
        }
        for (const image of info.buildImages) {
            repositories.add(normalizeRepository(image));
        }
    }

    return {
        projects,
        images,
        repositories,
    };
}

/**
 * Answer for events that run `docker compose config`. ok means the event
 * succeeded; a config error is a normal answer and goes in configError.
 * @param result The result of the docker process
 * @returns The answer for the client
 */
function composeConfigResult(result : { ok : boolean, content : string }) {
    return {
        ok: true,
        composeConfig: result.ok ? result.content : "",
        configError: result.ok ? "" : result.content,
    };
}

export class DockerSocketHandler extends AgentSocketHandler {
    create(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {
        // Do not call super.create()

        agentSocket.on("deployStack", async (name : unknown, composeYAML : unknown, composeENV : unknown, isAdd : unknown, overrideArg? : unknown, callbackArg? : unknown) => {
            const { composeOverrideYAML, callback } = acceptSaveArgs(overrideArg, callbackArg);
            try {
                checkLogin(socket);
                // Check before the save, so a deploy that cannot run does not
                // change the files under a running operation
                if (typeof name === "string" && Terminal.getTerminal(getComposeTerminalName(socket.endpoint, name))) {
                    throw new ValidationError("Another operation is already running, please try again later.");
                }
                const stack = await this.saveStack(server, name, composeYAML, composeENV, isAdd, composeOverrideYAML);
                await stack.deploy(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deployed",
                    msgi18n: true,
                }, callback);
                stack.joinCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("saveStack", async (name : unknown, composeYAML : unknown, composeENV : unknown, isAdd : unknown, overrideArg? : unknown, callbackArg? : unknown) => {
            const { composeOverrideYAML, callback } = acceptSaveArgs(overrideArg, callbackArg);
            try {
                checkLogin(socket);
                await this.saveStack(server, name, composeYAML, composeENV, isAdd, composeOverrideYAML);
                callbackResult({
                    ok: true,
                    msg: "Saved",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("deleteStack", async (name : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(name) !== "string") {
                    throw new ValidationError("Name must be a string");
                }
                const stack = await Stack.getStack(server, name);

                try {
                    await stack.delete(socket);
                } catch (e) {
                    server.sendStackList();
                    throw e;
                }

                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deleted",
                    msgi18n: true,
                }, callback);

            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);

                if (stack.isManagedByDockge) {
                    stack.joinCombinedTerminal(socket);
                }

                callbackResult({
                    ok: true,
                    stack: await stack.toJSON(socket.endpoint),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // requestStackList
        agentSocket.on("requestStackList", async (callback) => {
            try {
                checkLogin(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Updated",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // startStack
        agentSocket.on("startStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.start(socket);
                callbackResult({
                    ok: true,
                    msg: "Started",
                    msgi18n: true,
                }, callback);
                server.sendStackList();

                stack.joinCombinedTerminal(socket);

            } catch (e) {
                callbackError(e, callback);
            }
        });

        // stopStack
        agentSocket.on("stopStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.stop(socket);
                callbackResult({
                    ok: true,
                    msg: "Stopped",
                    msgi18n: true,
                }, callback);
                server.sendStackList();

                stack.leaveCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // restartStack
        agentSocket.on("restartStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.restart(socket);
                callbackResult({
                    ok: true,
                    msg: "Restarted",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // updateStack
        agentSocket.on("updateStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.update(socket);
                callbackResult({
                    ok: true,
                    msg: "Updated",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Pull the git checkout of a stack, then deploy it. Additive event: the
        // frontend shows the button only for stacks with git data, so old agents never get it.
        agentSocket.on("gitPullStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);

                if (!stack.isGitRepo) {
                    throw new ValidationError("The stack directory is not a git checkout");
                }

                await stack.gitPull(socket);
                await stack.deploy(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deployed",
                    msgi18n: true,
                }, callback);
                stack.joinCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // down stack
        agentSocket.on("downStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.down(socket);
                callbackResult({
                    ok: true,
                    msg: "Downed",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Services status
        agentSocket.on("serviceStatusList", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                const containerList = Object.fromEntries(await stack.getServiceStatusList());

                // Dockge 1.5.0 expects one status string per service. The
                // container details go in a separate field.
                const serviceStatusList : Record<string, string> = {};
                for (const [ service, containers ] of Object.entries(containerList)) {
                    serviceStatusList[service] = (containers[0] as { status? : string } | undefined)?.status ?? "";
                }

                callbackResult({
                    ok: true,
                    serviceStatusList,
                    containerList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Docker stats
        agentSocket.on("dockerStats", async (callback) => {
            try {
                checkLogin(socket);

                const dockerStats = Object.fromEntries(await server.getDockerStats());
                callbackResult({
                    ok: true,
                    dockerStats,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Host stats for the dashboard (additive event; upstream agents
        // simply never answer it and the frontend hides the tiles)
        agentSocket.on("hostStats", async (callback) => {
            try {
                checkLogin(socket);

                callbackResult({
                    ok: true,
                    hostStats: await server.getHostStats(),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Start a service
        agentSocket.on("startService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof (stackName) !== "string" || typeof (serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.startService(socket, serviceName);
                stack.joinCombinedTerminal(socket); // Ensure the combined terminal is joined
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " started"
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Stop a service
        agentSocket.on("stopService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof (stackName) !== "string" || typeof (serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.stopService(socket, serviceName);
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " stopped"
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("restartService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof stackName !== "string" || typeof serviceName !== "string") {
                    throw new Error("Invalid stackName or serviceName");
                }

                const stack = await Stack.getStack(server, stackName, true);
                await stack.restartService(socket, serviceName);
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " restarted"
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Image update check results. Additive event.
        agentSocket.on("getImageUpdates", async (callback) => {
            try {
                checkLogin(socket);
                callbackResult({
                    ok: true,
                    imageUpdates: await ImageUpdateChecker.getAll(),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Start a check now. The answer comes at once, the check runs on.
        agentSocket.on("checkImageUpdates", async (callback) => {
            try {
                checkLogin(socket);
                const started = !server.imageUpdateChecker.isRunning();
                // A manual check examines every image, also those in a failure backoff
                server.imageUpdateChecker.checkAll(true).catch((e) => {
                    log.warn("imageUpdate", "Check failed: " + errorMessage(e));
                });
                callbackResult({
                    ok: true,
                    started,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Check the images of one stack now
        agentSocket.on("checkStackImageUpdates", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }
                const result = await server.imageUpdateChecker.checkStack(stackName);
                callbackResult({
                    ok: true,
                    started: result.started,
                    count: result.count,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // The backups of a stack
        agentSocket.on("getStackBackups", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }
                const stack = await Stack.getStack(server, stackName, true);
                callbackResult({
                    ok: true,
                    backups: await StackBackup.list(stack.name),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // The content of one backup
        agentSocket.on("getStackBackup", async (stackName : unknown, id : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string" || typeof(id) !== "number") {
                    throw new ValidationError("Stack name must be a string and id must be a number");
                }
                const stack = await Stack.getStack(server, stackName, true);
                callbackResult({
                    ok: true,
                    backup: await StackBackup.get(stack.name, id),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Restore a backup. This changes the stack files, not the containers;
        // a deploy applies them.
        agentSocket.on("restoreStackBackup", async (stackName : unknown, id : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string" || typeof(id) !== "number") {
                    throw new ValidationError("Stack name must be a string and id must be a number");
                }
                const existing = await Stack.getStack(server, stackName);
                if (!existing.isManagedByDockge) {
                    throw new ValidationError("Stack is not managed by dockge-mod");
                }
                const files = await StackBackup.get(existing.name, id);
                const stack = new Stack(server, existing.name, files.composeYAML, files.composeENV, files.composeOverrideYAML, false);
                await stack.save(false, "restore");
                server.sendStackList().catch((e) => {
                    log.warn("server", "Cannot send the stack list: " + errorMessage(e));
                });
                callbackResult({
                    ok: true,
                    msg: "Restored",
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Images, volumes, and networks of the host
        agentSocket.on("getDockerResources", async (kind : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!isOneOf(RESOURCE_KINDS, kind)) {
                    throw new ValidationError("Unknown resource kind");
                }
                callbackResult({
                    ok: true,
                    resources: await DockerResources.listWithUsage(kind),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("removeDockerResource", async (kind : unknown, name : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!isOneOf(RESOURCE_KINDS, kind)) {
                    throw new ValidationError("Unknown resource kind");
                }
                if (typeof(name) !== "string") {
                    throw new ValidationError("Name must be a string");
                }
                const output = await DockerResources.remove(kind, name);
                callbackResult({
                    ok: true,
                    output,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // What a prune removes and keeps, for the user to review first
        agentSocket.on("getPrunePlan", async (kind : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!isOneOf(PRUNE_KINDS, kind)) {
                    throw new ValidationError("Unknown prune kind");
                }
                const plan = await DockerResources.planPrune(kind, await protectedResources(server));
                callbackResult({
                    ok: true,
                    candidates: plan.candidates,
                    kept: plan.kept,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Remove the resources the user accepted. The client sends the ids of the
        // plan it showed, so a resource that became free since then stays.
        agentSocket.on("pruneDockerResources", async (kind : unknown, accepted : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!isOneOf(PRUNE_KINDS, kind)) {
                    throw new ValidationError("Unknown prune kind");
                }
                if (!Array.isArray(accepted) || accepted.some((id) => typeof id !== "string")) {
                    throw new ValidationError("The accepted resources must be a list of names");
                }
                const result = await DockerResources.prune(kind, await protectedResources(server), accepted as string[]);
                callbackResult({
                    ok: true,
                    removed: result.removed,
                    failed: result.failed,
                    skipped: result.skipped,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Log of one service. The answer holds the terminal name for the client to join.
        agentSocket.on("serviceLogs", async (stackName : unknown, serviceName : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string" || typeof(serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }
                const stack = await Stack.getStack(server, stackName);
                const terminalName = stack.joinServiceLogs(socket, serviceName);
                callbackResult({
                    ok: true,
                    terminalName,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("leaveServiceLogs", async (stackName : unknown, serviceName : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string" || typeof(serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }
                const stack = await Stack.getStack(server, stackName, true);
                stack.leaveServiceLogs(socket, serviceName);
                callbackResult({
                    ok: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // The config docker builds from the stack files. Additive event.
        agentSocket.on("getComposeConfig", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);

                // The process runs in the stack directory, so it must exist. The UI
                // shows this only for managed stacks, so refuse other requests.
                if (!stack.isManagedByDockge) {
                    throw new ValidationError("stackNotManagedByDockgeMsg");
                }

                const result = await stack.getComposeConfig();
                callbackResult(composeConfigResult(result), callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Validate editor content with docker before a save. Additive event.
        agentSocket.on("validateCompose", async (name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, callback) => {
            try {
                checkLogin(socket);
                checkComposeStrings(name, composeYAML, composeENV, composeOverrideYAML);

                const result = await Stack.validateConfig(server, name as string, composeYAML as string, composeENV as string, (composeOverrideYAML ?? null) as string | null);
                callbackResult(composeConfigResult(result), callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // getExternalNetworkList
        agentSocket.on("getDockerNetworkList", async (callback) => {
            try {
                checkLogin(socket);
                const dockerNetworkList = await server.getDockerNetworkList();
                callbackResult({
                    ok: true,
                    dockerNetworkList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    async saveStack(server : DockgeServer, name : unknown, composeYAML : unknown, composeENV : unknown, isAdd : unknown, composeOverrideYAML : unknown) : Promise<Stack> {
        // Check types
        checkComposeStrings(name, composeYAML, composeENV, composeOverrideYAML);
        if (typeof(isAdd) !== "boolean") {
            throw new ValidationError("isAdd must be a boolean");
        }

        const stack = new Stack(server, name as string, composeYAML as string, composeENV as string, composeOverrideYAML as string | null | undefined, false);
        await stack.save(isAdd);
        return stack;
    }

}

