import type { Knex } from "knex";

/**
 * The count of the failures of an image, and the time of the next
 * check. An image that fails each time, for example a local build or a
 * registry without credentials, gets a longer time between the checks.
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
