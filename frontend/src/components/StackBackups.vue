<template>
    <!-- The backups of the stack files. A restore writes the files to the
         disk; the page then loads the stack again. -->
    <div class="panel pop">
        <div class="panel-head">
            <span class="panel-title">{{ $t("backups") }}</span>
            <span class="panel-note">{{ stackName }}</span>
            <button v-if="shown" class="mini-btn push-right" @click="shown = null">
                <font-awesome-icon icon="arrow-left" class="me-1" />{{ $t("backups") }}
            </button>
            <button class="mini-btn" :class="{ 'push-right': !shown }" :title="$t('close')" @click="$emit('close')">
                <font-awesome-icon icon="compress" />
            </button>
        </div>
        <div class="backups-body">
            <div v-if="loading" class="p-3">
                <font-awesome-icon icon="spinner" spin />
            </div>
            <div v-else-if="shown" class="backup-files">
                <template v-for="file in shownFiles" :key="file.name">
                    <div class="backup-file-name">{{ file.name }}</div>
                    <pre class="backup-file">{{ file.content }}</pre>
                </template>
            </div>
            <div v-else-if="backups.length === 0" class="p-3 text-body-secondary">{{ $t("noBackups") }}</div>
            <table v-else class="backup-table">
                <tbody>
                    <tr v-for="backup in backups" :key="backup.id">
                        <td class="mono">{{ formatTime(backup.createdAt) }}</td>
                        <td>{{ reasonText(backup.reason) }}</td>
                        <td class="backup-actions">
                            <button class="mini-btn me-1" :disabled="processing" @click="show(backup.id)">{{ $t("show") }}</button>
                            <button class="mini-btn" :disabled="processing" @click="askRestore(backup.id)">{{ $t("restore") }}</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Teleport to="body">
            <Confirm ref="confirmRestore" btn-style="btn-danger" :yes-text="$t('restore')" :no-text="$t('cancel')" @yes="restore">
                {{ $t("restoreBackupMsg") }}
            </Confirm>
        </Teleport>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import Confirm from "./Confirm.vue";
import dayjs from "dayjs";

export default {
    components: {
        FontAwesomeIcon,
        Confirm,
    },
    props: {
        endpoint: {
            type: String,
            required: true,
        },
        stackName: {
            type: String,
            required: true,
        },
        composeFileName: {
            type: String,
            default: "compose.yaml",
        },
        overrideFileName: {
            type: String,
            default: "compose.override.yaml",
        },
        /** True while the page runs an action */
        processing: {
            type: Boolean,
            default: false,
        },
    },
    emits: [
        "close",
        // the user confirmed a restore of this backup id. The page sends
        // it, because the panel can close while the restore runs.
        "restore",
    ],
    data() {
        return {
            // newest first
            backups: [],
            loading: true,
            // the backup that the panel shows, or null for the list
            shown: null,
            // the id that the restore dialog asks about
            toRestore: null,
            // cancel functions of the requests; unmount cancels them
            cancels: [],
        };
    },
    computed: {
        /**
         * The files of the backup on screen. A file that the backup does not
         * have is not in the list.
         * @returns {object[]} name and content of each file
         */
        shownFiles() {
            if (!this.shown) {
                return [];
            }
            return [
                {
                    name: this.composeFileName,
                    content: this.shown.composeYAML,
                },
                {
                    name: this.overrideFileName,
                    content: this.shown.composeOverrideYAML,
                },
                {
                    name: ".env",
                    content: this.shown.composeENV,
                },
            ].filter((file) => typeof file.content === "string");
        },
    },
    mounted() {
        this.request("getStackBackups", [ this.stackName ], (res) => {
            this.loading = false;
            if (res.ok) {
                this.backups = res.backups;
            } else {
                this.$root.toastRes(res);
            }
        });
    },
    unmounted() {
        this.cancels.forEach((cancel) => cancel());
    },
    methods: {
        /**
         * Send an event to the agent of the stack. No answer arrives after
         * the panel closes.
         * @param {string} event the socket event
         * @param {Array} args the arguments, without the callback
         * @param {Function} callback gets the answer or the timeout result
         * @returns {void}
         */
        request(event, args, callback) {
            this.cancels.push(this.$root.emitAgentWithTimeout(this.endpoint, event, args, 30000, callback));
        },

        show(id) {
            this.loading = true;
            this.request("getStackBackup", [ this.stackName, id ], (res) => {
                this.loading = false;
                if (res.ok) {
                    this.shown = res.backup;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Ask before a restore, because it overwrites the files on the disk.
         * @param {number} id the backup
         * @returns {void}
         */
        askRestore(id) {
            this.toRestore = id;
            this.$refs.confirmRestore.show();
        },

        restore() {
            const id = this.toRestore;
            this.toRestore = null;
            if (id !== null) {
                this.$emit("restore", id);
            }
        },

        formatTime(createdAt) {
            return dayjs(createdAt).format("YYYY-MM-DD HH:mm:ss");
        },

        /**
         * The text for a backup reason. An unknown reason shows as it is.
         * @param {string} reason for example "save"
         * @returns {string}
         */
        reasonText(reason) {
            const key = "backupReason_" + reason;
            return this.$te(key) ? this.$t(key) : reason;
        },
    },
};
</script>

<style scoped lang="scss">
.push-right {
    margin-left: auto;
}

.backups-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}

.backup-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;

    td {
        padding: 0.3rem 0.75rem;
        border-bottom: 1px solid var(--bs-border-color);
        vertical-align: middle;
    }

    .backup-actions {
        text-align: right;
        white-space: nowrap;
    }
}

.backup-files {
    padding: 0.75rem;
}

.backup-file-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--bs-secondary-color);
    margin-bottom: 0.25rem;
}

.backup-file {
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    font-size: 12px;
    background-color: var(--bs-tertiary-bg);
    border: 1px solid var(--bs-border-color);
    border-radius: 4px;
    white-space: pre-wrap;
}
</style>
