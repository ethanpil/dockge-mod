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
import { isEnvKey, parseEnvFile, serializeEnvFile } from "../env-file";

let nextEntryId = 1;

/**
 * A .env editor with one key field and one value field for each
 * variable. The values are not masked. Lines that are not pairs, for
 * example comments, stay in their positions and do not change.
 *
 * The component does not interpret quotes. The value field holds the
 * exact text after the first "=". The line ends and the last line of
 * the file stay as they are, so the file text stays the same when the
 * user changes nothing. The parse and the serialization are in
 * env-file.ts, thus a test can examine them without this component.
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
            return isEnvKey(entry.key);
        },

        /**
         * Divide the text into pairs and other lines.
         * @param {string} text the .env text
         * @returns {void}
         */
        parse(text) {
            text = text ?? "";
            this.lastSerialized = text;
            const file = parseEnvFile(text);
            this.eol = file.eol;
            this.finalNewline = file.finalNewline;
            this.entries = file.entries.map((entry) => ({
                id: nextEntryId++,
                ...entry,
            }));
        },

        /**
         * Make the .env text from the entries. The row of a pair with a
         * bad key shows a message, thus the user can see why the variable
         * is not in the file yet.
         * @returns {string} the .env text
         */
        serialize() {
            return serializeEnvFile({
                entries: this.entries,
                eol: this.eol,
                finalNewline: this.finalNewline,
            });
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
