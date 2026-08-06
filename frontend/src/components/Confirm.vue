<template>
    <div ref="modal" class="modal fade" tabindex="-1" :data-bs-backdrop="noCloseOnBackdrop ? 'static' : true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="exampleModalLabel" class="modal-title">
                        {{ title || $t("Confirm") }}
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
                </div>
                <div class="modal-body">
                    <slot />
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn" :class="btnStyle" :disabled="busy" data-bs-dismiss="modal" @click="yes">
                        {{ yesText }}
                    </button>
                    <button v-if="altText" type="button" class="btn" :class="altStyle" :disabled="busy" data-bs-dismiss="modal" @click="alt">
                        {{ altText }}
                    </button>
                    <button type="button" class="btn btn-secondary" :disabled="busy" data-bs-dismiss="modal" @click="no">
                        {{ noText }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";

export default {
    props: {
        /** Style of button */
        btnStyle: {
            type: String,
            default: "btn-primary",
        },
        /** Text to use as yes */
        yesText: {
            type: String,
            default: "Yes",     // TODO: No idea what to translate this
        },
        /** Text to use as no */
        noText: {
            type: String,
            default: "No",
        },
        /** Title to show on modal. Defaults to translated version of "Config" */
        title: {
            type: String,
            default: null,
        },
        /** Prevent closing the dialog by clicking the backdrop */
        noCloseOnBackdrop: {
            type: Boolean,
            default: false,
        },
        /** Text of an optional third button. The button is hidden if empty. */
        altText: {
            type: String,
            default: null,
        },
        /** Style of the optional third button */
        altStyle: {
            type: String,
            default: "btn-outline-danger",
        },
        /**
         * Emit "no" when the user closes the dialog with Escape, the
         * backdrop, or the X button. A dialog that holds a pending action
         * needs this, because it must always get an answer.
         */
        noOnDismiss: {
            type: Boolean,
            default: false,
        },
        /** Disable all buttons, for example while an action runs */
        busy: {
            type: Boolean,
            default: false,
        },
    },
    emits: [ "yes", "no", "alt" ],
    data: () => ({
        modal: null,
        answered: false,
    }),
    mounted() {
        this.modal = new Modal(this.$refs.modal);
        this.$refs.modal.addEventListener("hidden.bs.modal", this.onHidden);
    },
    beforeUnmount() {
        const el = this.$refs.modal;
        el?.removeEventListener("hidden.bs.modal", this.onHidden);

        if (!this.modal) {
            return;
        }

        // A dialog can unmount while it is open, or while it closes. An
        // example is an action that removes the item which holds the dialog.
        const modal = this.modal;
        this.modal = null;
        const wasOpen = el?.classList.contains("show") || document.body.classList.contains("modal-open");

        if (wasOpen) {
            modal.hide();
        }

        // Bootstrap can have a close in progress. That callback runs later
        // and needs the instance, because dispose() clears its element.
        // Thus release the instance after the animation time.
        setTimeout(() => {
            try {
                modal.dispose();
            } catch (e) {
                // The element is already gone. Nothing more to release.
            }
        }, 500);

        // The backdrop and the scroll lock are on <body>. They stay if
        // bootstrap cannot complete its own teardown on a removed element.
        if (wasOpen) {
            document.querySelectorAll(".modal-backdrop").forEach((backdrop) => backdrop.remove());
            document.body.classList.remove("modal-open");
            document.body.style.removeProperty("overflow");
            document.body.style.removeProperty("padding-right");
        }
    },
    methods: {
        /**
         * Show the confirm dialog
         * @returns {void}
         */
        show() {
            this.answered = false;
            this.modal.show();
        },
        /**
         * Close the dialog from the parent, for example after an action ends.
         * @returns {void}
         */
        hide() {
            this.answered = true;
            this.modal?.hide();
        },
        /**
         * @fires string "yes" Notify the parent when Yes is pressed
         * @returns {void}
         */
        yes() {
            this.answered = true;
            this.$emit("yes");
        },
        /**
         * @fires string "no" Notify the parent when No is pressed
         * @returns {void}
         */
        no() {
            this.answered = true;
            this.$emit("no");
        },
        /**
         * @fires string "alt" Notify the parent when the third button is pressed
         * @returns {void}
         */
        alt() {
            this.answered = true;
            this.$emit("alt");
        },
        /**
         * Escape, the backdrop, and the X button close the dialog without an
         * answer. Report that as "no" if the parent asked for it.
         * @returns {void}
         */
        onHidden() {
            if (!this.answered && this.noOnDismiss) {
                this.answered = true;
                this.$emit("no");
            }
        }
    },
};
</script>
