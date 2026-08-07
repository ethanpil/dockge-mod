import { Socket } from "socket.io";
import { Terminal } from "./terminal";
import { randomBytes } from "crypto";
import { log } from "./log";
import { ERROR_TYPE_VALIDATION } from "../common/util-common";
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
        // its buttons stay disabled.
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
 * The stderr text of a failed child process, or undefined when the error
 * carries none. The text from the tool itself gives the reason. The
 * message of the error object only says that the process failed.
 * @param error The rejection value of a spawn
 * @returns The stderr text, without space at the ends
 */
export function stderrOf(error : unknown) : string | undefined {
    const stderr = (error as { stderr ?: string | Buffer })?.stderr?.toString().trim();
    return stderr || undefined;
}

export function fileExists(file : string) {
    return fs.promises.access(file, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
}
