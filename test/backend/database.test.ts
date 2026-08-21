import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { R } from "redbean-node";
import { Database } from "../../backend/database";
import { ModSetting } from "../../backend/mod-setting";
import type { DockgeServer } from "../../backend/dockge-server";

/**
 * The names of the upstream migrations. Dockge reads this list from the
 * `knex_migrations` table. A different list there is a compatibility
 * break, because knex refuses to run the migrations of Dockge when the
 * table names a file that Dockge does not have.
 */
const UPSTREAM_MIGRATIONS = [
    "2023-10-20-0829-setting-table.ts",
    "2023-10-20-0829-user-table.ts",
    "2023-12-20-2117-agent-table.ts",
];

describe("Database", () => {
    let dataDir : string;

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dockge-db-"));
        // The override template of an earlier version, in a file
        fs.writeFileSync(path.join(dataDir, ModSetting.legacyOverrideTemplateFileName), "# my template\n");
        const server = { config: { dataDir } } as unknown as DockgeServer;
        // The same steps as Database.init, without the model autoload. The
        // loader of the models uses a dynamic import that vitest cannot
        // resolve, and the mod settings do not need the models.
        Database.server = server;
        await Database.connect(false);
        await Database.patch();
        await Database.patchMod();
        await ModSetting.importLegacyFiles(dataDir);
    }, 30000);

    afterAll(async () => {
        await Database.close();
        fs.rmSync(dataDir, {
            recursive: true,
            force: true,
        });
    }, 30000);

    it("keeps the upstream migration ledger as Dockge knows it", async () => {
        const rows = await R.knex("knex_migrations").orderBy("name").select("name");
        expect(rows.map((row : { name : string }) => row.name)).toEqual(UPSTREAM_MIGRATIONS);
    });

    it("puts the mod migrations in their own ledger", async () => {
        const rows = await R.knex(Database.knexModMigrationsTable).select("name");
        expect(rows.length).toBeGreaterThan(0);
        expect(await R.knex.schema.hasTable("mod_setting")).toBe(true);
    });

    it("gives each mod table the mod_ prefix", async () => {
        const rows = await R.knex("sqlite_master").where({ type: "table" }).select("name");
        const upstream = [ "user", "setting", "agent", "knex_migrations", "knex_migrations_lock" ];
        for (const row of rows) {
            if (!upstream.includes(row.name) && !row.name.startsWith("sqlite_")) {
                expect(row.name).toMatch(/^mod_/);
            }
        }
    });

    it("moves the legacy template file to the table", async () => {
        expect(await ModSetting.get(ModSetting.COMPOSE_OVERRIDE_TEMPLATE)).toBe("# my template\n");
        expect(fs.existsSync(path.join(dataDir, ModSetting.legacyOverrideTemplateFileName))).toBe(false);
    });

    it("reads, writes, and removes a mod setting", async () => {
        expect(await ModSetting.get("absent")).toBeNull();
        await ModSetting.set("demo", "one");
        expect(await ModSetting.get("demo")).toBe("one");
        await ModSetting.set("demo", "two");
        expect(await ModSetting.get("demo")).toBe("two");
        await ModSetting.set("demo", null);
        expect(await ModSetting.get("demo")).toBeNull();
    });

    it("runs the mod migrations again without a change", async () => {
        await expect(Database.patchMod()).resolves.toBeUndefined();
    });
});
