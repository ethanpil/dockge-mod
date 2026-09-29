import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { R } from "redbean-node";
import type { Knex } from "knex";
import { Database } from "../../backend/database";
import { AgentManager } from "../../backend/agent-manager";
import type { DockgeServer } from "../../backend/dockge-server";
import type { DockgeSocket } from "../../backend/util-server";

/**
 * Upstream added agent.name by editing an applied migration, so a database
 * created by Dockge 1.5.0 has no such column. dockge-mod must work on it
 * without adding the column.
 */
describe("Database created by Dockge 1.5.0", () => {
    let dataDir : string;
    const server = () => ({ config: { dataDir } }) as unknown as DockgeServer;

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dockge-db150-"));
        await Database.init(server(), false);
        await R.knex.schema.alterTable("agent", (table : Knex.AlterTableBuilder) => {
            table.dropColumn("name");
        });
        await Database.close();

        // Start again on the 1.5.0 schema
        await Database.init(server(), false);
    }, 30000);

    afterAll(async () => {
        await Database.close();
        fs.rmSync(dataDir, {
            recursive: true,
            force: true,
        });
    }, 30000);

    it("does not add the name column", async () => {
        expect(await R.knex.schema.hasColumn("agent", "name")).toBe(false);
    });

    it("adds an agent without a name", async () => {
        const manager = new AgentManager({} as DockgeSocket);
        await manager.add("http://10.0.0.2:5001", "admin", "secret", "Friendly");
        const row = await R.knex("agent").where({ url: "http://10.0.0.2:5001" }).first();
        expect(row.username).toBe("admin");
        expect(row.name).toBeUndefined();
    });

    it("refuses a rename with a clear message", async () => {
        const manager = new AgentManager({} as DockgeSocket);
        await expect(manager.update("http://10.0.0.2:5001", "New")).rejects.toThrow(/cannot store agent names/);
    });
});
