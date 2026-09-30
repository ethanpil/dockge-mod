import type { Knex } from "knex";

/**
 * Records which stack owns each volume.
 *
 * Anonymous volumes get no compose label, so after `docker compose down`
 * nothing links them to their stack. We record the owner while a container
 * still exists, so a later prune of unused volumes can spare them.
 * @param knex The database
 * @returns The schema change
 */
export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable("mod_volume_owner", (table) => {
        table.increments("id");
        table.string("volume", 255).notNullable().unique();
        table.string("project", 255).notNullable();
        table.datetime("seen_at").notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    return knex.schema.dropTable("mod_volume_owner");
}
