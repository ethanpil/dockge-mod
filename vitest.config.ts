import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: [ "test/**/*.test.ts" ],
        // The tests run in node. The modules under test have no browser
        // dependency.
        environment: "node",
    },
});
