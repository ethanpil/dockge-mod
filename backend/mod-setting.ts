import { R } from "redbean-node";
import { promises as fsAsync } from "fs";
import path from "path";
import { log } from "./log";
import { fileExists } from "./util-server";

/**
 * The key and value store of dockge-mod, in the `mod_setting` table.
 * The upstream `setting` table stays as it is. A value is a text. A
 * key without a row gives null.
 */
export class ModSetting {

    static readonly COMPOSE_OVERRIDE_TEMPLATE = "composeOverrideTemplate";

    /**
     * The name of the file that held the override template before the
     * `mod_setting` table existed. The start of the server moves the
     * content to the table and removes the file.
     */
    static readonly legacyOverrideTemplateFileName = "compose.override.template.yaml";

    /**
     * Read a value.
     * @param key The key
     * @returns The value, or null when the key has no row
     */
    static async get(key : string) : Promise<string | null> {
        const row = await R.knex("mod_setting").where({ key }).first("value");
        return row?.value ?? null;
    }

    /**
     * Write a value. A null value removes the row.
     * @param key The key
     * @param value The value, or null
     */
    static async set(key : string, value : string | null) : Promise<void> {
        if (value === null) {
            await R.knex("mod_setting").where({ key }).del();
            return;
        }

        const changed = await R.knex("mod_setting").where({ key }).update({ value });
        if (changed === 0) {
            await R.knex("mod_setting").insert({
                key,
                value,
            });
        }
    }

    /**
     * Move the values that an earlier version kept in files of the data
     * directory to the table. The file goes away after the move. A file
     * that is not there is the usual condition.
     * @param dataDir The data directory
     */
    static async importLegacyFiles(dataDir : string) : Promise<void> {
        const templatePath = path.join(dataDir, ModSetting.legacyOverrideTemplateFileName);
        if (!await fileExists(templatePath)) {
            return;
        }

        const content = await fsAsync.readFile(templatePath, "utf-8");
        if (content.trim() !== "") {
            await ModSetting.set(ModSetting.COMPOSE_OVERRIDE_TEMPLATE, content);
        }
        await fsAsync.rm(templatePath, {
            force: true,
        });
        log.info("db", "Moved the override template from " + templatePath + " to the database");
    }
}
