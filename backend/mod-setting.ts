import { R } from "redbean-node";
import { promises as fsAsync } from "fs";
import path from "path";
import { log } from "./log";
import { defaultComposeOverrideTemplate } from "../common/util-common";

/**
 * The key and value store of dockge-mod, in the `mod_setting` table.
 * The upstream `setting` table does not change. A value is a text. A
 * key without a row gives null, and an empty value removes the row.
 * There is no cache. Read a value one time, not in a loop.
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
     * Write a value. A null value or an empty value removes the row.
     * @param key The key
     * @param value The value, or null
     */
    static async set(key : string, value : string | null) : Promise<void> {
        if (value === null || value.trim() === "") {
            await R.knex("mod_setting").where({ key }).del();
            return;
        }

        await R.knex("mod_setting").insert({
            key,
            value,
        }).onConflict("key").merge();
    }

    /**
     * Move the values that an earlier version kept in files of the data
     * directory to the table. The server removes the file after the
     * move. Usually the file does not exist. A problem with the file
     * gives a warning, because it must not stop the server.
     * @param dataDir The data directory
     */
    static async importLegacyFiles(dataDir : string) : Promise<void> {
        const templatePath = path.join(dataDir, ModSetting.legacyOverrideTemplateFileName);

        let content : string;
        try {
            content = await fsAsync.readFile(templatePath, "utf-8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
                log.warn("db", "Cannot read " + templatePath + ": " + (e as Error).message);
            }
            return;
        }

        try {
            // The default text needs no row, the same as a save
            if (content !== defaultComposeOverrideTemplate) {
                await ModSetting.set(ModSetting.COMPOSE_OVERRIDE_TEMPLATE, content);
            }
            await fsAsync.rm(templatePath, {
                force: true,
            });
            log.info("db", "Moved the override template from " + templatePath + " to the database");
        } catch (e) {
            log.warn("db", "Cannot move " + templatePath + " to the database: " + (e as Error).message);
        }
    }
}
