import { defineComponent } from "vue";

/**
 * The merged configuration overlay of the compose page. It shows the
 * output of `docker compose config`, or the error text of docker.
 *
 * The page owns expandedPanel and endpoint. It must end a request with
 * cancelMergedConfig when the overlay closes.
 */
export default defineComponent({
    data() {
        return {
            // State of the merged configuration overlay
            mergedConfigLoading: false,
            mergedConfigError: "",
            mergedConfigYAML: "",
            // The i18n key of the note in the overlay head. It names the
            // source of the content.
            mergedConfigNoteKey: "mergedConfigDiskNote",
        };
    },

    methods: {
        /**
         * End the wait for a merged configuration request. A late answer
         * of the request cannot write over a later request.
         * @returns {void}
         */
        cancelMergedConfig() {
            this.mergedConfigCancel?.();
            this.mergedConfigCancel = null;
            this.mergedConfigLoading = false;
        },

        /**
         * Open the merged configuration overlay and send a request for its
         * content. The overlay shows the error text of docker if the
         * configuration is not correct. A timer ends the wait if an agent
         * does not answer.
         * @param {string} noteKey i18n key of the note in the overlay head
         * @param {string} event name of the socket event
         * @param {...*} args arguments of the event
         * @returns {void}
         */
        openMergedConfig(noteKey, event, ...args) {
            this.cancelMergedConfig();
            this.expandedPanel = "merged";
            this.mergedConfigNoteKey = noteKey;
            this.mergedConfigLoading = true;
            this.mergedConfigError = "";
            this.mergedConfigYAML = "";

            this.mergedConfigCancel = this.$root.emitAgentWithTimeout(this.endpoint, event, args, 30000, (res) => {
                this.mergedConfigCancel = null;
                this.mergedConfigLoading = false;

                if (res.ok) {
                    this.mergedConfigYAML = res.composeConfig;
                    this.mergedConfigError = res.configError || "";
                } else if (res.timeout) {
                    this.mergedConfigError = this.$t(res.msg);
                } else {
                    // A protocol error, for example an expired login. This
                    // is not an error of the configuration, thus it also
                    // goes to the usual toast.
                    this.$root.toastRes(res);
                    this.mergedConfigError = res.msgi18n ? this.$t(res.msg) : (res.msg ?? "");
                }
            });
        },

        /**
         * Show the merged configuration of the files on the disk.
         * @returns {void}
         */
        showMergedConfig() {
            this.openMergedConfig("mergedConfigDiskNote", "getComposeConfig", this.stack.name);
        },
    },
});
