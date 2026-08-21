import type { Knex } from "knex";

/**
 * The key and value table of dockge-mod. The upstream `setting` table
 * stays as it is. Dockge does not read this table.
 * @param knex The database
 * @returns The schema change
 */
export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable("mod_setting", (table) => {
        table.increments("id");
        table.string("key", 200).notNullable().unique();
        table.text("value");
    });
}

export async function down(knex: Knex): Promise<void> {
    return knex.schema.dropTable("mod_setting");
}
