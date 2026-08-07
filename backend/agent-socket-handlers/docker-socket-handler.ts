import { AgentSocketHandler } from "../agent-socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { Stack } from "../stack";
import { AgentSocket } from "../../common/agent-socket";

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

                const stack = await Stack.getStack(server, stackName, true);
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
                server.sendStackList();
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
        if (typeof(name) !== "string") {
            throw new ValidationError("Name must be a string");
        }
        if (typeof(composeYAML) !== "string") {
            throw new ValidationError("Compose YAML must be a string");
        }
        if (typeof(composeENV) !== "string") {
            throw new ValidationError("Compose ENV must be a string");
        }
        if (typeof(isAdd) !== "boolean") {
            throw new ValidationError("isAdd must be a boolean");
        }
        if (composeOverrideYAML !== undefined && composeOverrideYAML !== null && typeof(composeOverrideYAML) !== "string") {
            throw new ValidationError("Compose override YAML must be a string");
        }

        const stack = new Stack(server, name, composeYAML, composeENV, composeOverrideYAML, false);
        await stack.save(isAdd);
        return stack;
    }

}

