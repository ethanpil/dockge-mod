<template>
    <div class="env-editor">
        <div v-for="(entry, index) in entries" :key="entry.id" class="env-entry">
            <!-- One pair takes two rows, so a long value has room -->
            <div v-if="entry.type === 'pair'" class="env-pair">
                <div class="env-row">
                    <span class="env-label">{{ $t("envKey") }}</span>
                    <input
                        v-model="entry.key"
                        type="text"
                        class="form-control form-control-sm mono"
                        :class="{ 'is-invalid': !keyOK(entry) }"
                        autocomplete="off"
                        spellcheck="false"
                        @input="onEdit"
                    />
                    <button type="button" class="mini-btn env-del" :title="$t('deleteVariable')" @click="removeEntry(index)">
                        <font-awesome-icon icon="trash" />
                    </button>
                </div>
                <div class="env-row">
                    <span class="env-label">{{ $t("envValue") }}</span>
                    <input
                        v-model="entry.value"
                        type="text"
                        class="form-control form-control-sm mono"
                        autocomplete="off"
                        spellcheck="false"
                        @input="onEdit"
                    />
                </div>
                <!-- A pair with a bad key does not go in the file, because
                     docker refuses a file that holds such a line. The
                     message makes that visible. -->
                <div v-if="!keyOK(entry)" class="env-key-warning">
                    {{ $t("envKeyInvalid") }}
                </div>
            </div>

            <!-- A comment, or a different line that is not a pair. The
                 text view can change it. -->
            <div v-else class="env-raw mono">{{ entry.text }}</div>
        </div>

        <button type="button" class="btn btn-sm btn-normal mt-2" @click="addEntry">
            <font-awesome-icon icon="plus" class="me-1" />
            {{ $t("addVariable") }}
        </button>
    </div>
</template>

<script>
// The characters of a key that docker and dotenv accept. A digit can
// start a key in an env file. One constant, so the check of the key
// field and the parser cannot come apart.
const KEY_PATTERN = "[A-Za-z0-9_][A-Za-z0-9_.-]*";

// A different key does not go in the file, and the row shows a message
const KEY_REGEX = new RegExp("^" + KEY_PATTERN + "$");

// A pair line: an optional export prefix, a key, and the value after
// the first "=" character
const PAIR_REGEX = new RegExp("^((?:export\\s+)?)(" + KEY_PATTERN + ")=(.*)$");

let nextEntryId = 1;

/**
 * A .env editor with one key field and one value field for each
 * variable. The values are not masked. Lines that are not pairs, for
 * example comments, stay in their positions and do not change.
 *
 * The component does not interpret quotes. The value field holds the
 * exact text after the first "=". The line ends and the last line of
 * the file stay as they are, so the file text stays the same when the
 * user changes nothing.
 */
export default {
    name: "EnvEditor",

    props: {
        /** The text of the .env file */
        modelValue: {
            type: String,
            default: "",
        },
    },

    emits: [ "update:modelValue", "change" ],

    data() {
        return {
            entries: [],
            // The line end of the file: "\n", or "\r\n" for a file from
            // Windows
            eol: "\n",
            // True when the file ends with a line end
            finalNewline: true,
            // The last text that this component made. A model change with
            // this exact text is an echo, not an edit from outside.
            lastSerialized: null,
        };
    },

    watch: {
        modelValue: {
            handler(text) {
                if (text !== this.lastSerialized) {
                    this.parse(text);
                }
            },
            immediate: true,
        },
    },

    unmounted() {
        clearTimeout(this.changeTimer);
    },

    methods: {
        /**
         * True when the key of a pair can go in the file.
         * @param {object} entry a pair entry
         * @returns {boolean}
         */
        keyOK(entry) {
            return KEY_REGEX.test(entry.key);
        },

        /**
         * Divide the text into pairs and other lines. A value in quotes
         * that continues on more lines stays one raw block, because the
         * fields cannot show it correctly.
         * @param {string} text the .env text
         * @returns {void}
         */
        parse(text) {
            // A binding can give null. Treat it as an empty file.
            text = text ?? "";
            this.lastSerialized = text;
            this.entries = [];
            this.eol = text.includes("\r\n") ? "\r\n" : "\n";
            this.finalNewline = text === "" || text.endsWith("\n");

            if (!text) {
                return;
            }

            const lines = text.split(/\r?\n/);

            // The split gives one empty last item for a text with a final
            // line end. The serialization adds the line end back.
            if (this.finalNewline && text !== "") {
                lines.pop();
            }

            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(PAIR_REGEX);

                if (match) {
                    const value = match[3];
                    const quote = value[0];

                    // An open quote without its end on the same line: the
                    // value continues on the lines below
                    if ((quote === "\"" || quote === "'") && !value.slice(1).includes(quote)) {
                        const block = [ lines[i] ];
                        while (i + 1 < lines.length) {
                            i++;
                            block.push(lines[i]);
                            if (lines[i].includes(quote)) {
                                break;
                            }
                        }
                        this.entries.push({
                            id: nextEntryId++,
                            type: "raw",
                            text: block.join(this.eol),
                        });
                        continue;
                    }

                    this.entries.push({
                        id: nextEntryId++,
                        type: "pair",
                        prefix: match[1],
                        key: match[2],
                        value,
                    });
                } else {
                    this.entries.push({
                        id: nextEntryId++,
                        type: "raw",
                        text: lines[i],
                    });
                }
            }
        },

        /**
         * Make the .env text from the entries. A pair with a bad key gives
         * no line, because docker refuses a file that holds one. The row
         * of that pair shows a message, thus the user can see why the
         * variable is not in the file yet.
         * @returns {string} the .env text
         */
        serialize() {
            const lines = [];
            for (const entry of this.entries) {
                if (entry.type === "pair") {
                    if (this.keyOK(entry)) {
                        lines.push(entry.prefix + entry.key + "=" + entry.value);
                    }
                } else {
                    lines.push(entry.text);
                }
            }
            if (lines.length === 0) {
                return "";
            }
            return lines.join(this.eol) + (this.finalNewline ? this.eol : "");
        },

        /**
         * Send the new text to the parent after an edit. The change event
         * waits a short time, so a fast sequence of key presses does not
         * start a YAML parse for each press.
         * @returns {void}
         */
        onEdit() {
            const text = this.serialize();
            this.lastSerialized = text;
            this.$emit("update:modelValue", text);

            clearTimeout(this.changeTimer);
            this.changeTimer = setTimeout(() => {
                this.$emit("change");
            }, 200);
        },

        /**
         * Add an empty pair at the end.
         * @returns {void}
         */
        addEntry() {
            this.entries.push({
                id: nextEntryId++,
                type: "pair",
                prefix: "",
                key: "",
                value: "",
            });
        },

        /**
         * Remove a pair.
         * @param {number} index position of the pair
         * @returns {void}
         */
        removeEntry(index) {
            this.entries.splice(index, 1);
            this.onEdit();
        },
    },
};
</script>

<style scoped lang="scss">
.env-editor {
    padding: 0.5rem;
}

.env-pair {
    border: 1px solid var(--bs-border-color);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.5rem;
}

.env-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    + .env-row {
        margin-top: 0.25rem;
    }
}

.env-label {
    flex: 0 0 3.2rem;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--bs-secondary-color);
}

.env-row input {
    font-size: 12.5px;
}

.env-key-warning {
    margin-top: 0.25rem;
    font-size: 11.5px;
    color: var(--bs-danger);
}

.env-del {
    flex: 0 0 auto;
}

.env-raw {
    font-size: 12px;
    color: var(--bs-secondary-color);
    padding: 0.1rem 0.25rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
