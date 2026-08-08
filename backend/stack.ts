import { DockgeServer } from "./dockge-server";
import fs, { promises as fsAsync } from "fs";
import { log } from "./log";
import yaml from "yaml";
import { DockgeSocket, errorMessage, fileExists, stderrOf, ValidationError } from "./util-server";
import path from "path";
import os from "os";
import {
    acceptedComposeFileNames,
    acceptedComposeOverrideFileNames,
    defaultComposeOverrideFileName,
    COMBINED_TERMINAL_COLS,
    COMBINED_TERMINAL_ROWS,
    CREATED_FILE,
    CREATED_STACK,
    EXITED, getCombinedTerminalName,
    getComposeTerminalName, getContainerExecTerminalName,
    PROGRESS_TERMINAL_ROWS,
    RUNNING, TERMINAL_ROWS,
    UNKNOWN
} from "../common/util-common";
import { InteractiveTerminal, Terminal } from "./terminal";
import childProcessAsync from "promisify-child-process";
import { Settings } from "./settings";

export class Stack {

    name: string;
    protected _status: number = UNKNOWN;
    protected _composeYAML?: string;
    protected _composeENV?: string;
    protected _composeOverrideYAML?: string | null;
    protected _configFilePath?: string;
    protected _composeFileName: string = "compose.yaml";
    protected _composeOverrideFileName?: string;
    protected _skipFSOperations: boolean;
    protected server: DockgeServer;

    protected combinedTerminal? : Terminal;

    protected static managedStackList: Map<string, Stack> = new Map();

    constructor(server : DockgeServer, name : string, composeYAML? : string, composeENV? : string, composeOverrideYAML? : string | null, skipFSOperations = false) {
        this.name = name;
        this.server = server;
        this._composeYAML = composeYAML;
        this._composeENV = composeENV;
        this._composeOverrideYAML = composeOverrideYAML;
        this._skipFSOperations = skipFSOperations;

        if (!skipFSOperations) {
            // Check if compose file name is different from compose.yaml
            for (const filename of acceptedComposeFileNames) {
                if (fs.existsSync(path.join(this.path, filename))) {
                    this._composeFileName = filename;
                    break;
                }
            }
        }
    }

    /**
     * True if the stack directory is a git checkout. The .git entry can be
     * a directory, or a file for a worktree or a submodule.
     */
    get isGitRepo() : boolean {
        return fs.existsSync(path.join(this.path, ".git"));
    }

    /**
     * Arguments that let git use the stack directory when a different
     * user is its owner. The server runs as root in the container, and
     * the PUID and PGID variables give the files to a different user.
     * Git refuses such a directory without this exception. The
     * application selects the directory itself, thus the exception adds
     * no new access.
     */
    protected get gitSafeArgs() : string[] {
        return [ "-c", "safe.directory=" + this.fullPath ];
    }

    /**
     * The git state of the stack directory: the branch, a flag that shows
     * tracked work that is not committed, and a flag for a detached HEAD.
     * On a detached HEAD the branch field holds the short commit hash. The
     * dirty flag does not count untracked files. An override file or a
     * .env file next to the checkout is the usual condition, not drift.
     * The result is null if the directory is not a git checkout, or if git
     * gives an error, for example if git is not installed. The stack
     * object then looks the same as one from an agent without git support.
     */
    async getGitInfo() : Promise<{ branch : string, isDirty : boolean, isDetached : boolean } | null> {
        if (!this.isGitRepo) {
            return null;
        }

        const git = (...args : string[]) => childProcessAsync.spawn("git", [ ...this.gitSafeArgs, ...args ], {
            cwd: this.path,
            encoding: "utf-8",
            // The output of a git checkout with many changes can go over
            // the default limit of 200 KiB. A process that does not end
            // must not block the page. The same values as
            // runComposeConfig.
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000,
        });

        try {
            const [ branchRes, statusRes ] = await Promise.all([
                git("rev-parse", "--abbrev-ref", "HEAD"),
                git("status", "--porcelain", "--untracked-files=no"),
            ]);

            let branch = (branchRes.stdout?.toString() ?? "").trim();
            const isDetached = branch === "HEAD";

            if (isDetached) {
                // The short hash tells the user which commit runs. A pull is
                // not possible here, and the frontend hides the button.
                const shaRes = await git("rev-parse", "--short", "HEAD");
                branch = (shaRes.stdout?.toString() ?? "").trim() || branch;
            }

            return {
                branch,
                isDirty: (statusRes.stdout?.toString() ?? "").trim() !== "",
                isDetached,
            };
        } catch (e) {
            log.debug("getGitInfo", "git failed for stack " + this.name + ": " + errorMessage(e));
            return null;
        }
    }

