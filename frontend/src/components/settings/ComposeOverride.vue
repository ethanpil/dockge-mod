<template>
    <div>
        <div v-if="settingsLoaded" class="my-3">
            <p class="note">{{ $t("composeOverrideTemplateNote") }}</p>

            <form class="my-3" autocomplete="off" @submit.prevent="saveGeneral">
                <div class="shadow-box mb-3 editor-box edit-mode">
                    <code-mirror
                        v-model="settings.composeOverrideTemplate"
                        :extensions="extensions"
                        minimal
                        wrap="true"
                        dark="true"
                        tab="true"
                        :hasFocus="editorFocus"
                    />
                </div>

                <div class="my-3">
                    <button class="btn btn-primary me-2" type="submit">
                        {{ $t("Save") }}
                    </button>
                    <button class="btn btn-normal" type="button" @click="restoreDefault">
                        {{ $t("restoreDefault") }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>

<script>
import CodeMirror from "vue-codemirror6";
import { yaml } from "@codemirror/lang-yaml";
import { dracula as editorTheme } from "thememirror";
import { lineNumbers, EditorView } from "@codemirror/view";
import { ref } from "vue";
import { defaultComposeOverrideTemplate } from "../../../../common/util-common";

export default {
    name: "ComposeOverride",
    components: {
        CodeMirror,
    },

    setup() {
        const editorFocus = ref(false);

        const focusEffectHandler = (state, focusing) => {
            editorFocus.value = focusing;
            return null;
        };

        const extensions = [
            editorTheme,
            yaml(),
            lineNumbers(),
            EditorView.focusChangeEffect.of(focusEffectHandler),
        ];

        return { editorFocus,
            extensions };
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

        /** Put the default text in the editor */
        restoreDefault() {
            this.settings.composeOverrideTemplate = defaultComposeOverrideTemplate;
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

.note {
    font-size: 0.9em;
    color: var(--bs-secondary-color);
}
</style>
