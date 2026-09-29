import { R } from "redbean-node";

/**
 * The key and value store of dockge-mod, in the `mod_setting` table.
 * The upstream `setting` table does not change. A value is a text. A
 * key without a row gives null, and an empty value removes the row.
 * There is no cache. Read a value one time, not in a loop.
 */
export class ModSetting {

    static readonly COMPOSE_OVERRIDE_TEMPLATE = "composeOverrideTemplate";

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
}
