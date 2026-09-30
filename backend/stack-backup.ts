import { R } from "redbean-node";
import { log } from "./log";
import { errorMessage, ValidationError } from "./util-server";

/** The content of the files of a stack */
export interface StackFiles {
    composeYAML : string;
    composeENV : string;
    composeOverrideYAML : string | null;
}

/** Backup list entry, without the file content */
export interface StackBackupInfo {
    id : number;
    stack : string;
    reason : string;
    createdAt : string;
}

/**
 * Snapshots of a stack's files in mod_stack_backup, taken before a save
 * or update changes them, so the user can restore one.
 */
export class StackBackup {

    /** Max copies kept per stack */
    static readonly KEEP = 20;

    /**
     * Make a copy if the files differ from the last one. Errors are only
     * logged, so a failed backup never blocks a save.
     * @param stack The stack name
     * @param reason Why the copy exists, for example "save"
     * @param files The content of the files
     */
    static async create(stack : string, reason : string, files : StackFiles) : Promise<void> {
        try {
            // Compare in the database so the last copy's text is not loaded
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
     * Delete copies beyond the KEEP limit.
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
     * List a stack's copies, newest first, without content.
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
     * Get the content of one copy.
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
     * Delete all copies of a stack (used when the stack is deleted).
     * @param stack The stack name
     */
    static async removeAll(stack : string) : Promise<void> {
        await R.knex("mod_stack_backup").where({ stack }).del();
    }
}
