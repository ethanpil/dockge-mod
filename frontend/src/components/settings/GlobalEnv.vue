<template>
    <div>
        <div v-if="settingsLoaded" class="my-3">
            <form class="my-3" autocomplete="off" @submit.prevent="saveGeneral">
                <div class="mb-2">
                    <button type="button" class="mini-btn" @click="envEditorText = !envEditorText">
                        {{ envEditorText ? $t("envRowsView") : $t("envTextView") }}
                    </button>
                </div>

                <div v-if="envEditorText" class="shadow-box mb-3 editor-box edit-mode">
                    <code-mirror
                        ref="editor"
                        v-model="settings.globalENV"
                        :extensions="extensionsEnv"
                        minimal
                        wrap="true"
                        dark="true"
                        tab="true"
                        :hasFocus="editorFocus"
                        @change="onChange"
                    />
                </div>
                <div v-else class="shadow-box mb-3">
                    <EnvEditor v-model="settings.globalENV" />
                </div>

                <div class="my-3">
                    <!-- Save Button -->
                    <div>
                        <button class="btn btn-primary" type="submit">
                            {{ $t("Save") }}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </div>
</template>

<script>
import CodeMirror from "vue-codemirror6";
import { python } from "@codemirror/lang-python"; // good enough for .env key=value highlighting
import { dracula as editorTheme } from "thememirror";
import { lineNumbers, EditorView } from "@codemirror/view";
import { ref } from "vue";
import EnvEditor from "../EnvEditor.vue";

export default {
    name: "GlobalEnv",
    components: {
        CodeMirror,
        EnvEditor,
    },

    setup() {
        const editorFocus = ref(false);

        const focusEffectHandler = (state, focusing) => {
            editorFocus.value = focusing;
            return null;
        };

        const extensionsEnv = [
            editorTheme,
            python(),
            lineNumbers(),
            EditorView.focusChangeEffect.of(focusEffectHandler),
        ];

        return { editorFocus,
            extensionsEnv };
    },

    data() {
        return {
            // True shows the text editor, false shows the rows
            envEditorText: false,
        };
    },

    computed: {
        settings() {
            return this.$parent.$parent.$parent.settings;
        },
        saveSettings() {
            return this.$parent.$parent.$parent.saveSettings;
        },
        settingsLoaded() {
            return this.$parent.$parent.$parent.settingsLoaded;
        },
    },

    methods: {
        /** Save the settings */
        saveGeneral() {
            this.saveSettings();
        },

        onChange() {
            // hook for future live validation if desired
        },
    },
};
</script>

<style scoped>
/* Keep the editor's original breathing room after the global .shadow-box
   padding was tightened for the stack page's density. */
.shadow-box {
    padding: 0.75rem;
}
</style>

