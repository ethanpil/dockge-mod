import { R } from "redbean-node";

/**
 * Key/value store for dockge-mod in the `mod_setting` table, so the
 * upstream `setting` table stays untouched. Uncached: avoid reading in a loop.
 */
export class ModSetting {

    static readonly COMPOSE_OVERRIDE_TEMPLATE = "composeOverrideTemplate";

    /**
     * Read a value.
     * @param key The key
     * @returns The value, or null if unset
     */
    static async get(key : string) : Promise<string | null> {
        const row = await R.knex("mod_setting").where({ key }).first("value");
        return row?.value ?? null;
    }

    /**
     * Write a value. A null or blank value deletes the row.
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
