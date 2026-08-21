import { AgentSocketHandler } from "../agent-socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, errorMessage, isOneOf, ValidationError } from "../util-server";
import { Stack } from "../stack";
import { AgentSocket } from "../../common/agent-socket";
import { log } from "../log";
import { ImageUpdateChecker } from "../image-update";
import { StackBackup } from "../stack-backup";
import { DockerResources, PRUNE_KINDS, RESOURCE_KINDS } from "../docker-resources";

/**
 * Put the arguments of a save event in sequence. A client without override
 * support sends four arguments, so the acknowledge function arrives in the
 * position of the override.
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
 * Make sure that the content arguments of a save or a validation have the
 * correct types.
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
 * The answer of an event that runs `docker compose config`. The ok field
 * shows that the event was successful. A configuration error is a normal
 * answer here, and it goes in its own field.
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

        // Pull the git checkout of a stack, then deploy it. This event only
        // adds a function. The frontend shows the button only when the stack
        // object holds git data, thus an old agent never gets this event.
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
                const serviceStatusList = Object.fromEntries(await stack.getServiceStatusList());
                callbackResult({
                    ok: true,
                    serviceStatusList,
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

        // The results of the image update check. This event only adds a
        // function to the socket API.
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
                // A check that the user starts examines each image, also
                // an image that waits after a failure
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
                const count = await server.imageUpdateChecker.checkStack(stackName);
                callbackResult({
                    ok: true,
                    count,
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

        // Put a backup back. The files of the stack change, the
        // containers do not. A deploy applies the files.
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

        // The images, the volumes, and the networks of the host
        agentSocket.on("getDockerResources", async (kind : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!isOneOf(RESOURCE_KINDS, kind)) {
                    throw new ValidationError("Unknown resource kind");
                }
                callbackResult({
                    ok: true,
                    resources: await DockerResources.list(kind),
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

        agentSocket.on("pruneDockerResources", async (kind : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!isOneOf(PRUNE_KINDS, kind)) {
                    throw new ValidationError("Unknown prune kind");
                }
                const output = await DockerResources.prune(kind);
                callbackResult({
                    ok: true,
                    output,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // The log of one service. The answer holds the terminal name,
        // and the client joins that terminal.
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

        // The configuration that docker makes from the files of a stack.
        // This event only adds a function to the socket API.
        agentSocket.on("getComposeConfig", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);

                // The process runs in the stack directory, thus the
                // directory must exist. The interface shows the button for
                // a managed stack only, so this refuses a request that
                // does not come from the interface.
                if (!stack.isManagedByDockge) {
                    throw new ValidationError("stackNotManagedByDockgeMsg");
                }

                const result = await stack.getComposeConfig();
                callbackResult(composeConfigResult(result), callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Examine editor content with docker, before a save writes it.
        // This event only adds a function to the socket API.
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

