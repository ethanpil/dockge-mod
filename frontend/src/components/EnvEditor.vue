<template>
    <div class="env-editor">
        <div v-for="(entry, index) in entries" :key="index" class="env-entry">
            <!-- One pair takes two rows, so a long value has room -->
            <div v-if="entry.type === 'pair'" class="env-pair">
                <div class="env-row">
                    <span class="env-label">{{ $t("envKey") }}</span>
                    <input
                        v-model="entry.key"
                        type="text"
                        class="form-control form-control-sm"
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
                        class="form-control form-control-sm env-value"
                        autocomplete="off"
                        spellcheck="false"
                        @input="onEdit"
                    />
                </div>
            </div>

            <!-- A comment or an other line that is not a pair. The text
                 view can change it. -->
            <div v-else class="env-raw">{{ entry.text }}</div>
        </div>

        <button type="button" class="btn btn-sm btn-normal mt-2" @click="addEntry">
            <font-awesome-icon icon="plus" class="me-1" />
            {{ $t("addVariable") }}
        </button>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

/**
 * A .env editor with one key field and one value field for each
 * variable. The values are not masked. Lines that are not pairs, for
 * example comments, stay in their positions and do not change.
 *
 * The component does not interpret quotes. The value field holds the
 * exact text after the first "=", thus the file text stays the same
 * when the user changes nothing.
 */
export default {
    name: "EnvEditor",
    components: {
        FontAwesomeIcon,
    },

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

    methods: {
        /**
         * Divide the text into pairs and other lines.
         * @param {string} text the .env text
         * @returns {void}
         */
        parse(text) {
            this.lastSerialized = text;
            this.entries = [];

            if (!text) {
                return;
            }

            for (const line of text.split("\n")) {
                const match = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)=(.*)$/);
                if (match) {
                    this.entries.push({
                        type: "pair",
                        key: match[1],
                        value: match[2],
                    });
                } else {
                    this.entries.push({
                        type: "raw",
                        text: line,
                    });
                }
            }

            // The split gives one empty last line for a text with a final
            // newline. The serialization adds the newline back.
            const last = this.entries[this.entries.length - 1];
            if (last && last.type === "raw" && last.text === "") {
                this.entries.pop();
            }
        },

        /**
         * Make the .env text from the entries. A pair without a key gives
         * no line, because "=value" is not a correct line.
         * @returns {string} the .env text
         */
        serialize() {
            const lines = [];
            for (const entry of this.entries) {
                if (entry.type === "pair") {
                    if (entry.key.trim() !== "") {
                        lines.push(entry.key.trim() + "=" + entry.value);
                    }
                } else {
                    lines.push(entry.text);
                }
            }
            if (lines.length === 0) {
                return "";
            }
            return lines.join("\n") + "\n";
        },

        /**
         * Send the new text to the parent after an edit.
         * @returns {void}
         */
        onEdit() {
            const text = this.serialize();
            this.lastSerialized = text;
            this.$emit("update:modelValue", text);
            this.$emit("change");
        },

        /**
         * Add an empty pair at the end.
         * @returns {void}
         */
        addEntry() {
            this.entries.push({
                type: "pair",
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

.env-value,
.env-row input {
    font-family: "JetBrains Mono", monospace;
    font-size: 12.5px;
}

.env-del {
    flex: 0 0 auto;
}

.env-raw {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: var(--bs-secondary-color);
    padding: 0.1rem 0.25rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
