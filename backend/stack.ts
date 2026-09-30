import { DockgeServer } from "./dockge-server";
import fs, { promises as fsAsync } from "fs";
import { log } from "./log";
import yaml from "yaml";
import { checkServiceName, checkShellName, DOCKER_SPAWN_OPTIONS, DockgeSocket, errorMessage, fileExists, stderrOf, ValidationError } from "./util-server";
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
    envsubstYAML,
    EXITED, getCombinedTerminalName, getServiceLogsTerminalName,
    getComposeTerminalName, getContainerExecTerminalName,
    RUNNING, TERMINAL_ROWS,
    UNKNOWN
} from "../common/util-common";
import { InteractiveTerminal, Terminal } from "./terminal";
import childProcessAsync from "promisify-child-process";
import { Settings } from "./settings";
import { CachedCall } from "./utils/cached-call";
import dotenv from "dotenv";
import { StackBackup, StackFiles } from "./stack-backup";
import { ImageUpdateChecker } from "./image-update";
import { parseJSONLines } from "./docker-resources";

/**
 * Images and project names parsed from a stack's compose file.
 */
export interface ComposeInfo {
    /** False if the compose file failed to parse */
    ok : boolean;
    /** Images named by the services */
    images : string[];
    /** Possible project names for this stack */
    projectNames : string[];
    /** Image names that a build of this stack produces */
    buildImages : string[];
}

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
     * True if the stack directory is a git checkout. .git may be a file
     * (worktree or submodule).
     */
    get isGitRepo() : boolean {
        return fs.existsSync(path.join(this.path, ".git"));
    }

    /**
     * Git args that allow a checkout owned by another user (the server runs
     * as root, PUID/PGID may own the files). We choose the directory
     * ourselves, so safe.directory grants no new access.
     *
     * Git matches safe.directory against the real path with forward
     * slashes, so resolve symlinks and convert Windows separators.
     */
    protected get gitSafeArgs() : string[] {
        let dir = this.fullPath;
        try {
            dir = fs.realpathSync(dir);
        } catch (e) {
            // Directory may be gone; keep the logical path
        }
        if (process.platform === "win32") {
            dir = dir.replace(/\\/g, "/");
        }
        // Repo config can still run commands (fsmonitor, filters, hooks), so
        // getGitInfo runs as the owner and a pull runs without hooks.
        return [ "-c", "safe.directory=" + dir, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null" ];
    }

    /**
     * Owner of .git if we run as root and another user owns it, else null.
     */
    protected get gitOwner() : { uid : number, gid : number } | null {
        if (process.getuid?.() !== 0) {
            return null;
        }
        try {
            const stat = fs.statSync(path.join(this.fullPath, ".git"));
            if (stat.uid === 0) {
                return null;
            }
            return {
                uid: stat.uid,
                gid: stat.gid,
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Spawn options to run git as the checkout owner, so commands from the
     * repo config run with that user's rights instead of root's.
     */
    protected get gitOwnerOptions() : { uid? : number, gid? : number, env? : NodeJS.ProcessEnv } {
        const owner = this.gitOwner;
        if (!owner) {
            return {};
        }
        return {
            uid: owner.uid,
            // Avoid the root group, which can read root-group files
            gid: owner.gid === 0 ? 65534 : owner.gid,
            // Git fails if it cannot read the global config in root's home
            env: {
                ...process.env,
                HOME: os.tmpdir(),
                XDG_CONFIG_HOME: os.tmpdir(),
            },
        };
    }

    /**
     * Run git as the owner of the checkout and return its output.
     * @param args The git arguments
     * @returns The trimmed standard output
     */
    protected async gitOutput(...args : string[]) : Promise<string> {
        const res = await childProcessAsync.spawn("git", [ ...this.gitSafeArgs, ...args ], {
            ...this.gitOwnerOptions,
            cwd: this.path,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000,
        });
        return (res.stdout?.toString() ?? "").trim();
    }

    /**
     * A pull runs as root and leaves root-owned files that break the owner's
     * own git commands. Chown .git and the pulled files back to the owner.
     * Only root-owned entries change, so container data keeps its owner.
     * @param owner The owner of the checkout
     * @param before The commit before the pull, or "" if unknown
     */
    protected async restoreGitOwnership(owner : { uid : number, gid : number }, before : string) : Promise<void> {
        const give = async (target : string) => {
            try {
                const stat = await fsAsync.lstat(target);
                if (stat.uid === 0) {
                    await fsAsync.lchown(target, owner.uid, owner.gid);
                }
            } catch (e) {
                // Removed since the pull
            }
        };

        const walk = async (dir : string) : Promise<void> => {
            await give(dir);
            let entries : fs.Dirent[];
            try {
                entries = await fsAsync.readdir(dir, { withFileTypes: true });
            } catch (e) {
                return;
            }
            for (const entry of entries) {
                const target = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(target);
                } else {
                    await give(target);
                }
            }
        };

        const gitPath = path.join(this.fullPath, ".git");
        if ((await fsAsync.lstat(gitPath)).isDirectory()) {
            await walk(gitPath);
        } else {
            await give(gitPath);
        }

        if (before === "") {
            return;
        }
        const changed = (await this.gitOutput("diff", "--name-only", before, "HEAD")).split("\n").filter((line) => line !== "");
        const root = path.resolve(this.fullPath);
        for (const file of changed) {
            // Include parent directories up to the checkout root
            let target = path.resolve(root, file);
            while (target.startsWith(root + path.sep)) {
                await give(target);
                target = path.dirname(target);
            }
        }
    }

    /**
     * Git state of the stack directory. On a detached HEAD, branch is the
     * short hash. isDirty ignores untracked files, since a local override or
     * .env file is normal, not drift. Returns null if not a checkout or git
     * fails, so the stack looks like one from an agent without git support.
     */
    async getGitInfo() : Promise<{ branch : string, isDirty : boolean, isDetached : boolean } | null> {
        if (!this.isGitRepo) {
            return null;
        }

        const git = (...args : string[]) => childProcessAsync.spawn("git", [ ...this.gitSafeArgs, ...args ], {
            ...this.gitOwnerOptions,
            cwd: this.path,
            encoding: "utf-8",
            // Output can exceed the 200 KiB default, and a hung git must not
            // block the page. Same values as runComposeConfig.
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
                // Show which commit runs. The frontend hides Pull here.
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
     * Run `git pull` in the stack directory, with output in the stack's
     * compose terminal. Credential prompts are disabled because nobody can
     * answer them there and the pull would hang.
     */
    async gitPull(socket : DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const env : NodeJS.ProcessEnv = {
            GIT_TERMINAL_PROMPT: "0",
        };
        if (!process.env.GIT_SSH_COMMAND) {
            env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
        }
        // Back up first, since the pull changes the files
        const current = await this.currentFiles();
        if (current) {
            await StackBackup.create(this.name, "pull", current);
        }

        const owner = this.gitOwner;
        const before = owner ? await this.gitOutput("rev-parse", "HEAD").catch(() => "") : "";

        const exitCode = await Terminal.exec(this.server, socket, terminalName, "git", [ ...this.gitSafeArgs, "pull" ], this.path, env);

        // Also after a failed pull, which can write objects and FETCH_HEAD
        if (owner) {
            await this.restoreGitOwnership(owner, before).catch((e) => {
                log.warn("gitPull", "Cannot give the files of " + this.name + " back to their owner: " + errorMessage(e));
            });
        }

        if (exitCode !== 0) {
            throw new Error("Failed to pull, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async toJSON(endpoint : string) : Promise<object> {
        // Start git while the settings are read
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
            // Count of images with an update. Additive; older clients ignore it.
            imageUpdates: (this.isManagedByDockge && ImageUpdateChecker.available.size > 0)
                ? this.images.filter((image) => ImageUpdateChecker.available.has(image)).length
                : 0,
        };
    }

    protected _composeInfo? : ComposeInfo;

    /**
     * Images and project names from the compose file, with .env variables
     * substituted.
     *
     * Callers that remove resources must check ok: a broken compose file
     * gives empty lists, which protect nothing.
     */
    get composeInfo() : ComposeInfo {
        if (this._composeInfo !== undefined) {
            return this._composeInfo;
        }

        const info : ComposeInfo = {
            ok: false,
            images: [],
            projectNames: [],
            buildImages: [],
        };
        this._composeInfo = info;

        try {
            // Same order as docker: global.env, then the stack's .env
            let env : Record<string, string> = {};
            const globalEnvPath = path.join(this.server.stacksDir, "global.env");
            if (fs.existsSync(globalEnvPath)) {
                env = dotenv.parse(fs.readFileSync(globalEnvPath, "utf-8"));
            }
            env = {
                ...env,
                ...dotenv.parse(this.composeENV),
            };
            const doc = yaml.parse(envsubstYAML(this.composeYAML, env));

            // Docker names the project after the directory, unless the
            // compose file or .env overrides it. Names are lowercased.
            const projects = new Set<string>([ this.name.toLowerCase() ]);
            if (typeof doc?.name === "string" && doc.name.trim() !== "") {
                projects.add(doc.name.trim().toLowerCase());
            }
            if (typeof env.COMPOSE_PROJECT_NAME === "string" && env.COMPOSE_PROJECT_NAME.trim() !== "") {
                projects.add(env.COMPOSE_PROJECT_NAME.trim().toLowerCase());
            }
            info.projectNames = [ ...projects ];

            const services = doc?.services;
            if (services && typeof services === "object") {
                for (const [ serviceName, service ] of Object.entries(services) as [ string, { image? : unknown, build? : unknown } | null ][]) {
                    if (service && typeof service.image === "string" && service.image.trim() !== "") {
                        info.images.push(service.image.trim());
                        continue;
                    }
                    // Docker names a built image "<project>-<service>"
                    if (service && service.build !== undefined && service.build !== null) {
                        for (const project of info.projectNames) {
                            info.buildImages.push(project + "-" + serviceName);
                            info.buildImages.push(project + "_" + serviceName);
                        }
                    }
                }
            }

            info.ok = true;
        } catch (e) {
            log.debug("stack", "Cannot read the compose file of " + this.name + ": " + errorMessage(e));
        }

        return info;
    }

    /**
     * Service images of this stack; empty if the compose file is broken.
     */
    get images() : string[] {
        return this.composeInfo.images;
    }

    /**
     * Read the files on disk for a backup.
     * @returns The files, or null if the stack has no directory
     */
    protected async currentFiles() : Promise<StackFiles | null> {
        if (!await fileExists(this.path)) {
            return null;
        }
        const current = new Stack(this.server, this.name);

        // An unreadable file must not be backed up as empty, or a restore
        // would wipe it.
        const read = async (file : string, optional : boolean) : Promise<string | null> => {
            try {
                return await fsAsync.readFile(path.join(this.path, file), "utf-8");
            } catch (e) {
                if (optional && (e as NodeJS.ErrnoException)?.code === "ENOENT") {
                    return null;
                }
                throw e;
            }
        };

        try {
            const composeYAML = await read(current._composeFileName, false);
            const composeENV = await read(".env", true);
            const composeOverrideYAML = await read(current.composeOverrideFileName, true);
            return {
                composeYAML: composeYAML as string,
                composeENV: composeENV ?? "",
                composeOverrideYAML,
            };
        } catch (e) {
            log.warn("backup", "Cannot read the files of " + this.name + ": " + errorMessage(e));
            return null;
        }
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

        // Only when this save carries override content. A comment-only
        // file is valid, since docker accepts it.
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
                // A missing file is normal. Log other errors, since they hide
                // the file from the UI.
                if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
                    log.warn("stack", `Cannot read the override file of the stack ${this.name}: ${e}`);
                }
                this._composeOverrideYAML = null;
            }
        }
        return this._composeOverrideYAML;
    }

    /**
     * Override file name. Like docker, use the first accepted name that
     * exists, regardless of the base file name. If none exists, pick a
     * name that matches the base file.
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
     * True if there is override content to write. Empty means delete the file.
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
     * @param reason Backup reason
     */
    async save(isAdd : boolean, reason = "save") {
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

            // Back up the current files
            const current = await this.currentFiles();
            if (current) {
                await StackBackup.create(this.name, reason, current);
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

        // Write or remove the override file. Undefined means leave it alone.
        if (this._composeOverrideYAML !== undefined) {
            const overridePath = path.join(dir, this.composeOverrideFileName);

            // Do not write through or delete a symlink or directory
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
     * Run `docker compose ... config`. On failure, content is docker's own
     * error, which catches more than a YAML parser.
     * @param args Full argument list, starting with "compose"
     * @param cwd Working directory
     */
    protected static async runComposeConfig(args : string[], cwd : string) : Promise<{ ok : boolean, content : string }> {
        try {
            const res = await childProcessAsync.spawn("docker", args, {
                cwd,
                encoding: "utf-8",
                // Large stacks exceed the 200 KiB default
                maxBuffer: 10 * 1024 * 1024,
                // Don't hang on an unresponsive daemon; matches the frontend timeout
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
     * Merged config from `docker compose config`. Only for managed stacks,
     * since it runs in the stack directory.
     */
    async getComposeConfig() : Promise<{ ok : boolean, content : string }> {
        return Stack.runComposeConfig(this.getComposeOptions("config"), this.path);
    }

    /**
     * Validate unsaved editor content with `docker compose config`, using a
     * temp directory so the stack files do not change. Returns the merged
     * config or docker's error.
     * @param server The server, to find global.env
     * @param name Stack name, used as the docker project name
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

            // Always write it, even if empty: the explicit --env-file below
            // stops docker from loading the stack's own .env.
            await fsAsync.writeFile(envPath, composeENV);

            const args = [ "compose", "-f", composePath ];

            if (composeOverrideYAML !== null && composeOverrideYAML.trim() !== "") {
                const overridePath = path.join(dir, "compose.override.yaml");
                await fsAsync.writeFile(overridePath, composeOverrideYAML);
                args.push("-f", overridePath);
            }

            // Relative paths (env_file, bind mounts) and the project name come
            // from the project directory, so use the stack directory if it
            // exists, as a deploy would. The name check keeps it inside stacksDir.
            let projectDir = dir;
            if (name.match(/^[a-z0-9_-]+$/)) {
                const stackDir = path.resolve(server.stacksDir, name);
                if (await fileExists(stackDir)) {
                    projectDir = stackDir;
                }
            }
            args.push("--project-directory", projectDir);

            // Same order as getComposeOptions: global.env, then the stack .env
            const globalEnvPath = path.resolve(server.stacksDir, "global.env");
            if (await fileExists(globalEnvPath)) {
                args.push("--env-file", globalEnvPath);
            }
            args.push("--env-file", envPath);
            args.push("config");

            return await Stack.runComposeConfig(args, dir);
        } finally {
            // Don't let cleanup errors mask the result. Windows may hold the
            // directory briefly after a timeout kills the process.
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
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to deploy, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async delete(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("down", "--remove-orphans"), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to delete, please check the terminal output for more information.");
        }

        // Remove the stack folder
        await fsAsync.rm(this.path, {
            recursive: true,
            force: true
        });

        await StackBackup.removeAll(this.name);

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
            // Copy so unmanaged projects added below stay out of the cache.
            // Reset status so a stack gone from compose ls (e.g. a down
            // outside dockge-mod) does not keep a stale status.
            stackList = new Map(this.managedStackList);
            for (const stack of stackList.values()) {
                stack._status = CREATED_FILE;
            }
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
        const composeList = await Stack.composeListCache.get();

        for (let composeStack of composeList) {
            let stack = stackList.get(composeStack.Name);

            // This stack probably is not managed by Dockge, but we still want to show it
            if (!stack) {
                // Skip our own stack; its name depends on the directory
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

        const composeList = await Stack.composeListCache.get();

        for (let composeStack of composeList) {
            statusList.set(composeStack.Name, this.statusConvert(composeStack.Status));
        }

        return statusList;
    }

    /**
     * Shared `docker compose ls` output. The docker events watcher
     * invalidates it; the TTL covers a watcher that is not running.
     */
    static composeListCache = new CachedCall(() => Stack.runComposeList(), 10 * 1000);

    /**
     * Per-stack service status caches, also invalidated by the watcher.
     */
    protected static serviceStatusCaches : Map<string, CachedCall<Map<string, Array<object>>>> = new Map();

    /**
     * Drop cached docker results.
     * @param names The stacks that changed; omit to clear all
     */
    static invalidateCaches(names? : Iterable<string>) {
        Stack.composeListCache.invalidate();
        if (!names) {
            Stack.serviceStatusCaches.clear();
            return;
        }
        for (const name of names) {
            Stack.serviceStatusCaches.delete(name);
        }
    }

    /**
     * Run `docker compose ls`. Returns an empty list on no output or bad JSON.
     * @returns The projects docker knows about
     */
    protected static async runComposeList() : Promise<{ Name : string, Status : string, ConfigFiles : string }[]> {
        const res = await childProcessAsync.spawn("docker", [ "compose", "ls", "--all", "--format", "json" ], DOCKER_SPAWN_OPTIONS);

        if (!res.stdout) {
            return [];
        }

        try {
            const list = JSON.parse(res.stdout.toString());
            return Array.isArray(list) ? list : [];
        } catch (e) {
            log.warn("getStackList", "docker compose ls gave no JSON: " + errorMessage(e));
            return [];
        }
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

        // Block path traversal outside the stacks directory
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
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to start, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async stop(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("stop"), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to stop, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async restart(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("restart"), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to restart, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async down(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("down"), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to down, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async update(socket: DockgeSocket) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("pull"), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to pull, please check the terminal output for more information.");
        }

        // Clear the update badge of the pulled images
        await ImageUpdateChecker.afterPull(this.images).catch((e) => {
            log.warn("update", "Cannot refresh the update state of " + this.name + ": " + errorMessage(e));
        });

        // If the stack is not running, we don't need to restart it
        await this.updateStatus();
        log.debug("update", "Status: " + this.status);
        if (this.status !== RUNNING) {
            return exitCode;
        }

        exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error("Failed to restart, please check the terminal output for more information.");
        }
        return exitCode;
    }

    /**
     * Join the log terminal of one service.
     * @param socket The client
     * @param serviceName The service
     * @returns The terminal name, for the client
     */
    joinServiceLogs(socket: DockgeSocket, serviceName : string) : string {
        checkServiceName(serviceName);
        const terminalName = getServiceLogsTerminalName(socket.endpoint, this.name, serviceName);
        const existing = Terminal.getTerminal(terminalName);
        const terminal = Terminal.getOrCreateTerminal(this.server, terminalName, "docker", this.getComposeOptions("logs", "-f", "--tail", "200", serviceName), this.path);
        terminal.enableKeepAlive = true;
        if (!existing) {
            terminal.rows = COMBINED_TERMINAL_ROWS;
            terminal.cols = COMBINED_TERMINAL_COLS;
        }
        terminal.join(socket);
        terminal.start();
        return terminalName;
    }

    /**
     * Leave the log of one service.
     * @param socket The client
     * @param serviceName The service
     */
    leaveServiceLogs(socket: DockgeSocket, serviceName : string) {
        checkServiceName(serviceName);
        const terminal = Terminal.getTerminal(getServiceLogsTerminalName(socket.endpoint, this.name, serviceName));
        terminal?.leave(socket);
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
        checkServiceName(serviceName);
        checkShellName(shell);

        const terminalName = getContainerExecTerminalName(socket.endpoint, this.name, serviceName, index);
        let terminal = Terminal.getTerminal(terminalName);

        if (!terminal) {
            const newTerminal = new InteractiveTerminal(this.server, terminalName, "docker", this.getComposeOptions("exec", serviceName, shell), this.path);
            newTerminal.rows = TERMINAL_ROWS;
            terminal = newTerminal;
            log.debug("joinContainerTerminal", "Terminal created");
        }

        if (!(terminal instanceof InteractiveTerminal)) {
            throw new ValidationError("The terminal name is in use.");
        }

        terminal.join(socket);
        terminal.start();
    }

    /**
     * Get container IPs with one batched `docker inspect`, since
     * `docker compose ps` has no addresses. Best effort: stopped containers
     * have none.
     * @param containers name/id pairs from `docker compose ps`
     */
    static async getContainerIPs(containers : { name : string, id : string }[]) : Promise<Map<string, string>> {
        const map = new Map<string, string>();
        if (containers.length === 0) {
            return map;
        }

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
            const res = await childProcessAsync.spawn("docker", [ "inspect", "--type", "container", "--format", format, ...containers.map((c) => c.name) ], DOCKER_SPAWN_OPTIONS);
            parse(res.stdout?.toString() ?? "");
        } catch (e) {
            // A container removed between `ps` and `inspect` makes inspect exit
            // non-zero, but the surviving containers are still printed.
            const partial = (e as { stdout ?: string | Buffer })?.stdout;
            if (partial) {
                parse(partial.toString());
            } else {
                log.debug("getContainerIPs", "docker inspect failed: " + errorMessage(e));
            }
        }

        return map;
    }

    /**
     * Service status of this stack, cached so polling clients share one
     * docker call until a container changes.
     * @returns The containers of each service
     */
    async getServiceStatusList() : Promise<Map<string, Array<object>>> {
        let cache = Stack.serviceStatusCaches.get(this.name);
        if (!cache) {
            // Don't create cache entries for arbitrary client-supplied names
            if (!await fileExists(this.path) && !(await Stack.getStatusList()).has(this.name)) {
                throw new ValidationError("Stack not found");
            }
            if (Stack.serviceStatusCaches.size >= 500) {
                Stack.serviceStatusCaches.clear();
            }
            cache = new CachedCall(() => this.readServiceStatusList(), 5 * 1000);
            Stack.serviceStatusCaches.set(this.name, cache);
        }
        return cache.get();
    }

    protected async readServiceStatusList() : Promise<Map<string, Array<object>>> {
        let statusList = new Map<string, Array<object>>();

        try {
            let res = await childProcessAsync.spawn("docker", this.getComposeOptions("ps", "--format", "json"), {
                cwd: this.path,
                ...DOCKER_SPAWN_OPTIONS,
            });

            if (!res.stdout) {
                return statusList;
            }

            const containers : { name : string, id : string }[] = [];

            const addLine = (obj: { Service: string, State: string, Name: string, Health: string, Status: string, Ports: string, ID: string }) => {
                if (!statusList.has(obj.Service)) {
                    statusList.set(obj.Service, []);
                }
                statusList.get(obj.Service)?.push({
                    status: obj.Health || obj.State,
                    name: obj.Name,
                    // Human-readable uptime, e.g. "Up 23 minutes"
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

            for (const obj of parseJSONLines(res.stdout.toString())) {
                if (Array.isArray(obj)) {
                    obj.forEach(addLine);
                } else {
                    addLine(obj as Parameters<typeof addLine>[0]);
                }
            }

            const ipMap = await Stack.getContainerIPs(containers);
            for (const entries of statusList.values()) {
                for (const entry of entries) {
                    const e = entry as { name : string, ip : string };
                    e.ip = ipMap.get(e.name) ?? "";
                }
            }

            return statusList;
        } catch (e) {
            // Throw so a failure is not cached as an empty list
            log.error("getServiceStatusList", e);
            throw e;
        }
    }

    async startService(socket: DockgeSocket, serviceName: string) {
        checkServiceName(serviceName);
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", serviceName), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error(`Failed to start service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }

    async stopService(socket: DockgeSocket, serviceName: string): Promise<number> {
        checkServiceName(serviceName);
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("stop", serviceName), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error(`Failed to stop service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }

    async restartService(socket: DockgeSocket, serviceName: string): Promise<number> {
        checkServiceName(serviceName);
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("restart", serviceName), this.path);
        Stack.invalidateCaches([ this.name ]);
        if (exitCode !== 0) {
            throw new Error(`Failed to restart service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }
}
