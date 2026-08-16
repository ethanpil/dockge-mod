// @ts-ignore
import composerize from "composerize";
import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { R } from "redbean-node";
import { loginRateLimiter, twoFaRateLimiter } from "../rate-limiter";
import { generatePasswordHash, needRehashPassword, shake256, SHAKE256_LENGTH, verifyPassword } from "../password-hash";
import { User } from "../models/user";
import {
    callbackError,
    callbackResult,
    checkLogin,
    DockgeSocket,
    doubleCheckPassword,
    errorMessage,
    JWTDecoded,
    stderrOf,
    ValidationError
} from "../util-server";
import { passwordStrength } from "check-password-strength";
import jwt from "jsonwebtoken";
import { Settings } from "../settings";
import fs, { promises as fsAsync } from "fs";
import path from "path";
import childProcessAsync from "promisify-child-process";
import { composeOverrideTemplateFileName, defaultComposeOverrideTemplate, POLL_INTERVAL_DEFAULT, POLL_INTERVAL_MAX, POLL_INTERVAL_MIN } from "../../common/util-common";

/**
 * One item of the health report. `ok` says if the check passed. `info`
 * holds the version of a tool, or the reason of a failure.
 */
interface HealthItem {
    key : string;
    ok : boolean;
    info : string;
}

/**
 * Run a tool with a version argument and make a health item from the first
 * line of its output.
 * @param key Name of the check in the report
 * @param file The program to run
 * @param args The arguments of the program
 * @returns The health item
 */
async function checkTool(key : string, file : string, args : string[]) : Promise<HealthItem> {
    try {
        const res = await childProcessAsync.spawn(file, args, {
            encoding: "utf-8",
            // A tool that does not answer must not keep the health report
            // for ever. The same limits as the other tool processes.
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000,
        });
        const firstLine = (res.stdout?.toString() ?? "").trim().split(/\r?\n/)[0];
        return {
            key,
            ok: true,
            info: firstLine,
        };
    } catch (e) {
        // The first line of stderr holds the reason from the tool itself,
        // for example "docker: 'compose' is not a docker command". The
        // generic message only says that the process failed.
        const stderr = stderrOf(e)?.split(/\r?\n/)[0];
        return {
            key,
            ok: false,
            info: stderr || errorMessage(e),
        };
    }
}

/**
 * Make a health item that says if the server can write in a directory.
 * @param key Name of the check in the report
 * @param dir The directory to examine
 * @returns The health item
 */
async function checkWritableDir(key : string, dir : string) : Promise<HealthItem> {
    try {
        await fsAsync.access(dir, fs.constants.W_OK);
        return {
            key,
            ok: true,
            info: path.resolve(dir),
        };
    } catch (e) {
        return {
            key,
            ok: false,
            info: errorMessage(e),
        };
    }
}

