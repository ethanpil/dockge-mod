import { R } from "redbean-node";
import { log } from "./log";
import { errorMessage, ValidationError } from "./util-server";

/** The content of the files of a stack */
export interface StackFiles {
    composeYAML : string;
    composeENV : string;
    composeOverrideYAML : string | null;
}

/** One backup, for the interface. The content is not in the list. */
export interface StackBackupInfo {
    id : number;
    stack : string;
    reason : string;
    createdAt : string;
}

/**
 * Copies of the files of a stack, in the mod_stack_backup table. A save
 * and an update make a copy before they change the files. A user can
 * put a copy back.
 */
export class StackBackup {

    /** How many copies stay for one stack */
    static readonly KEEP = 20;

    /**
     * Make a copy, when the files are different from the last copy.
     * A failure gives a log line, because a backup must not stop a save.
     * @param stack The stack name
     * @param reason Why the copy exists, for example "save"
     * @param files The content of the files
     */
    static async create(stack : string, reason : string, files : StackFiles) : Promise<void> {
        try {
            // The database compares the content with the last copy, thus
            // the text of the last copy does not come to the server
            const last = await R.knex("mod_stack_backup").where({ stack }).orderBy("id", "desc").first("id");
            if (last) {
                const same = await R.knex("mod_stack_backup").where({
                    id: last.id,
                    compose_yaml: files.composeYAML,
                    compose_env: files.composeENV,
                    compose_override_yaml: files.composeOverrideYAML,
                }).first("id");
                if (same) {
                    return;
                }
            }

            await R.knex("mod_stack_backup").insert({
                stack,
                reason,
                compose_yaml: files.composeYAML,
                compose_env: files.composeENV,
                compose_override_yaml: files.composeOverrideYAML,
                created_at: new Date().toISOString(),
            });

            await StackBackup.prune(stack);
        } catch (e) {
            log.warn("backup", "Cannot make a backup of " + stack + ": " + errorMessage(e));
        }
    }

    /**
     * Remove the old copies of a stack, above the limit.
     * @param stack The stack name
     */
    static async prune(stack : string) : Promise<void> {
        const rows = await R.knex("mod_stack_backup").where({ stack }).orderBy("id", "desc").select("id");
        const old = rows.slice(StackBackup.KEEP).map((row : { id : number }) => row.id);
        if (old.length > 0) {
            await R.knex("mod_stack_backup").whereIn("id", old).del();
        }
    }

    /**
     * The copies of a stack, newest first, without the content.
     * @param stack The stack name
     * @returns The list
     */
    static async list(stack : string) : Promise<StackBackupInfo[]> {
        const rows = await R.knex("mod_stack_backup").where({ stack }).orderBy("id", "desc").select("id", "stack", "reason", "created_at");
        return rows.map((row : Record<string, unknown>) => ({
            id: row.id as number,
            stack: row.stack as string,
            reason: row.reason as string,
            createdAt: row.created_at as string,
        }));
    }

    /**
     * The content of one copy.
     * @param stack The stack name
     * @param id The id of the copy
     * @returns The files
     */
    static async get(stack : string, id : number) : Promise<StackFiles> {
        const row = await R.knex("mod_stack_backup").where({
            stack,
            id,
        }).first();
        if (!row) {
            throw new ValidationError("Backup not found");
        }
        return {
            composeYAML: row.compose_yaml,
            composeENV: row.compose_env,
            composeOverrideYAML: row.compose_override_yaml ?? null,
        };
    }

    /**
     * Remove all copies of a stack, after a delete of the stack.
     * @param stack The stack name
     */
    static async removeAll(stack : string) : Promise<void> {
        await R.knex("mod_stack_backup").where({ stack }).del();
    }
}
