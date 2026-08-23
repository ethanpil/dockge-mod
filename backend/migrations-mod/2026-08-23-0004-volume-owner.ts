import type { Knex } from "knex";

/**
 * The stack that a volume belongs to.
 *
 * Docker makes an anonymous volume itself, and it puts no compose label
 * on that volume. After `docker compose down` the volume keeps its data
 * and no container holds it, thus nothing says which stack made it. The
 * server writes this table while a container of the stack exists, thus
 * a removal of the unused volumes can keep the volume later.
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
