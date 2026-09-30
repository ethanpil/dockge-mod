import { DockgeServer } from "./dockge-server";
import * as os from "node:os";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { LimitQueue } from "./utils/limit-queue";
import { DockgeSocket, errorMessage } from "./util-server";
import {
    PROGRESS_TERMINAL_ROWS,
    TERMINAL_COLS,
    TERMINAL_ROWS
} from "../common/util-common";
import { sync as commandExistsSync } from "command-exists";
import { log } from "./log";

/**
 * Terminal for running commands, no user interaction
 */
export class Terminal {
    protected static terminalMap : Map<string, Terminal> = new Map();

    /**
     * Last size reported by each client, per terminal name.
     *
     * Kept outside the terminal objects so a stop/start cycle, which makes a
     * new terminal with the same name, does not reset the pty to the default
     * width. The pty uses the smallest joined client size, so a wide client
     * cannot overflow a narrow one.
     */
    protected static sizeHints : Map<string, Map<string, { rows : number, cols : number }>> = new Map();

    protected _ptyProcess? : pty.IPty;
    protected server : DockgeServer;
    protected buffer : LimitQueue<string> = new LimitQueue(100);
    protected _name : string;

    protected file : string;
    protected args : string | string[];
    protected cwd : string;
    protected env? : NodeJS.ProcessEnv;
    protected callback? : (exitCode : number) => void;

    protected _rows : number = TERMINAL_ROWS;
    protected _cols : number = TERMINAL_COLS;

    // Size before the first client hint. applyClientSize restores it when no
    // hinted client is left, so a departed client's size does not linger.
    protected defaultRows? : number;
    protected defaultCols? : number;

    public enableKeepAlive : boolean = false;
    protected keepAliveInterval? : NodeJS.Timeout;
    protected kickDisconnectedClientsInterval? : NodeJS.Timeout;

    protected socketList : Record<string, DockgeSocket> = {};

    constructor(server : DockgeServer, name : string, file : string, args : string | string[], cwd : string, env? : NodeJS.ProcessEnv) {
        this.server = server;
        this._name = name;
        //this._name = "terminal-" + Date.now() + "-" + getCryptoRandomInt(0, 1000000);
        this.file = file;
        this.args = args;
        this.cwd = cwd;
        this.env = env;

        Terminal.terminalMap.set(this.name, this);
    }

    get rows() {
        return this._rows;
    }

    set rows(rows : number) {
        this.setSize(rows, this._cols);
    }

    get cols() {
        return this._cols;
    }

    set cols(cols : number) {
        this.setSize(this._rows, cols);
    }

    /**
     * Set both dimensions in one resize. Two assignments would send two
     * SIGWINCHs, and full-screen programs would draw a frame at a size no
     * client asked for.
     * @param rows new row count
     * @param cols new column count
     */
    public setSize(rows : number, cols : number) {
        if (rows === this._rows && cols === this._cols) {
            return;
        }
        this._rows = rows;
        this._cols = cols;
        log.debug("Terminal", `Terminal size: ${cols}x${rows}`);
        try {
            this.ptyProcess?.resize(cols, rows);
        } catch (e) {
            if (e instanceof Error) {
                log.debug("Terminal", "Failed to resize terminal: " + e.message);
            }
        }
    }

    public start() {
        if (this._ptyProcess) {
            return;
        }

        this.kickDisconnectedClientsInterval = setInterval(() => {
            for (const socketID in this.socketList) {
                const socket = this.socketList[socketID];
                if (!socket.connected) {
                    log.debug("Terminal", "Kicking disconnected client " + socket.id + " from terminal " + this.name);
                    this.leave(socket);
                }
            }
        }, 60 * 1000);

        if (this.enableKeepAlive) {
            log.debug("Terminal", "Keep alive enabled for terminal " + this.name);

            // Close if there is no clients
            this.keepAliveInterval = setInterval(() => {
                const numClients = Object.keys(this.socketList).length;

                if (numClients === 0) {
                    log.debug("Terminal", "Terminal " + this.name + " has no client, closing...");
                    this.close();
                } else {
                    log.debug("Terminal", "Terminal " + this.name + " has " + numClients + " client(s)");
                }
            }, 60 * 1000);
        } else {
            log.debug("Terminal", "Keep alive disabled for terminal " + this.name);
        }

        try {
            this._ptyProcess = pty.spawn(this.file, this.args, {
                name: this.name,
                cwd: this.cwd,
                // Merge extra variables into the server environment. Without
                // them, the child inherits the server environment as before.
                env: this.env ? {
                    ...process.env,
                    ...this.env,
                } : undefined,
                // The instance size, not the global default — joinCombinedTerminal
                // and client size hints set _cols before start() runs.
                cols: this.cols,
                rows: this.rows,
            });

            // On Data
            this._ptyProcess.onData((data) => {
                this.buffer.pushItem(data);

                for (const socketID in this.socketList) {
                    const socket = this.socketList[socketID];
                    socket.emitAgent("terminalWrite", this.name, data);
                }
            });

            // On Exit
            this._ptyProcess.onExit(this.exit);
        } catch (error) {
            if (error instanceof Error) {
                clearInterval(this.keepAliveInterval);

                log.error("Terminal", "Failed to start terminal: " + error.message);
                const exitCode = Number(error.message.split(" ").pop());
                this.exit({
                    exitCode,
                });
            }
        }
    }

