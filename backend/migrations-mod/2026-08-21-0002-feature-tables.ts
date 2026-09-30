import type { Knex } from "knex";

/**
 * Tables for image update checks, notifications and stack backups.
 * The mod_ prefix keeps them apart from Dockge, which ignores them.
 * @param knex The database
 * @returns The schema change
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable("mod_image_update", (table) => {
        table.increments("id");
        table.string("image", 500).notNullable().unique();
        table.string("local_digest", 100);
        table.string("remote_digest", 100);
        table.boolean("update_available").notNullable().defaultTo(false);
        table.datetime("checked_at");
        table.text("error");
    });

    await knex.schema.createTable("mod_notification", (table) => {
        table.increments("id");
        table.string("name", 200).notNullable();
        table.string("type", 50).notNullable();
        table.string("url", 2000).notNullable();
        // JSON array of event names
        table.text("events").notNullable();
        table.boolean("active").notNullable().defaultTo(true);
    });

    await knex.schema.createTable("mod_stack_backup", (table) => {
        table.increments("id");
        table.string("stack", 255).notNullable().index();
        table.string("reason", 50).notNullable();
        table.text("compose_yaml").notNullable();
        table.text("compose_env").notNullable();
        table.text("compose_override_yaml");
        table.datetime("created_at").notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable("mod_stack_backup");
    await knex.schema.dropTable("mod_notification");
    await knex.schema.dropTable("mod_image_update");
}
