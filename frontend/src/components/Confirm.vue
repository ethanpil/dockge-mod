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
                    <button type="button" class="btn" :class="btnStyle" data-bs-dismiss="modal" @click="yes">
                        {{ yesText }}
                    </button>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" @click="no">
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
    },
    emits: [ "yes", "no" ],
    data: () => ({
        modal: null,
    }),
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    beforeUnmount() {
        if (!this.modal) {
            return;
        }

        // The backdrop and body scroll-lock live on <body>, so they must be
        // torn down here; dispose() also frees Bootstrap's per-element
        // instance registry, which would otherwise leak on every unmount.
        if (this.$refs.modal.classList.contains("show")) {
            this.$refs.modal.addEventListener("hidden.bs.modal", () => this.modal.dispose(), { once: true });
            this.modal.hide();
        } else {
            this.modal.dispose();
        }
    },
    methods: {
        /**
         * Show the confirm dialog
         * @returns {void}
         */
        show() {
            this.modal.show();
        },
        /**
         * @fires string "yes" Notify the parent when Yes is pressed
         * @returns {void}
         */
        yes() {
            this.$emit("yes");
        },
        /**
         * @fires string "no" Notify the parent when No is pressed
         * @returns {void}
         */
        no() {
            this.$emit("no");
        }
    },
};
</script>
