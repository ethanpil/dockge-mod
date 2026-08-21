import { defineConfig } from "vitest/config";

// The test script runs vitest with the tsx loader. knex imports the
// migration files with a dynamic import outside the vitest transform,
// and the upstream migration files need tsx for that import.
export default defineConfig({
    test: {
        include: [ "test/**/*.test.ts" ],
        // The tests run in node. The modules under test have no browser
        // dependency.
        environment: "node",
    },
});
