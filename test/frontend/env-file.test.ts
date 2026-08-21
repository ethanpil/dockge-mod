import { describe, expect, it } from "vitest";
import { isEnvKey, parseEnvFile, serializeEnvFile } from "../../frontend/src/env-file";

/**
 * Parse and serialize, which must give the text back unchanged.
 * @param text the .env text
 * @returns the text after a round trip
 */
function roundTrip(text : string) : string {
    return serializeEnvFile(parseEnvFile(text));
}

describe("parseEnvFile", () => {
    it("divides pairs and other lines", () => {
        const file = parseEnvFile("# comment\nA=1\nexport B=two words\n\n");
        expect(file.entries).toEqual([
            {
                type: "raw",
                text: "# comment",
            },
            {
                type: "pair",
                prefix: "",
                key: "A",
                value: "1",
            },
            {
                type: "pair",
                prefix: "export ",
                key: "B",
                value: "two words",
            },
            {
                type: "raw",
                text: "",
            },
        ]);
        expect(file.eol).toBe("\n");
        expect(file.finalNewline).toBe(true);
    });

    it("keeps a value with an = sign", () => {
        const file = parseEnvFile("URL=http://a/b?c=d");
        expect(file.entries[0]).toMatchObject({
            key: "URL",
            value: "http://a/b?c=d",
        });
        expect(file.finalNewline).toBe(false);
    });

    it("keeps a quoted value on more lines as one raw block", () => {
        const file = parseEnvFile("A=\"first\nsecond\"\nB=2\n");
        expect(file.entries).toEqual([
            {
                type: "raw",
                text: "A=\"first\nsecond\"",
            },
            {
                type: "pair",
                prefix: "",
                key: "B",
                value: "2",
            },
        ]);
    });

    it("accepts a key that starts with a digit", () => {
        expect(parseEnvFile("1A=x").entries[0].type).toBe("pair");
    });

    it("keeps a line with a bad key as a raw line", () => {
        expect(parseEnvFile("=value").entries[0]).toEqual({
            type: "raw",
            text: "=value",
        });
    });

    it("reads the line ends of Windows", () => {
        const file = parseEnvFile("A=1\r\nB=2\r\n");
        expect(file.eol).toBe("\r\n");
        expect(file.entries).toHaveLength(2);
    });

    it("treats null as an empty file", () => {
        expect(parseEnvFile(null)).toEqual({
            entries: [],
            eol: "\n",
            finalNewline: true,
        });
    });
});

describe("serializeEnvFile", () => {
    it.each([
        "",
        "A=1\n",
        "A=1",
        "# c\n\nA=1\nexport B=2\n",
        "A=1\r\nB=2\r\n",
        "A=\"x\ny\"\nB=2\n",
        "A=1\n\n\n",
    ])("gives the same text back for %j", (text) => {
        expect(roundTrip(text)).toBe(text);
    });

    it("drops a pair with a bad key", () => {
        const text = serializeEnvFile({
            entries: [
                {
                    type: "pair",
                    prefix: "",
                    key: "",
                    value: "x",
                },
                {
                    type: "pair",
                    prefix: "",
                    key: "OK",
                    value: "1",
                },
            ],
            eol: "\n",
            finalNewline: true,
        });
        expect(text).toBe("OK=1\n");
    });

    it("gives an empty text when no line is left", () => {
        const text = serializeEnvFile({
            entries: [
                {
                    type: "pair",
                    prefix: "",
                    key: "bad key",
                    value: "x",
                },
            ],
            eol: "\n",
            finalNewline: true,
        });
        expect(text).toBe("");
    });
});

describe("isEnvKey", () => {
    it.each([
        [ "A", true ],
        [ "A_B.c-d", true ],
        [ "1A", true ],
        [ "", false ],
        [ "A B", false ],
        [ "A=B", false ],
        [ "-A", false ],
    ])("%j is %s", (key, ok) => {
        expect(isEnvKey(key)).toBe(ok);
    });
});