    protected exited = false;

    /**
     * Exit event handler
     * @param res
     */
    protected exit = (res : {exitCode: number, signal?: number | undefined}) => {
        // A forced exit plus a late pty exit event must not run this twice,
        // or the second run could remove a newer terminal with the same name.
        if (this.exited) {
            return;
        }
        this.exited = true;

        for (const socketID in this.socketList) {
            const socket = this.socketList[socketID];
            socket.emitAgent("terminalExit", this.name, res.exitCode);
        }

        // Remove all clients
        this.socketList = {};

        if (Terminal.terminalMap.get(this.name) === this) {
            Terminal.terminalMap.delete(this.name);
        }
        log.debug("Terminal", "Terminal " + this.name + " exited with code " + res.exitCode);

        clearInterval(this.keepAliveInterval);
        clearInterval(this.kickDisconnectedClientsInterval);

        if (this.callback) {
            this.callback(res.exitCode);
        }
    };

    public onExit(callback : (exitCode : number) => void) {
        this.callback = callback;
    }

    public join(socket : DockgeSocket) {
        this.socketList[socket.id] = socket;
        this.applyClientSize();
    }

    public leave(socket : DockgeSocket) {
        delete this.socketList[socket.id];
        // Drop the leaver's hint so remaining clients can grow back.
        Terminal.sizeHints.get(this.name)?.delete(socket.id);
        this.applyClientSize();
    }

    /**
     * Record a client's size for a terminal name. Works even if the terminal
     * does not exist yet (an interactive terminal's resize can arrive before
     * creation finishes); join() applies the hint later.
     * @param terminalName terminal the size applies to
     * @param socketID reporting client
     * @param rows reported rows
     * @param cols reported cols
     */
    public static setSizeHint(terminalName : string, socketID : string, rows : number, cols : number) {
        let hints = Terminal.sizeHints.get(terminalName);
        if (!hints) {
            hints = new Map();
            Terminal.sizeHints.set(terminalName, hints);
        }
        hints.set(socketID, {
            rows,
            cols,
        });
    }

    /**
     * Drop every size hint a disconnected client left behind.
     * @param socketID the disconnected client
     */
    public static removeSizeHintsForSocket(socketID : string) {
        for (const [ name, hints ] of Terminal.sizeHints) {
            hints.delete(socketID);
            if (hints.size === 0) {
                Terminal.sizeHints.delete(name);
            }
        }
    }

    /**
     * Resize the pty to the smallest size among joined clients with a hint,
     * or back to the default size when there are none.
     */
    public applyClientSize() {
        const hints = Terminal.sizeHints.get(this.name);

        let rows = Infinity;
        let cols = Infinity;
        for (const socketID in this.socketList) {
            const hint = hints?.get(socketID);
            if (hint) {
                rows = Math.min(rows, hint.rows);
                cols = Math.min(cols, hint.cols);
            }
        }

        if (!Number.isFinite(rows) || !Number.isFinite(cols)) {
            if (this.defaultRows !== undefined && this.defaultCols !== undefined) {
                this.setSize(this.defaultRows, this.defaultCols);
            }
            return;
        }

        if (this.defaultRows === undefined) {
            this.defaultRows = this._rows;
            this.defaultCols = this._cols;
        }

        this.setSize(rows, cols);
    }

    public get ptyProcess() {
        return this._ptyProcess;
    }

    public get name() {
        return this._name;
    }

    /**
     * Get the terminal output string
     */
    getBuffer() : string {
        if (this.buffer.length === 0) {
            return "";
        }
        return this.buffer.join("");
    }

    close() {
        clearInterval(this.keepAliveInterval);
        // Send Ctrl+C to the terminal
        this.ptyProcess?.write("\x03");
    }

    /**
     * Get a running and non-exited terminal
     * @param name
     */
    public static getTerminal(name : string) : Terminal | undefined {
        return Terminal.terminalMap.get(name);
    }

    public static getOrCreateTerminal(server : DockgeServer, name : string, file : string, args : string | string[], cwd : string) : Terminal {
        // Since exited terminal will be removed from the map, it is safe to get the terminal from the map
        let terminal = Terminal.getTerminal(name);
        if (!terminal) {
            terminal = new Terminal(server, name, file, args, cwd);
        }
        return terminal;
    }

