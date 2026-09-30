/*
 * Parse and serialize a .env file for the row editor. Kept stateless so
 * it can be tested without the component.
 */

// Key characters docker and dotenv accept (a leading digit is allowed).
// Shared so the key field check and the parser cannot drift apart.
const KEY_PATTERN = "[A-Za-z0-9_][A-Za-z0-9_.-]*";

// Keys that fail this are dropped from the file and flagged in the row
const KEY_REGEX = new RegExp("^" + KEY_PATTERN + "$");

// Optional "export " prefix, key, and everything after the first "="
const PAIR_REGEX = new RegExp("^((?:export\\s+)?)(" + KEY_PATTERN + ")=(.*)$");

export interface EnvPair {
    type : "pair";
    prefix : string;
    key : string;
    value : string;
}

export interface EnvRaw {
    type : "raw";
    text : string;
}

export type EnvEntry = EnvPair | EnvRaw;

export interface EnvFile {
    entries : EnvEntry[];
    // "\n", or "\r\n" for a Windows file
    eol : string;
    finalNewline : boolean;
}

/**
 * Check if a key is valid for a .env file.
 * @param key the key text
 * @returns true if docker accepts the key
 */
export function isEnvKey(key : string) : boolean {
    return KEY_REGEX.test(key);
}

/**
 * Split the text into key/value pairs and raw lines, keeping order.
 * A multi-line quoted value stays one raw block, since the row fields
 * cannot show it.
 * @param text the .env text
 * @returns the entries, line ending, and final newline flag
 */
export function parseEnvFile(text : string) : EnvFile {
    const file : EnvFile = {
        entries: [],
        eol: text.includes("\r\n") ? "\r\n" : "\n",
        finalNewline: text === "" || text.endsWith("\n"),
    };

    if (!text) {
        return file;
    }

    const lines = text.split(/\r?\n/);

    // Drop the empty item after a final newline; serialize adds it back
    if (file.finalNewline) {
        lines.pop();
    }

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(PAIR_REGEX);

        if (match) {
            const value = match[3];
            const quote = value[0];

            // Unclosed quote: the value continues on the next lines
            if ((quote === "\"" || quote === "'") && !value.slice(1).includes(quote)) {
                const block = [ lines[i] ];
                while (i + 1 < lines.length) {
                    i++;
                    block.push(lines[i]);
                    if (lines[i].includes(quote)) {
                        break;
                    }
                }
                file.entries.push({
                    type: "raw",
                    text: block.join(file.eol),
                });
                continue;
            }

            file.entries.push({
                type: "pair",
                prefix: match[1],
                key: match[2],
                value,
            });
        } else {
            file.entries.push({
                type: "raw",
                text: lines[i],
            });
        }
    }

    return file;
}

/**
 * Build the .env text. Pairs with invalid keys are skipped, since docker
 * rejects a file that contains one.
 * @param file the entries, line ending, and final newline flag
 * @returns the .env text
 */
export function serializeEnvFile(file : EnvFile) : string {
    const lines : string[] = [];
    for (const entry of file.entries) {
        if (entry.type === "pair") {
            if (isEnvKey(entry.key)) {
                lines.push(entry.prefix + entry.key + "=" + entry.value);
            }
        } else {
            lines.push(entry.text);
        }
    }
    if (lines.length === 0) {
        return "";
    }
    return lines.join(file.eol) + (file.finalNewline ? file.eol : "");
}
