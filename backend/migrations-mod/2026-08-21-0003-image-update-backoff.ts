import type { Knex } from "knex";

/**
 * Failure count and next check time per image, so images that always
 * fail (local builds, private registries) are checked less often.
 * @param knex The database
 * @returns The schema change
 */
export async function up(knex: Knex): Promise<void> {
    return knex.schema.alterTable("mod_image_update", (table) => {
        table.integer("failures").notNullable().defaultTo(0);
        table.datetime("next_check");
    });
}

export async function down(knex: Knex): Promise<void> {
    return knex.schema.alterTable("mod_image_update", (table) => {
        table.dropColumn("failures");
        table.dropColumn("next_check");
    });
}
