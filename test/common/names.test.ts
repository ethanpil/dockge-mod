import { describe, expect, it } from "vitest";
import { isComposeServiceName, isShellName } from "../../common/util-common";

describe("isComposeServiceName", () => {
    it.each([
        [ "web", true ],
        [ "db-1", true ],
        [ "my_service.v2", true ],
        [ "1abc", true ],
        [ "", false ],
        [ "-d", false ],
        [ "--project-directory=/", false ],
        [ "web db", false ],
        [ "web;rm", false ],
        [ "../web", false ],
    ])("%j is %s", (name, ok) => {
        expect(isComposeServiceName(name)).toBe(ok);
    });
});

describe("isShellName", () => {
    it.each([
        [ "sh", true ],
        [ "bash", true ],
        [ "/bin/bash", true ],
        [ "/usr/local/bin/fish", true ],
        [ "", false ],
        [ "-c", false ],
        [ "--privileged", false ],
        [ "sh -c id", false ],
        [ "bash;id", false ],
    ])("%j is %s", (shell, ok) => {
        expect(isShellName(shell)).toBe(ok);
    });
});
