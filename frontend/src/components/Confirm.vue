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
                    <button type="button" class="btn" :class="btnStyle" :disabled="busy" @click="yes">
                        {{ yesText }}
                    </button>
                    <button v-if="altText" type="button" class="btn" :class="altStyle" :disabled="busy" @click="alt">
                        {{ altText }}
                    </button>
                    <button type="button" class="btn btn-secondary" :disabled="busy" @click="no">
                        {{ noText }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";

// The backdrop and the body scroll lock are global. Count the dialogs that
// are open, so that only the last dialog to close removes them.
let openCount = 0;

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
        /**
         * Keep the dialog on screen after a button is pressed. The parent
         * then calls hide() when its action is complete. Use this with busy
         * to show the user that the action runs.
         */
        keepOpen: {
            type: Boolean,
            default: false,
        },
    },
    emits: [ "yes", "no", "alt" ],
    data: () => ({
        modal: null,
        answered: false,
        isOpen: false,
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
        const wasOpen = this.isOpen;
        this.markClosed();

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
        // Another dialog can still be open, and it needs them.
        if (wasOpen && openCount === 0) {
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
            if (!this.isOpen) {
                this.isOpen = true;
                openCount++;
            }
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
            this.answer("yes");
        },
        /**
         * @fires string "no" Notify the parent when No is pressed
         * @returns {void}
         */
        no() {
            this.answer("no");
        },
        /**
         * @fires string "alt" Notify the parent when the third button is pressed
         * @returns {void}
         */
        alt() {
            this.answer("alt");
        },
        /**
         * Report the answer, and close the dialog unless the parent keeps it.
         * @param {string} event the event to send to the parent
         * @returns {void}
         */
        answer(event) {
            this.answered = true;
            this.$emit(event);
            if (!this.keepOpen) {
                this.modal?.hide();
            }
        },
        /**
         * Escape, the backdrop, and the X button close the dialog without an
         * answer. Report that as "no" if the parent asked for it.
         *
         * The flag clears here and not in show(). A dialog that opens again
         * during the close animation must not make this callback, which is
         * still to run, send an answer the user did not give.
         * @returns {void}
         */
        onHidden() {
            this.markClosed();
            if (!this.answered && this.noOnDismiss) {
                this.$emit("no");
            }
            this.answered = false;
        },
        /**
         * Record that this dialog is no longer open.
         * @returns {void}
         */
        markClosed() {
            if (this.isOpen) {
                this.isOpen = false;
                openCount--;
            }
        },
    },
};
</script>