    /**
     * Run `git pull` in the stack directory. The output goes to the compose
     * terminal of the stack, so the user can read it on the stack page.
     * The environment stops each credential question. A question on the
     * progress terminal can get no answer, and the pull would then never
     * end.
     */
    async gitPull(socket : DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const env : NodeJS.ProcessEnv = {
            GIT_TERMINAL_PROMPT: "0",
        };
        if (!process.env.GIT_SSH_COMMAND) {
            env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
        }
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "git", [ ...this.gitSafeArgs, "pull" ], this.path, env);
        if (exitCode !== 0) {
            throw new Error("Failed to pull, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async toJSON(endpoint : string) : Promise<object> {
        // The git processes run while the settings read goes on
        const gitInfoPromise = this.getGitInfo();

        // Since we have multiple agents now, embed primary hostname in the stack object too.
        let primaryHostname = await Settings.get("primaryHostname");
        if (!primaryHostname) {
            if (!endpoint) {
                primaryHostname = "localhost";
            } else {
                // Use the endpoint as the primary hostname
                try {
                    primaryHostname = (new URL("https://" + endpoint).hostname);
                } catch (e) {
                    // Just in case if the endpoint is in a incorrect format
                    primaryHostname = "localhost";
                }
            }
        }

        let obj = this.toSimpleJSON(endpoint);
        return {
            ...obj,
            composeYAML: this.composeYAML,
            composeENV: this.composeENV,
            composeOverrideYAML: this.composeOverrideYAML,
            composeOverrideFileName: this.composeOverrideFileName,
            gitInfo: await gitInfoPromise,
            primaryHostname,
        };
    }

    toSimpleJSON(endpoint : string) : object {
        return {
            name: this.name,
            status: this._status,
            tags: [],
            isManagedByDockge: this.isManagedByDockge,
            composeFileName: this._composeFileName,
            endpoint,
        };
    }

    /**
     * Get the status of the stack from `docker compose ps --format json`
     */
    async ps() : Promise<object> {
        let res = await childProcessAsync.spawn("docker", this.getComposeOptions("ps", "--format", "json"), {
            cwd: this.path,
            encoding: "utf-8",
        });
        if (!res.stdout) {
            return {};
        }
        return JSON.parse(res.stdout.toString());
    }

    get isManagedByDockge() : boolean {
        return fs.existsSync(this.path) && fs.statSync(this.path).isDirectory();
    }

    get status() : number {
        return this._status;
    }

    validate() {
        // Check name, allows [a-z][0-9] _ - only
        if (!this.name.match(/^[a-z0-9_-]+$/)) {
            throw new ValidationError("Stack name can only contain [a-z][0-9] _ - only");
        }

        // Check YAML format
        yaml.parse(this.composeYAML);

        // Check the format of the override YAML only when this save carries
        // content for it. A file that holds only comments is correct, because
        // docker accepts it.
        if (this.hasOverrideContent()) {
            yaml.parse(this._composeOverrideYAML as string);
        }

        let lines = this.composeENV.split("\n");

        // Check if the .env is able to pass docker-compose
        // Prevent "setenv: The parameter is incorrect"
        // It only happens when there is one line and it doesn't contain "="
        if (lines.length === 1 && !lines[0].includes("=") && lines[0].length > 0) {
            throw new ValidationError("Invalid .env format");
        }
    }

    get composeYAML() : string {
        if (this._composeYAML === undefined) {
            try {
                this._composeYAML = fs.readFileSync(path.join(this.path, this._composeFileName), "utf-8");
            } catch (e) {
                this._composeYAML = "";
            }
        }
        return this._composeYAML;
    }

    get composeENV() : string {
        if (this._composeENV === undefined) {
            try {
                this._composeENV = fs.readFileSync(path.join(this.path, ".env"), "utf-8");
            } catch (e) {
                this._composeENV = "";
            }
        }
        return this._composeENV;
    }

    get composeOverrideYAML() : string | null {
        if (this._composeOverrideYAML === undefined) {
            try {
                this._composeOverrideYAML = fs.readFileSync(path.join(this.path, this.composeOverrideFileName), "utf-8");
            } catch (e) {
                // No file is the usual condition. A different error keeps the
                // file out of the interface, so the operator must see it.
                if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
                    log.warn("stack", `Cannot read the override file of the stack ${this.name}: ${e}`);
                }
                this._composeOverrideYAML = null;
            }
        }
        return this._composeOverrideYAML;
    }

