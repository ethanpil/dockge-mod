import { DockgeServer } from "./dockge-server";
import * as os from "node:os";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { LimitQueue } from "./utils/limit-queue";
import { DockgeSocket } from "./util-server";
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
     * The last size that each client reported, for each terminal name.
     *
     * This map stays outside the terminal objects. A stop and start cycle
     * closes the terminal and makes a new one with the same name. The map
     * keeps the sizes, so the new pty does not go back to the default width.
     *
     * The pty gets the smallest size of the clients that joined. Thus a wide
     * client cannot make the text too wide for a narrow client.
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

    // Size before the first client hint. applyClientSize goes back to it when
    // no client with a hint is left, so a client that leaves cannot keep its
    // size on the pty for the next client.
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
     * Set both dimensions with one resize. Two separate assignments send two
     * SIGWINCH signals, and the first has a size that no client asked for,
     * which makes a full screen program draw a frame it must then discard.
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
                // Extra variables merge into the environment of the server.
                // Without extra variables the child gets the environment of
                // the server, as before.
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

    /**
     * Exit event handler
     * @param res
     */
    protected exit = (res : {exitCode: number, signal?: number | undefined}) => {
        for (const socketID in this.socketList) {
            const socket = this.socketList[socketID];
            socket.emitAgent("terminalExit", this.name, res.exitCode);
        }

        // Remove all clients
        this.socketList = {};

        Terminal.terminalMap.delete(this.name);
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
        // The leaver's constraint no longer applies; a wider remaining
        // client may get its width back.
        Terminal.sizeHints.get(this.name)?.delete(socket.id);
        this.applyClientSize();
    }

    /**
     * Record the size a client reported for a terminal name. Works whether or
     * not the terminal currently exists — for interactive terminals the resize
     * can arrive while the creation handler is still awaiting, and the hint is
     * then applied by join().
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
     * Resize the pty to the minimum size over the currently joined clients
     * that have reported one. Go back to the size the caller set when no
     * such client is left.
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
                resolve(exitCode);
            });
            terminal.start();
        });
    }

    public static getTerminalCount() {
        return Terminal.terminalMap.size;
    }

    /**
     * Remove a client from each terminal. The disconnect of a socket
     * calls this, thus a terminal with keep alive can close when its
     * last client goes away.
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
    /**
     * The user that made the terminal. Only this user can read the
     * buffer and write input. A terminal without a user is open to each
     * user with a login, the same as before.
     */
    public userID? : number;

    /**
     * Refuse a client of a different user.
     * @param socket The client
     */
    public checkUser(socket : DockgeSocket) {
        if (this.userID !== undefined && this.userID !== socket.userID) {
            throw new Error("This terminal belongs to a different user.");
        }
    }

    public write(input : string) {
        this.ptyProcess?.write(input);
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
    constructor(server : DockgeServer, name : string, userID? : number) {
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
        this.userID = userID;
        // The shell closes when its last client goes away. Without this
        // the shell of one session stayed open for the next session.
        this.enableKeepAlive = true;
    }

    public write(input : string) {
        super.write(input);
    }

    /**
     * End the shell process. Ctrl+C does not stop a shell.
     */
    close() {
        clearInterval(this.keepAliveInterval);
        this.ptyProcess?.kill();
    }
}
