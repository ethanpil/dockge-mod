import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: [ "test/**/*.test.ts" ],
        // The tests run in node. A frontend module that needs the browser
        // gets a mock in its test file.
        environment: "node",
    },
});
