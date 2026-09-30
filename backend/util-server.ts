import { Socket } from "socket.io";
import { Terminal } from "./terminal";
import { randomBytes } from "crypto";
import { log } from "./log";
import { ERROR_TYPE_VALIDATION, isComposeServiceName, isShellName } from "../common/util-common";
import { R } from "redbean-node";
import { verifyPassword } from "./password-hash";
import fs from "fs";
import { AgentManager } from "./agent-manager";

export interface JWTDecoded {
    username : string;
    h? : string;
}

export interface DockgeSocket extends Socket {
    userID: number;
    consoleTerminal? : Terminal;
    instanceManager : AgentManager;
    endpoint : string;
    emitAgent : (eventName : string, ...args : unknown[]) => void;
}

// For command line arguments, so they are nullable
export interface Arguments {
    sslKey? : string;
    sslCert? : string;
    sslKeyPassphrase? : string;
    port? : number;
    hostname? : string;
    dataDir? : string;
    stacksDir? : string;
    enableConsole? : boolean;
}

// Some config values are required
export interface Config extends Arguments {
    dataDir : string;
    stacksDir : string;
}

/**
 * Limits for awaited docker processes, so a hung process or huge output
 * cannot block the server.
 */
export const DOCKER_SPAWN_OPTIONS = {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
} as const;

export function checkLogin(socket : DockgeSocket) {
    if (!socket.userID) {
        throw new Error("You are not logged in.");
    }
}

export class ValidationError extends Error {
    constructor(message : string) {
        super(message);
    }
}

/**
 * Type guard: true when the value is in the list.
 * @param list The accepted values
 * @param value The value from the client
 * @returns True when the value is in the list
 */
export function isOneOf<T extends string>(list : readonly T[], value : unknown) : value is T {
    return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Reject a service name that is unsafe as a docker compose argument.
 * A name like --project-directory=/ would be parsed as an option.
 * @param serviceName The service name from the client
 */
export function checkServiceName(serviceName : string) {
    if (!isComposeServiceName(serviceName)) {
        throw new ValidationError("Invalid service name");
    }
}

/**
 * Reject a shell that is unsafe as a docker compose exec argument.
 * @param shell The shell from the client
 */
export function checkShellName(shell : string) {
    if (!isShellName(shell)) {
        throw new ValidationError("Invalid shell");
    }
}

export function callbackError(error : unknown, callback : unknown) {
    if (typeof(callback) !== "function") {
        log.error("console", "Callback is not a function");
        return;
    }

    // ValidationError extends Error, so check it first
    if (error instanceof ValidationError) {
        callback({
            ok: false,
            type: ERROR_TYPE_VALIDATION,
            msg: error.message,
            msgi18n: true,
        });
    } else if (error instanceof Error) {
        callback({
            ok: false,
            msg: error.message,
            msgi18n: true,
        });
    } else {
        // Non-Error rejections (e.g. strings from Terminal.exec) still need a
        // reply, or the client's buttons stay disabled. Log the raw value too.
        log.debug("console", "Non-error rejection: " + String(error));
        callback({
            ok: false,
            msg: String(error),
        });
    }
}

export function callbackResult(result : unknown, callback : unknown) {
    if (typeof(callback) !== "function") {
        log.error("console", "Callback is not a function");
        return;
    }
    callback(result);
}

export async function doubleCheckPassword(socket : DockgeSocket, currentPassword : unknown) {
    if (typeof currentPassword !== "string") {
        throw new Error("Wrong data type?");
    }

    let user = await R.findOne("user", " id = ? AND active = 1 ", [
        socket.userID,
    ]);

    if (!user || !verifyPassword(currentPassword, user.password)) {
        throw new Error("Incorrect current password");
    }

    return user;
}

/**
 * The stderr of a failed child process, if any. It holds the real reason;
 * the error message only says the process failed.
 * @param error The rejection value of a spawn
 * @returns The trimmed stderr text
 */
export function stderrOf(error : unknown) : string | undefined {
    const stderr = (error as { stderr ?: string | Buffer })?.stderr?.toString().trim();
    return stderr || undefined;
}

/**
 * The message of an Error, or the string form of any other value.
 * @param error The value from a catch
 * @returns A message for a person to read
 */
export function errorMessage(error : unknown) : string {
    return error instanceof Error ? error.message : String(error);
}

export function fileExists(file : string) {
    return fs.promises.access(file, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
}