    /**
     * The name of the override file of this stack. Docker examines the
     * accepted names in sequence and uses the first file that it finds. The
     * name of the base compose file has no effect on that sequence. When no
     * file exists, the name for a new file agrees with the base file.
     */
    get composeOverrideFileName() : string {
        if (this._composeOverrideFileName === undefined) {
            this._composeOverrideFileName = defaultComposeOverrideFileName(this._composeFileName);

            if (!this._skipFSOperations) {
                for (const filename of acceptedComposeOverrideFileNames) {
                    const filePath = path.join(this.path, filename);
                    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
                        this._composeOverrideFileName = filename;
                        break;
                    }
                }
            }
        }
        return this._composeOverrideFileName;
    }

    /**
     * True when this stack holds override content for the disk. An empty
     * value is a request to remove the file.
     */
    protected hasOverrideContent() : boolean {
        return typeof this._composeOverrideYAML === "string" && this._composeOverrideYAML.trim() !== "";
    }

    get path() : string {
        return path.join(this.server.stacksDir, this.name);
    }

    get fullPath() : string {
        let dir = this.path;

        // Compose up via node-pty
        let fullPathDir;

        // if dir is relative, make it absolute
        if (!path.isAbsolute(dir)) {
            fullPathDir = path.join(process.cwd(), dir);
        } else {
            fullPathDir = dir;
        }
        return fullPathDir;
    }

    /**
     * Save the stack to the disk
     * @param isAdd
     */
    async save(isAdd : boolean) {
        this.validate();

        let dir = this.path;

        // Check if the name is used if isAdd
        if (isAdd) {
            if (await fileExists(dir)) {
                throw new ValidationError("Stack name already exists");
            }

            // Create the stack folder
            await fsAsync.mkdir(dir);
        } else {
            if (!await fileExists(dir)) {
                throw new ValidationError("Stack not found");
            }
        }

        // Write or overwrite the compose.yaml
        const composePath = path.join(dir, this._composeFileName);
        fs.writeFileSync(composePath, this.composeYAML);
        const writtenFiles = [ composePath ];

        // Write or overwrite the .env
        const envPath = path.join(dir, ".env");
        if (await fileExists(envPath) || this.composeENV.trim() !== "") {
            fs.writeFileSync(envPath, this.composeENV);
            writtenFiles.push(envPath);
        }

        // Write, or remove, the override file. An undefined value means the
        // save does not carry override data, so the file stays as it is.
        if (this._composeOverrideYAML !== undefined) {
            const overridePath = path.join(dir, this.composeOverrideFileName);

            // A link or a directory with this name is not something that this
            // application can write or remove safely.
            if (fs.existsSync(overridePath) && !fs.lstatSync(overridePath).isFile()) {
                throw new ValidationError("The override file is not a usual file. Examine the stack directory.");
            }

            if (this.hasOverrideContent()) {
                fs.writeFileSync(overridePath, this._composeOverrideYAML as string);
                writtenFiles.push(overridePath);
            } else if (fs.existsSync(overridePath)) {
                fs.rmSync(overridePath);
            }
        }

        if (process.env.PUID && process.env.PGID) {
            const uid = Number(process.env.PUID);
            const gid = Number(process.env.PGID);
            fs.lchownSync(dir, uid, gid);
            for (const file of writtenFiles) {
                fs.lchownSync(file, uid, gid);
            }
        }
    }

    /**
     * Run `docker compose ... config` and collect the result. On a failure
     * the content holds the error text of docker itself, which also names
     * problems that a YAML parser cannot see.
     * @param args The full argument list, with "compose" first
     * @param cwd The work directory of the process
     */
    protected static async runComposeConfig(args : string[], cwd : string) : Promise<{ ok : boolean, content : string }> {
        try {
            const res = await childProcessAsync.spawn("docker", args, {
                cwd,
                encoding: "utf-8",
                // The merged output of a large stack goes over the default
                // limit of 200 KiB
                maxBuffer: 10 * 1024 * 1024,
                // Do not keep a process of a docker daemon that does not
                // answer. The frontend stops its wait after the same time.
                timeout: 30000,
            });
            return {
                ok: true,
                content: res.stdout?.toString() ?? "",
            };
        } catch (e) {
            return {
                ok: false,
                content: stderrOf(e) || errorMessage(e),
            };
        }
    }

    /**
     * The configuration that docker makes from the compose file, the
     * override file, and the env files, with `docker compose config`. The
     * caller must give a stack that this application manages, because the
     * process runs in the stack directory.
     */
    async getComposeConfig() : Promise<{ ok : boolean, content : string }> {
        return Stack.runComposeConfig(this.getComposeOptions("config"), this.path);
    }

    /**
     * Examine editor content with `docker compose config`, before a save
     * writes it to the stack directory. The content goes to a temporary
     * directory, thus the files of the stack do not change. The answer
     * holds the merged configuration, or the error text of docker.
     * @param server The server, for the location of global.env
     * @param name Name of the stack, for the project name of docker
     * @param composeYAML Content for the compose file
     * @param composeENV Content for the .env file
     * @param composeOverrideYAML Content for the override file, or null
     */
    static async validateConfig(server : DockgeServer, name : string, composeYAML : string, composeENV : string, composeOverrideYAML : string | null) : Promise<{ ok : boolean, content : string }> {
        const dir = await fsAsync.mkdtemp(path.join(os.tmpdir(), "dockge-validate-"));

        try {
            const composePath = path.join(dir, "compose.yaml");
            const envPath = path.join(dir, ".env");
            await fsAsync.writeFile(composePath, composeYAML);

            // The file exists also when the content is empty. The explicit
            // --env-file below stops the automatic load of the .env of the
            // stack directory, thus docker uses the editor content only.
            await fsAsync.writeFile(envPath, composeENV);

            const args = [ "compose", "-f", composePath ];

            if (composeOverrideYAML !== null && composeOverrideYAML.trim() !== "") {
                const overridePath = path.join(dir, "compose.override.yaml");
                await fsAsync.writeFile(overridePath, composeOverrideYAML);
                args.push("-f", overridePath);
            }

            // Relative paths of the content, for example env_file or a
            // bind mount, resolve against the project directory. Use the
            // stack directory if it exists, so a reference to a file of
            // the stack stays correct. Docker also takes the project name
            // from this directory, the same as a deploy. The name check
            // keeps the path inside the stacks directory.
            let projectDir = dir;
            if (name.match(/^[a-z0-9_-]+$/)) {
                const stackDir = path.resolve(server.stacksDir, name);
                if (await fileExists(stackDir)) {
                    projectDir = stackDir;
                }
            }
            args.push("--project-directory", projectDir);

            // The same sequence as getComposeOptions: global.env comes
            // first, then the .env of the stack
            const globalEnvPath = path.resolve(server.stacksDir, "global.env");
            if (await fileExists(globalEnvPath)) {
                args.push("--env-file", globalEnvPath);
            }
            args.push("--env-file", envPath);
            args.push("config");

            return await Stack.runComposeConfig(args, dir);
        } finally {
            // A failure here must not replace the result. Windows can hold
            // the directory for a short time after the timeout stops the
            // process.
            try {
                await fsAsync.rm(dir, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                });
            } catch (e) {
                log.warn("validateConfig", "Cannot remove " + dir + ": " + errorMessage(e));
            }
        }
    }

    async deploy(socket : DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to deploy, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async delete(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("down", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to delete, please check the terminal output for more information.");
        }

        // Remove the stack folder
        await fsAsync.rm(this.path, {
            recursive: true,
            force: true
        });

        return exitCode;
    }

    async updateStatus() {
        let statusList = await Stack.getStatusList();
        let status = statusList.get(this.name);

        if (status) {
            this._status = status;
        } else {
            this._status = UNKNOWN;
        }
    }

    /**
     * Checks if a compose file exists in the specified directory.
     * @async
     * @static
     * @param {string} stacksDir - The directory of the stack.
     * @param {string} filename - The name of the directory to check for the compose file.
     * @returns {Promise<boolean>} A promise that resolves to a boolean indicating whether any compose file exists.
     */
    static async composeFileExists(stacksDir : string, filename : string) : Promise<boolean> {
        let filenamePath = path.join(stacksDir, filename);
        // Check if any compose file exists
        for (const filename of acceptedComposeFileNames) {
            let composeFile = path.join(filenamePath, filename);
            if (await fileExists(composeFile)) {
                return true;
            }
        }
        return false;
    }

    static async getStackList(server : DockgeServer, useCacheForManaged = false) : Promise<Map<string, Stack>> {
        let stacksDir = server.stacksDir;
        let stackList : Map<string, Stack>;

        // Use cached stack list?
        if (useCacheForManaged && this.managedStackList.size > 0) {
            stackList = this.managedStackList;
        } else {
            stackList = new Map<string, Stack>();

            // Scan the stacks directory, and get the stack list
            let filenameList = await fsAsync.readdir(stacksDir);

            for (let filename of filenameList) {
                try {
                    // Check if it is a directory
                    let stat = await fsAsync.stat(path.join(stacksDir, filename));
                    if (!stat.isDirectory()) {
                        continue;
                    }
                    // If no compose file exists, skip it
                    if (!await Stack.composeFileExists(stacksDir, filename)) {
                        continue;
                    }
                    let stack = await this.getStack(server, filename);
                    stack._status = CREATED_FILE;
                    stackList.set(filename, stack);
                } catch (e) {
                    if (e instanceof Error) {
                        log.warn("getStackList", `Failed to get stack ${filename}, error: ${e.message}`);
                    }
                }
            }

            // Cache by copying
            this.managedStackList = new Map(stackList);
        }

        // Get status from docker compose ls
        let res = await childProcessAsync.spawn("docker", [ "compose", "ls", "--all", "--format", "json" ], {
            encoding: "utf-8",
        });

        if (!res.stdout) {
            return stackList;
        }

        let composeList = JSON.parse(res.stdout.toString());

        for (let composeStack of composeList) {
            let stack = stackList.get(composeStack.Name);

            // This stack probably is not managed by Dockge, but we still want to show it
            if (!stack) {
                // Skip the stack of the manager itself. The name comes from the
                // directory of its compose file, thus both names can occur.
                if (composeStack.Name === "dockge" || composeStack.Name === "dockge-mod") {
                    continue;
                }
                stack = new Stack(server, composeStack.Name);
                stackList.set(composeStack.Name, stack);
            }

            stack._status = this.statusConvert(composeStack.Status);
            stack._configFilePath = composeStack.ConfigFiles;
        }

        return stackList;
    }

    /**
     * Get the status list, it will be used to update the status of the stacks
     * Not all status will be returned, only the stack that is deployed or created to `docker compose` will be returned
     */
    static async getStatusList() : Promise<Map<string, number>> {
        let statusList = new Map<string, number>();

        let res = await childProcessAsync.spawn("docker", [ "compose", "ls", "--all", "--format", "json" ], {
            encoding: "utf-8",
        });

        if (!res.stdout) {
            return statusList;
        }

        let composeList = JSON.parse(res.stdout.toString());

        for (let composeStack of composeList) {
            statusList.set(composeStack.Name, this.statusConvert(composeStack.Status));
        }

        return statusList;
    }

    /**
     * Convert the status string from `docker compose ls` to the status number
     * Input Example: "exited(1), running(1)"
     * @param status
     */
    static statusConvert(status : string) : number {
        if (status.startsWith("created")) {
            return CREATED_STACK;
        } else if (status.includes("exited")) {
            // If one of the service is exited, we consider the stack is exited
            return EXITED;
        } else if (status.startsWith("running")) {
            // If there is no exited services, there should be only running services
            return RUNNING;
        } else {
            return UNKNOWN;
        }
    }

    static async getStack(server: DockgeServer, stackName: string, skipFSOperations = false) : Promise<Stack> {
        let dir = path.join(server.stacksDir, stackName);

        // Keep the directory in the stacks directory. A name that contains
        // path parts must not give access to the other directories.
        const relative = path.relative(path.resolve(server.stacksDir), path.resolve(dir));
        if (relative === "" || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
            throw new ValidationError("Stack not found");
        }

        if (!skipFSOperations) {
            if (!await fileExists(dir) || !(await fsAsync.stat(dir)).isDirectory()) {
                // Maybe it is a stack managed by docker compose directly
                let stackList = await this.getStackList(server, true);
                let stack = stackList.get(stackName);

                if (stack) {
                    return stack;
                } else {
                    // Really not found
                    throw new ValidationError("Stack not found");
                }
            }
        } else {
            //log.debug("getStack", "Skip FS operations");
        }

        let stack : Stack;

        if (!skipFSOperations) {
            stack = new Stack(server, stackName);
        } else {
            stack = new Stack(server, stackName, undefined, undefined, undefined, true);
        }

        stack._status = UNKNOWN;
        stack._configFilePath = path.resolve(dir);
        return stack;
    }

    getComposeOptions(command : string, ...extraOptions : string[]) {
        //--env-file ./../global.env --env-file .env
        let options = [ "compose", command, ...extraOptions ];
        if (fs.existsSync(path.join(this.server.stacksDir, "global.env"))) {
            if (fs.existsSync(path.join(this.path, ".env"))) {
                options.splice(1, 0, "--env-file", "./.env");
            }
            options.splice(1, 0, "--env-file", "../global.env");
        }
        return options;
    }

    async start(socket: DockgeSocket) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to start, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async stop(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("stop"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to stop, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async restart(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("restart"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to restart, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async down(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("down"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to down, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async update(socket: DockgeSocket) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("pull"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to pull, please check the terminal output for more information.");
        }

        // If the stack is not running, we don't need to restart it
        await this.updateStatus();
        log.debug("update", "Status: " + this.status);
        if (this.status !== RUNNING) {
            return exitCode;
        }

        exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to restart, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async joinCombinedTerminal(socket: DockgeSocket) {
        const terminalName = getCombinedTerminalName(socket.endpoint, this.name);
        const existing = Terminal.getTerminal(terminalName);
        const terminal = Terminal.getOrCreateTerminal(this.server, terminalName, "docker", this.getComposeOptions("logs", "-f", "--tail", "100"), this.path);
        terminal.enableKeepAlive = true;
        // Seed the fallback size only on creation; join() below applies the
        // real client-reported sizes, which survive terminal recreation.
        if (!existing) {
            terminal.rows = COMBINED_TERMINAL_ROWS;
            terminal.cols = COMBINED_TERMINAL_COLS;
        }
        terminal.join(socket);
        terminal.start();
    }

    async leaveCombinedTerminal(socket: DockgeSocket) {
        const terminalName = getCombinedTerminalName(socket.endpoint, this.name);
        const terminal = Terminal.getTerminal(terminalName);
        if (terminal) {
            terminal.leave(socket);
        }
    }

    async joinContainerTerminal(socket: DockgeSocket, serviceName: string, shell : string = "sh", index: number = 0) {
        const terminalName = getContainerExecTerminalName(socket.endpoint, this.name, serviceName, index);
        let terminal = Terminal.getTerminal(terminalName);

        if (!terminal) {
            terminal = new InteractiveTerminal(this.server, terminalName, "docker", this.getComposeOptions("exec", serviceName, shell), this.path);
            terminal.rows = TERMINAL_ROWS;
            log.debug("joinContainerTerminal", "Terminal created");
        }

        terminal.join(socket);
        terminal.start();
    }

    /**
     * IPs by container ID. Docker can give a container a different address
     * when it starts again, and a stopped container has no address at all,
     * so an entry is correct for a short time only. The short life still
     * keeps most of the 5-second status polls free of inspect processes.
     */
    protected static ipCache : Map<string, { ip : string, time : number }> = new Map();

    /** How long an address in ipCache stays good, in milliseconds. */
    protected static readonly ipCacheTTL = 30000;

    /**
     * Resolve container IP addresses with a single batched `docker inspect`
     * for the containers not already cached by ID.
     * `docker compose ps` only reports the network name, not the address.
     * Addresses are best effort: a stopped container simply has none.
     * @param containers name/id pairs from `docker compose ps`
     */
    static async getContainerIPs(containers : { name : string, id : string }[]) : Promise<Map<string, string>> {
        const map = new Map<string, string>();

        // Runaway backstop; entries are tiny but hosts churn containers
        if (Stack.ipCache.size > 2000) {
            Stack.ipCache.clear();
        }

        const now = Date.now();
        const fresh = (id : string) => {
            const hit = Stack.ipCache.get(id);
            return hit !== undefined && now - hit.time < Stack.ipCacheTTL;
        };
        const uncached = containers.filter((c) => !c.id || !fresh(c.id));

        if (uncached.length > 0) {
            const parse = (out : string) => {
                for (const line of out.split("\n")) {
                    const [ rawName, rawIPs ] = line.split("\t");
                    if (!rawName) {
                        continue;
                    }
                    const ip = (rawIPs ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "";
                    map.set(rawName.replace(/^\//, ""), ip);
                }
            };

            const format = "{{.Name}}\t{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}";

            try {
                const res = await childProcessAsync.spawn("docker", [ "inspect", "--type", "container", "--format", format, ...uncached.map((c) => c.name) ], {
                    encoding: "utf-8",
                });
                parse(res.stdout?.toString() ?? "");
            } catch (e) {
                // A container removed between `ps` and `inspect` makes inspect exit
                // non-zero, but the surviving containers are still printed.
                const partial = (e as { stdout ?: string | Buffer })?.stdout;
                if (partial) {
                    parse(partial.toString());
                } else {
                    // For example, the docker CLI is missing, or the daemon
                    // does not answer. Without this the IP column shows only
                    // dashes and gives no reason anywhere.
                    log.debug("getContainerIPs", "docker inspect failed: " + (e instanceof Error ? e.message : String(e)));
                }
            }

            for (const c of uncached) {
                if (c.id && map.has(c.name)) {
                    Stack.ipCache.set(c.id, {
                        ip: map.get(c.name) ?? "",
                        time: now,
                    });
                }
            }
        }

        for (const c of containers) {
            if (!map.has(c.name) && c.id) {
                map.set(c.name, Stack.ipCache.get(c.id)?.ip ?? "");
            }
        }

        return map;
    }

    async getServiceStatusList() {
        let statusList = new Map<string, Array<object>>();

        try {
            let res = await childProcessAsync.spawn("docker", this.getComposeOptions("ps", "--format", "json"), {
                cwd: this.path,
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return statusList;
            }

            let lines = res.stdout?.toString().split("\n");

            const containers : { name : string, id : string }[] = [];

            const addLine = (obj: { Service: string, State: string, Name: string, Health: string, Status: string, Ports: string, ID: string }) => {
                if (!statusList.has(obj.Service)) {
                    statusList.set(obj.Service, []);
                }
                statusList.get(obj.Service)?.push({
                    status: obj.Health || obj.State,
                    name: obj.Name,
                    // `Status` is docker's uptime for a person to read. An
                    // example is "Up 23 minutes".
                    uptime: obj.Status ?? "",
                    ports: obj.Ports ?? "",
                    ip: "",
                });
                if (obj.Name) {
                    containers.push({
                        name: obj.Name,
                        id: obj.ID ?? "",
                    });
                }
            };

            for (let line of lines) {
                try {
                    let obj = JSON.parse(line);
                    if (obj instanceof Array) {
                        obj.forEach(addLine);
                    } else {
                        addLine(obj);
                    }
                } catch (e) {
                }
            }

            // `docker compose ps` reports the network name but not the address, so the
            // addresses come from a single batched inspect rather than one call each.
            const ipMap = await Stack.getContainerIPs(containers);
            for (const entries of statusList.values()) {
                for (const entry of entries) {
                    const e = entry as { name : string, ip : string };
                    e.ip = ipMap.get(e.name) ?? "";
                }
            }

            return statusList;
        } catch (e) {
            log.error("getServiceStatusList", e);
            return statusList;
        }
    }

    async startService(socket: DockgeSocket, serviceName: string) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", serviceName), this.path);
        if (exitCode !== 0) {
            throw new Error(`Failed to start service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }

    async stopService(socket: DockgeSocket, serviceName: string): Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("stop", serviceName), this.path);
        if (exitCode !== 0) {
            throw new Error(`Failed to stop service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }

    async restartService(socket: DockgeSocket, serviceName: string): Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("restart", serviceName), this.path);
        if (exitCode !== 0) {
            throw new Error(`Failed to restart service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }
}
