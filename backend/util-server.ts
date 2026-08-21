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
 * The limits for a docker process that the server waits for. A process
 * that does not end, or an output that is too large, must not stop the
 * server.
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
 * Refuse a service name that cannot go to docker compose as an
 * argument. A name such as --project-directory=/ is an option, and
 * docker would accept it.
 * @param serviceName The service name from the client
 */
export function checkServiceName(serviceName : string) {
    if (!isComposeServiceName(serviceName)) {
        throw new ValidationError("Invalid service name");
    }
}

/**
 * Refuse a shell that cannot go to docker compose exec as an argument.
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

    // ValidationError extends Error, so this test must come first
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
        // A rejection can carry a plain string, for example from
        // Terminal.exec. The client must get an answer for each error, or
        // its buttons stay disabled. The log keeps the value for the
        // operator, because a string that is not a message reads badly in
        // a toast.
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
 * The stderr text of a failed child process, or undefined if the error
 * carries none. The text from the tool itself gives the reason. The
 * message of the error object only says that the process failed.
 * @param error The rejection value of a spawn
 * @returns The stderr text, without space at the ends
 */
export function stderrOf(error : unknown) : string | undefined {
    const stderr = (error as { stderr ?: string | Buffer })?.stderr?.toString().trim();
    return stderr || undefined;
}

/**
 * The message of an error value. An Error object gives its message, and a
 * different value gives its string form.
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