export class MainSocketHandler extends SocketHandler {
    create(socket : DockgeSocket, server : DockgeServer) {

        // ***************************
        // Public Socket API
        // ***************************

        // Setup
        socket.on("setup", async (username, password, callback) => {
            try {
                if (passwordStrength(password).value === "Too weak") {
                    throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
                }

                if ((await R.knex("user").count("id as count").first()).count !== 0) {
                    throw new Error("dockge-mod has been initialized. If you want to run setup again, please delete the database.");
                }

                const user = R.dispense("user");
                user.username = username;
                user.password = generatePasswordHash(password);
                await R.store(user);

                server.needSetup = false;

                callback({
                    ok: true,
                    msg: "successAdded",
                    msgi18n: true,
                });

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        // Login by token
        socket.on("loginByToken", async (token, callback) => {
            const clientIP = await server.getClientIP(socket);

            log.info("auth", `Login by token. IP=${clientIP}`);

            try {
                const decoded = jwt.verify(token, server.jwtSecret) as JWTDecoded;

                log.info("auth", "Username from JWT: " + decoded.username);

                const user = await R.findOne("user", " username = ? AND active = 1 ", [
                    decoded.username,
                ]) as User;

                if (user) {
                    // Check if the password changed
                    if (decoded.h !== shake256(user.password, SHAKE256_LENGTH)) {
                        throw new Error("The token is invalid due to password change or old token");
                    }

                    log.debug("auth", "afterLogin");
                    await server.afterLogin(socket, user);
                    log.debug("auth", "afterLogin ok");

                    log.info("auth", `Successfully logged in user ${decoded.username}. IP=${clientIP}`);

                    callback({
                        ok: true,
                    });
                } else {

                    log.info("auth", `Inactive or deleted user ${decoded.username}. IP=${clientIP}`);

                    callback({
                        ok: false,
                        msg: "authUserInactiveOrDeleted",
                        msgi18n: true,
                    });
                }
            } catch (error) {
                if (!(error instanceof Error)) {
                    console.error("Unknown error:", error);
                    return;
                }
                log.error("auth", `Invalid token. IP=${clientIP}`);
                if (error.message) {
                    log.error("auth", error.message + ` IP=${clientIP}`);
                }
                callback({
                    ok: false,
                    msg: "authInvalidToken",
                    msgi18n: true,
                });
            }

        });

        // Login
        socket.on("login", async (data, callback) => {
            const clientIP = await server.getClientIP(socket);

            log.info("auth", `Login by username + password. IP=${clientIP}`);

            // Checking
            if (typeof callback !== "function") {
                return;
            }

            if (!data) {
                return;
            }

            // Login Rate Limit
            if (!await loginRateLimiter.pass(callback)) {
                log.info("auth", `Too many failed requests for user ${data.username}. IP=${clientIP}`);
                return;
            }

            const user = await this.login(data.username, data.password);

            if (user) {
                if (user.twofa_status === 0) {
                    server.afterLogin(socket, user);

                    log.info("auth", `Successfully logged in user ${data.username}. IP=${clientIP}`);

                    callback({
                        ok: true,
                        token: User.createJWT(user, server.jwtSecret),
                    });
                }

                if (user.twofa_status === 1 && !data.token) {

                    log.info("auth", `2FA token required for user ${data.username}. IP=${clientIP}`);

                    callback({
                        tokenRequired: true,
                    });
                }

                if (data.token) {
                    // @ts-ignore
                    const verify = notp.totp.verify(data.token, user.twofa_secret, twoFAVerifyOptions);

                    if (user.twofa_last_token !== data.token && verify) {
                        server.afterLogin(socket, user);

                        await R.exec("UPDATE `user` SET twofa_last_token = ? WHERE id = ? ", [
                            data.token,
                            socket.userID,
                        ]);

                        log.info("auth", `Successfully logged in user ${data.username}. IP=${clientIP}`);

                        callback({
                            ok: true,
                            token: User.createJWT(user, server.jwtSecret),
                        });
                    } else {

                        log.warn("auth", `Invalid token provided for user ${data.username}. IP=${clientIP}`);

                        callback({
                            ok: false,
                            msg: "authInvalidToken",
                            msgi18n: true,
                        });
                    }
                }
            } else {

                log.warn("auth", `Incorrect username or password for user ${data.username}. IP=${clientIP}`);

                callback({
                    ok: false,
                    msg: "authIncorrectCreds",
                    msgi18n: true,
                });
            }

        });

        // Change Password
        socket.on("changePassword", async (password, callback) => {
            try {
                checkLogin(socket);

                if (! password.newPassword) {
                    throw new Error("Invalid new password");
                }

                if (passwordStrength(password.newPassword).value === "Too weak") {
                    throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
                }

                let user = await doubleCheckPassword(socket, password.currentPassword);
                await user.resetPassword(password.newPassword);

                server.disconnectAllSocketClients(user.id, socket.id);

                callback({
                    ok: true,
                    msg: "Password has been updated successfully.",
                });

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        socket.on("getSettings", async (callback) => {
            try {
                checkLogin(socket);
                const data = await Settings.getSettings("general");

                if (fs.existsSync(path.join(server.stacksDir, "global.env"))) {
                    data.globalENV = fs.readFileSync(path.join(server.stacksDir, "global.env"), "utf-8");
                } else {
                    data.globalENV = "# VARIABLE=value #comment";
                }

                const overrideTemplatePath = path.join(server.config.dataDir, composeOverrideTemplateFileName);
                if (fs.existsSync(overrideTemplatePath)) {
                    data.composeOverrideTemplate = fs.readFileSync(overrideTemplatePath, "utf-8");
                } else {
                    data.composeOverrideTemplate = defaultComposeOverrideTemplate;
                }

                callback({
                    ok: true,
                    data: data,
                });

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        socket.on("setSettings", async (data, currentPassword, callback) => {
            try {
                checkLogin(socket);

                // If currently is disabled auth, don't need to check
                // Disabled Auth + Want to Disable Auth => No Check
                // Disabled Auth + Want to Enable Auth => No Check
                // Enabled Auth + Want to Disable Auth => Check!!
                // Enabled Auth + Want to Enable Auth => No Check
                const currentDisabledAuth = await Settings.get("disableAuth");
                if (!currentDisabledAuth && data.disableAuth) {
                    await doubleCheckPassword(socket, currentPassword);
                }
                // Handle global.env
                if (data.globalENV && data.globalENV != "# VARIABLE=value #comment") {
                    await fsAsync.writeFile(path.join(server.stacksDir, "global.env"), data.globalENV);
                } else {
                    await fsAsync.rm(path.join(server.stacksDir, "global.env"), {
                        recursive: true,
                        force: true
                    });
                }
                delete data.globalENV;

                // Handle the template of the override file. The default needs
                // no file, thus the file goes away when the text is the same.
                const overrideTemplatePath = path.join(server.config.dataDir, composeOverrideTemplateFileName);
                if (typeof data.composeOverrideTemplate === "string") {
                    if (data.composeOverrideTemplate.trim() !== "" && data.composeOverrideTemplate !== defaultComposeOverrideTemplate) {
                        await fsAsync.writeFile(overrideTemplatePath, data.composeOverrideTemplate);
                    } else {
                        await fsAsync.rm(overrideTemplatePath, {
                            force: true
                        });
                    }
                }
                delete data.composeOverrideTemplate;

                // Keep the stored poll interval in its limits. The form
                // limits are only in the browser, and a different client
                // can send any value. An empty field gives the default,
                // not the minimum, because Number("") is 0.
                if ("pollInterval" in data) {
                    const raw = data.pollInterval;
                    const empty = raw == null || (typeof raw === "string" && raw.trim() === "");
                    const n = Number(raw);
                    if (empty || !Number.isFinite(n)) {
                        data.pollInterval = POLL_INTERVAL_DEFAULT;
                    } else {
                        data.pollInterval = Math.min(POLL_INTERVAL_MAX, Math.max(POLL_INTERVAL_MIN, Math.round(n)));
                    }
                }

                await Settings.setSettings("general", data);

                callback({
                    ok: true,
                    msg: "Saved"
                });

                // Each client with a login gets the new values, not only
                // the client that saved. A failure of this broadcast must
                // not become an unhandled rejection.
                server.sendInfoToAllClients().catch((err) => {
                    log.warn("setSettings", "Cannot send info to all clients: " + errorMessage(err));
                });

            } catch (e) {
                // The settings page waits for an answer. A value that is
                // not an Error object must also give one, or the page
                // waits for ever.
                callbackError(e, callback);
            }
        });

        // Disconnect all other socket clients of the user
        socket.on("disconnectOtherSocketClients", async () => {
            try {
                checkLogin(socket);
                server.disconnectAllSocketClients(socket.userID, socket.id);
            } catch (e) {
                if (e instanceof Error) {
                    log.warn("disconnectOtherSocketClients", e.message);
                }
            }
        });

        // Health report for the settings page. The checks examine the tools
        // that the features of this application need. This event only adds a
        // function to the socket API.
        socket.on("getDockgeHealth", async (callback) => {
            try {
                checkLogin(socket);

                const health : HealthItem[] = await Promise.all([
                    checkTool("docker", "docker", [ "--version" ]),
                    checkTool("dockerCompose", "docker", [ "compose", "version" ]),
                    checkTool("git", "git", [ "--version" ]),
                    checkWritableDir("stacksDir", server.stacksDir),
                    checkWritableDir("dataDir", server.config.dataDir),
                ]);

                callbackResult({
                    ok: true,
                    health,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // composerize
        socket.on("composerize", async (dockerRunCommand : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(dockerRunCommand) !== "string") {
                    throw new ValidationError("dockerRunCommand must be a string");
                }

                // Option: 'latest' | 'v2x' | 'v3x'
                let composeTemplate = composerize(dockerRunCommand, "", "latest");

                // Remove the first line "name: <your project name>"
                composeTemplate = composeTemplate.split("\n").slice(1).join("\n");

                callback({
                    ok: true,
                    composeTemplate,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    async login(username : string, password : string) : Promise<User | null> {
        if (typeof username !== "string" || typeof password !== "string") {
            return null;
        }

        const user = await R.findOne("user", " username = ? AND active = 1 ", [
            username,
        ]) as User;

        if (user && verifyPassword(password, user.password)) {
            // Upgrade the hash to bcrypt
            if (needRehashPassword(user.password)) {
                await R.exec("UPDATE `user` SET password = ? WHERE id = ? ", [
                    generatePasswordHash(password),
                    user.id,
                ]);
            }
            return user;
        }

        return null;
    }
}
