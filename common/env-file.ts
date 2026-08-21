/*
 * Parse and serialize a .env file for the row editor. These functions
 * hold no state, thus a test can examine them without the component.
 */

// The characters of a key that docker and dotenv accept. A digit can
// start a key in an env file. One constant, so the check of the key
// field and the parser cannot come apart.
const KEY_PATTERN = "[A-Za-z0-9_][A-Za-z0-9_.-]*";

// A different key does not go in the file, and the row shows a message
const KEY_REGEX = new RegExp("^" + KEY_PATTERN + "$");

// A pair line: an optional export prefix, a key, and the value after
// the first "=" character
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
    // The line end of the file: "\n", or "\r\n" for a file from Windows
    eol : string;
    // True when the file ends with a line end
    finalNewline : boolean;
}

/**
 * True when a key can go in the file.
 * @param key the key text
 * @returns true when docker accepts the key
 */
export function isEnvKey(key : string) : boolean {
    return KEY_REGEX.test(key);
}

/**
 * Divide the text into pairs and other lines. A value in quotes that
 * continues on more lines stays one raw block, because the fields cannot
 * show it correctly. Comments and other lines keep their positions.
 * @param text the .env text
 * @returns the entries, the line end, and the final line end flag
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

    // The split gives one empty last item for a text with a final line
    // end. The serialization adds the line end back.
    if (file.finalNewline) {
        lines.pop();
    }

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(PAIR_REGEX);

        if (match) {
            const value = match[3];
            const quote = value[0];

            // An open quote without its end on the same line: the value
            // continues on the lines below
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
 * Make the .env text from the entries. A pair with a bad key gives no
 * line, because docker refuses a file that holds one.
 * @param file the entries, the line end, and the final line end flag
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