    public static exec(server : DockgeServer, socket : DockgeSocket | undefined, terminalName : string, file : string, args : string | string[], cwd : string, env? : NodeJS.ProcessEnv) : Promise<number> {
        return new Promise((resolve, reject) => {
            // check if terminal exists
            if (Terminal.terminalMap.has(terminalName)) {
                reject("Another operation is already running, please try again later.");
                return;
            }

            let terminal = new Terminal(server, terminalName, file, args, cwd, env);
            terminal.rows = PROGRESS_TERMINAL_ROWS;

            if (socket) {
                terminal.join(socket);
            }

            terminal.onExit((exitCode : number) => {
                clearTimeout(limit);
                resolve(exitCode);
            });

            // A hung operation would block every later operation on the stack.
            // The limit is generous because large image pulls can be slow.
            const limit = setTimeout(() => {
                if (Terminal.terminalMap.get(terminalName) === terminal) {
                    log.warn("Terminal", "The operation " + terminalName + " did not end in time, stop it");
                    try {
                        terminal.ptyProcess?.kill();
                    } catch (e) {
                        log.warn("Terminal", "Cannot stop " + terminalName + ": " + errorMessage(e));
                    }
                    // Escalate to SIGKILL if the first signal is ignored.
                    // node-pty on Windows throws on a signal name.
                    setTimeout(() => {
                        if (Terminal.terminalMap.get(terminalName) === terminal) {
                            try {
                                terminal.ptyProcess?.kill("SIGKILL");
                            } catch (e) {
                                log.warn("Terminal", "Cannot kill " + terminalName + ": " + errorMessage(e));
                            }
                        }
                    }, 10000);
                }
            }, Terminal.EXEC_LIMIT);

            terminal.start();
        });
    }

    /** Max duration of one compose operation, in milliseconds */
    static readonly EXEC_LIMIT = 60 * 60 * 1000;

    public static getTerminalCount() {
        return Terminal.terminalMap.size;
    }

    /**
     * Remove a client from every terminal. Called on socket disconnect so an
     * interactive terminal can close when its last client leaves.
     * @param socket The client
     */
    public static leaveAll(socket : DockgeSocket) {
        for (const terminal of Terminal.terminalMap.values()) {
            if (terminal.socketList[socket.id]) {
                terminal.leave(socket);
            }
        }
    }
}

/**
 * Interactive terminal
 * Mainly used for container exec
 */
export class InteractiveTerminal extends Terminal {
    /** Delay from last client disconnect to shell close, to survive brief network drops. */
    public static readonly CLOSE_DELAY = 10 * 1000;

    /** Close delay for this terminal, in milliseconds */
    protected closeDelay = InteractiveTerminal.CLOSE_DELAY;

    protected closeTimer? : NodeJS.Timeout;

    public write(input : string) {
        this.ptyProcess?.write(input);
    }

    public join(socket : DockgeSocket) {
        clearTimeout(this.closeTimer);
        this.closeTimer = undefined;
        super.join(socket);
    }

    /**
     * Remove a client, and close the shell shortly after the last one leaves.
     * Otherwise the shell stayed open for the next session, which then could
     * not start a new one.
     * @param socket The client
     */
    public leave(socket : DockgeSocket) {
        super.leave(socket);
        if (Object.keys(this.socketList).length === 0 && !this.closeTimer) {
            this.closeTimer = setTimeout(() => {
                this.closeTimer = undefined;
                if (Object.keys(this.socketList).length === 0) {
                    this.close();
                }
            }, this.closeDelay);
        }
    }

    /**
     * Kill the shell (Ctrl+C does not stop a shell), escalating to SIGKILL.
     * If no exit event arrives within 10 seconds, mark it exited anyway.
     */
    close() {
        clearInterval(this.keepAliveInterval);
        clearInterval(this.kickDisconnectedClientsInterval);
        clearTimeout(this.closeTimer);
        this.closeTimer = undefined;

        // Leave the map now so a join during shutdown starts a new shell
        if (Terminal.terminalMap.get(this.name) === this) {
            Terminal.terminalMap.delete(this.name);
        }

        const process = this.ptyProcess;
        if (!process) {
            this.exit({ exitCode: 0 });
            return;
        }
        process.kill();
        setTimeout(() => {
            if (!this.exited) {
                try {
                    process.kill("SIGKILL");
                } catch (e) {
                    log.debug("Terminal", "Cannot kill " + this.name + ": " + (e as Error).message);
                }
            }
        }, 5000);
        setTimeout(() => {
            if (!this.exited) {
                log.warn("Terminal", "No exit event from " + this.name + ", remove it");
                this.exit({ exitCode: 137 });
            }
        }, 10000);
    }

    resetCWD() {
        const cwd = process.cwd();
        this.ptyProcess?.write(`cd "${cwd}"\r`);
    }
}

/**
 * User interactive terminal that use bash or powershell with limited commands such as docker, ls, cd, dir
 */
export class MainTerminal extends InteractiveTerminal {
    constructor(server : DockgeServer, name : string) {
        let shell;

        // Throw an error if console is not enabled
        if (!server.config.enableConsole) {
            throw new Error("Console is not enabled.");
        }

        if (os.platform() === "win32") {
            if (commandExistsSync("pwsh.exe")) {
                shell = "pwsh.exe";
            } else {
                shell = "powershell.exe";
            }
        } else {
            shell = "bash";
        }
        super(server, name, shell, [], server.stacksDir);
        // A page reload or brief network drop must not kill a host shell command
        this.closeDelay = 60 * 1000;
    }

    public write(input : string) {
        super.write(input);
    }
}
