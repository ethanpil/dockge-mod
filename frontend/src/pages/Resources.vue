<template>
    <transition name="slide-fade" appear>
        <div>
            <div class="d-flex align-items-center gap-3 mb-3 flex-wrap">
                <h1 class="fs-3 mb-0">{{ $t("resources") }}</h1>
                <select v-if="$root.agentCount > 1" class="form-select w-auto" :value="endpoint" @change="changeEndpoint($event.target.value)">
                    <option v-for="(agent, agentEndpoint) in $root.agentList" :key="agentEndpoint" :value="agentEndpoint">
                        {{ (agent.name !== '') ? agent.name : agent.url || $t("Current") }}
                    </option>
                </select>
            </div>

            <!-- Images -->
            <div class="shadow-box section">
                <div class="section-head">
                    <span class="section-title">{{ $t("images") }}</span>
                    <button class="btn btn-normal btn-sm" type="button" :disabled="busy.images" @click="load('images')">
                        <font-awesome-icon :icon="busy.images ? 'spinner' : 'rotate'" :spin="busy.images" />
                    </button>
                    <button class="btn btn-normal btn-sm" type="button" :disabled="busy.images" @click="ask('prune', 'images')">
                        {{ $t("pruneDanglingImages") }}
                    </button>
                    <button class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.images" @click="ask('prune', 'images-all')">
                        {{ $t("pruneUnusedImages") }}
                    </button>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("image") }}</th>
                                <th>{{ $t("imageId") }}</th>
                                <th>{{ $t("size") }}</th>
                                <th>{{ $t("created") }}</th>
                                <th>{{ $t("inUse") }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="resources.images.length === 0">
                                <td colspan="6" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="img in resources.images" :key="img.ID + img.Repository + img.Tag">
                                <td>{{ img.Repository }}:{{ img.Tag }}</td>
                                <td><code>{{ shortId(img.ID) }}</code></td>
                                <td>{{ img.Size }}</td>
                                <td>{{ img.CreatedSince }}</td>
                                <td>
                                    <span class="badge use-badge" :class="useClass(img.inUse)">
                                        {{ useText(img.inUse) }}
                                    </span>
                                </td>
                                <td class="text-end">
                                    <button class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.images" @click="ask('remove', 'images', imageName(img))">
                                        {{ $t("remove") }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Volumes -->
            <div class="shadow-box section">
                <div class="section-head">
                    <span class="section-title">{{ $t("volumes") }}</span>
                    <button class="btn btn-normal btn-sm" type="button" :disabled="busy.volumes" @click="load('volumes')">
                        <font-awesome-icon :icon="busy.volumes ? 'spinner' : 'rotate'" :spin="busy.volumes" />
                    </button>
                    <button class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.volumes" @click="ask('prune', 'volumes')">
                        {{ $t("pruneAnonymousVolumes") }}
                    </button>
                </div>
                <div class="note mb-2">{{ $t("pruneVolumesNote") }}</div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("name") }}</th>
                                <th>{{ $t("driver") }}</th>
                                <th>{{ $t("inUse") }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="resources.volumes.length === 0">
                                <td colspan="4" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="vol in resources.volumes" :key="vol.Name">
                                <td>{{ vol.Name }}</td>
                                <td>{{ vol.Driver }}</td>
                                <td>
                                    <span class="badge use-badge" :class="useClass(vol.inUse)">
                                        {{ useText(vol.inUse) }}
                                    </span>
                                </td>
                                <td class="text-end">
                                    <!-- Docker refuses to remove a volume that
                                         a container uses -->
                                    <button v-if="vol.inUse === false" class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.volumes" @click="ask('remove', 'volumes', vol.Name)">
                                        {{ $t("remove") }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Networks -->
            <div class="shadow-box section">
                <div class="section-head">
                    <span class="section-title">{{ $t("networks") }}</span>
                    <button class="btn btn-normal btn-sm" type="button" :disabled="busy.networks" @click="load('networks')">
                        <font-awesome-icon :icon="busy.networks ? 'spinner' : 'rotate'" :spin="busy.networks" />
                    </button>
                    <button class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.networks" @click="ask('prune', 'networks')">
                        {{ $t("pruneUnusedNetworks") }}
                    </button>
                </div>
                <div class="note mb-2">{{ $t("pruneNetworksNote") }}</div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("name") }}</th>
                                <th>{{ $t("driver") }}</th>
                                <th>{{ $t("scope") }}</th>
                                <th>{{ $t("inUse") }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="resources.networks.length === 0">
                                <td colspan="5" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="net in resources.networks" :key="net.ID">
                                <td>{{ net.Name }}</td>
                                <td>{{ net.Driver }}</td>
                                <td>{{ net.Scope }}</td>
                                <td>
                                    <span class="badge use-badge" :class="useClass(net.inUse)">
                                        {{ useText(net.inUse) }}
                                    </span>
                                </td>
                                <td class="text-end">
                                    <!-- Docker refuses to remove a network of a
                                         container, and the networks of docker
                                         itself -->
                                    <button v-if="!isDefaultNetwork(net.Name) && net.inUse === false" class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.networks" @click="ask('remove', 'networks', net.Name)">
                                        {{ $t("remove") }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Image updates -->
            <div class="shadow-box section">
                <div class="section-head">
                    <span class="section-title">{{ $t("imageUpdates") }}</span>
                    <button class="btn btn-normal btn-sm" type="button" :disabled="busy.updates" @click="loadUpdates">
                        <font-awesome-icon :icon="busy.updates ? 'spinner' : 'rotate'" :spin="busy.updates" />
                    </button>
                    <button class="btn btn-primary btn-sm" type="button" :disabled="busy.updates || checkBusy" @click="checkNow">
                        <font-awesome-icon v-if="checkBusy" icon="spinner" spin class="me-1" />
                        {{ $t("checkNow") }}
                    </button>
                    <span v-if="checkRunning" class="note">{{ $t("checkProgress", { n: progress.checked, m: progress.total }) }}</span>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("image") }}</th>
                                <th>{{ $t("status") }}</th>
                                <th>{{ $t("lastChecked") }}</th>
                                <th>{{ $t("error") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="imageUpdates.length === 0">
                                <td colspan="4" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="row in imageUpdates" :key="row.image">
                                <td>{{ row.image }}</td>
                                <td>
                                    <span class="badge" :class="row.updateAvailable ? 'bg-warning text-dark' : 'bg-success'">
                                        {{ row.updateAvailable ? $t("updateAvailable") : $t("upToDate") }}
                                    </span>
                                </td>
                                <td>
                                    {{ formatTime(row.checkedAt) }}
                                    <!-- An image that failed waits longer for
                                         its next check -->
                                    <div v-if="hasNextCheck(row)" class="note">{{ $t("nextCheck", { t: formatTime(row.nextCheck) }) }}</div>
                                </td>
                                <td class="text-danger">{{ row.error }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <Confirm
                ref="confirm" btn-style="btn-danger" :busy="confirmBusy" no-on-dismiss
                :yes-text="$t('yes')" :no-text="$t('cancel')" @yes="run" @no="dialogOpen = false"
            >
                <span v-if="pending && pending.action === 'remove'">{{ $t("removeResourceMsg", [ pending.name ]) }}</span>
                <template v-else-if="pending">
                    <p id="plan-title">{{ $t("pruneWillRemove", { n: pending.candidates.length }) }}</p>
                    <!-- The list can scroll. A keyboard needs the focus in it. -->
                    <ul class="plan-list" tabindex="0" role="group" aria-labelledby="plan-title">
                        <!-- Two rows of docker images can hold the same ID,
                             thus the position gives the key -->
                        <li v-for="(item, index) in pending.candidates" :key="index">
                            {{ item.name }}
                            <span v-if="item.detail" class="note">({{ item.detail }})</span>
                        </li>
                    </ul>
                    <p v-if="pending.kept > 0" class="note mb-0">{{ $t("pruneKept", { n: pending.kept }) }}</p>
                </template>
            </Confirm>
        </div>
    </transition>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import dayjs from "dayjs";
import Confirm from "../components/Confirm.vue";

const KINDS = [ "images", "volumes", "networks" ];
const DEFAULT_NETWORKS = [ "bridge", "host", "none" ];

export default {
    components: {
        FontAwesomeIcon,
        Confirm,
    },

    data() {
        return {
            resources: {
                images: [],
                volumes: [],
                networks: [],
            },
            imageUpdates: [],
            busy: {
                images: false,
                volumes: false,
                networks: false,
                updates: false,
            },
            checking: false,
            // The action that waits for the answer of the confirm dialog
            pending: null,
            // True while the dialog is on screen. A plan that arrives late
            // must not change the question that the user reads.
            dialogOpen: false,
            // True while the action of the dialog runs
            confirmBusy: false,
        };
    },

    computed: {
        endpoint() {
            return this.$route.params.endpoint || "";
        },

        /** The state of the check that the server sends */
        progress() {
            return this.$root.imageUpdateProgressOf(this.endpoint);
        },

        /** True while a check runs on the server */
        checkRunning() {
            return this.progress.running;
        },

        /** True while this page waits for a check, or a check runs */
        checkBusy() {
            return this.checking || this.checkRunning;
        },
    },

    watch: {
        endpoint() {
            // The check of the host before this one is not the check of
            // this host, thus the button becomes usable again
            this.checking = false;
            // The plan belongs to the host before this one. A removal
            // must not go to a different host.
            this.closeDialog();
            this.loadAll();
        },

        // The check ended. The rows load one time, and the button
        // becomes usable again.
        checkRunning(running) {
            if (running) {
                return;
            }
            this.checking = false;
            this.loadUpdates();
        },

        // A check that gives no progress event, for example on an older
        // agent, must not keep the button closed
        checking(value) {
            clearTimeout(this.checkTimer);
            if (value) {
                this.checkTimer = setTimeout(() => {
                    this.checking = false;
                }, 120000);
            }
        },
    },

    mounted() {
        this.loadAll();
    },

    unmounted() {
        // The requests that wait must stay quiet after the page is gone
        this.cancels.forEach((cancel) => cancel());
        clearTimeout(this.checkTimer);
    },

    created() {
        // The cancel functions of the requests that wait for an answer
        this.cancels = [];
    },

    methods: {
        /**
         * Send an event to the agent of this page. The answer is for the
         * agent that the page showed at the time of the request. An answer
         * for a different agent is ignored, because the page changed in
         * the interval.
         * @param {string} event event name
         * @param {Array} args arguments before the callback
         * @param {Function} cb gets the answer, or a timeout result
         * @returns {void}
         */
        request(event, args, cb) {
            const endpoint = this.endpoint;
            const cancel = this.$root.emitAgentWithTimeout(endpoint, event, args, 30000, (res) => {
                this.cancels = this.cancels.filter((c) => c !== cancel);
                if (endpoint !== this.endpoint) {
                    return;
                }
                cb(res);
            });
            this.cancels.push(cancel);
        },

        /**
         * Go to the page of a different agent.
         * @param {string} endpoint the agent endpoint
         * @returns {void}
         */
        changeEndpoint(endpoint) {
            this.$router.push(endpoint ? `/resources/${endpoint}` : "/resources");
        },

        /**
         * Get all lists from the agent.
         * @returns {void}
         */
        loadAll() {
            KINDS.forEach((kind) => this.load(kind));
            this.loadUpdates();
        },

        /**
         * Get one list from the agent.
         * @param {string} kind images, volumes, or networks
         * @returns {void}
         */
        load(kind) {
            this.busy[kind] = true;
            this.request("getDockerResources", [ kind ], (res) => {
                this.busy[kind] = false;
                if (res.ok) {
                    this.resources[kind] = res.resources;
                } else {
                    this.resources[kind] = [];
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Get the image update rows from the agent.
         * @returns {void}
         */
        loadUpdates() {
            this.busy.updates = true;
            this.request("getImageUpdates", [], (res) => {
                this.busy.updates = false;
                if (res.ok) {
                    this.imageUpdates = res.imageUpdates;
                } else {
                    this.imageUpdates = [];
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Start a check on the agent. The check runs in the background.
         * The progress events show the count, and the watch loads the rows
         * again at the end of the check.
         * @returns {void}
         */
        checkNow() {
            this.checking = true;
            this.request("checkImageUpdates", [], (res) => {
                if (!res.ok) {
                    this.checking = false;
                    this.$root.toastRes(res);
                    return;
                }
                // A check that already runs gives started false. The rows
                // load now, thus the page shows the last result of the
                // check that runs.
                if (res.started === false) {
                    this.checking = false;
                    this.$root.toastRes({
                        ok: true,
                        msg: "checkInProgress",
                        msgi18n: true,
                    });
                    this.loadUpdates();
                }
            });
        },

        /**
         * Open the confirm dialog for a remove or a prune.
         * @param {string} action remove or prune
         * @param {string} kind the resource kind, or the prune kind
         * @param {string} [name] the resource name, for a remove
         * @returns {void}
         */
        ask(action, kind, name) {
            if (action === "prune") {
                this.askPrune(kind);
                return;
            }
            this.pending = { action,
                kind,
                name };
            this.showDialog();
        },

        /**
         * Get the plan of a prune, then show it in the confirm dialog. The
         * user reads the full list of the items before the prune runs.
         * @param {string} kind images, images-all, volumes, or networks
         * @returns {void}
         */
        askPrune(kind) {
            const listKind = this.listKindOf(kind);
            const endpoint = this.endpoint;
            this.busy[listKind] = true;
            this.request("getPrunePlan", [ kind ], (res) => {
                this.busy[listKind] = false;
                // The user went to a different host, or a dialog is
                // already on screen. A new question here would change
                // the text above the buttons that the user reads.
                if (this.endpoint !== endpoint || this.dialogOpen) {
                    return;
                }
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                // An empty plan needs no question
                if (res.candidates.length === 0) {
                    this.$root.toastRes({
                        ok: true,
                        msg: "pruneNothingToRemove",
                        msgi18n: true,
                    });
                    return;
                }
                this.pending = { action: "prune",
                    kind,
                    candidates: res.candidates,
                    kept: res.kept };
                this.showDialog();
            });
        },

        /**
         * Show the confirm dialog for the action in pending.
         * @returns {void}
         */
        showDialog() {
            this.dialogOpen = true;
            this.confirmBusy = false;
            this.$refs.confirm.show();
        },

        /**
         * Close the dialog and forget its action. A change of the host
         * needs this, because the plan belongs to the host before it.
         * @returns {void}
         */
        closeDialog() {
            if (this.dialogOpen) {
                this.$refs.confirm?.hide();
            }
            this.dialogOpen = false;
            this.confirmBusy = false;
            this.pending = null;
        },

        /**
         * Run the action that the user confirmed, then load the list again.
         *
         * The data of the dialog stays. The dialog is still on screen while
         * it closes, and it must keep its text to the end of the animation.
         * @returns {void}
         */
        run() {
            // The buttons stay on screen while the dialog closes. A
            // second press must not send the action again.
            if (this.confirmBusy || !this.pending) {
                return;
            }
            this.confirmBusy = true;
            this.dialogOpen = false;

            const { action, kind, name, candidates } = this.pending;
            const listKind = this.listKindOf(kind);
            this.busy[listKind] = true;

            if (action === "remove") {
                this.request("removeDockerResource", [ kind, name ], (res) => {
                    this.busy[listKind] = false;
                    this.confirmBusy = false;
                    this.$root.toastRes(res);
                    this.load(listKind);
                });
                return;
            }

            // The server removes only the items of this list. An item
            // that became busy after the plan stays for the next time.
            const accepted = candidates.map((item) => item.id);
            this.request("pruneDockerResources", [ kind, accepted ], (res) => {
                this.busy[listKind] = false;
                this.confirmBusy = false;
                if (res.ok) {
                    this.reportPrune(res);
                } else {
                    this.$root.toastRes(res);
                }
                this.load(listKind);
            });
        },

        /**
         * Tell the user what the prune removed, and what stayed after an
         * error.
         * @param {object} res the answer of pruneDockerResources
         * @returns {void}
         */
        reportPrune(res) {
            const removed = res.removed ? res.removed.length : 0;
            const failed = res.failed ? res.failed.length : 0;
            this.$root.toastRes({
                ok: true,
                msg: { key: "pruneRemoved",
                    values: { n: removed } },
                msgi18n: true,
            });
            if (failed > 0) {
                this.$root.toastRes({
                    ok: false,
                    msg: { key: "pruneFailed",
                        values: { n: failed } },
                    msgi18n: true,
                });
            }
            // A container can take an item between the plan and the
            // removal. The server keeps such an item.
            if (res.skipped > 0) {
                this.$root.toastRes({
                    ok: true,
                    msg: { key: "pruneSkipped",
                        values: { n: res.skipped } },
                    msgi18n: true,
                });
            }
        },

        /**
         * The colour of the badge that shows if a container uses a row.
         * @param {boolean|undefined} inUse the field of the row
         * @returns {string} the class of the badge
         */
        useClass(inUse) {
            if (inUse === undefined) {
                return "bg-warning";
            }
            return inUse ? "bg-success" : "bg-secondary";
        },

        /**
         * The text of that badge. An older agent sends no answer for
         * this field, and the page must not say that the row is free.
         * @param {boolean|undefined} inUse the field of the row
         * @returns {string} the text of the badge
         */
        useText(inUse) {
            if (inUse === undefined) {
                return this.$t("inUseUnknown");
            }
            return inUse ? this.$t("inUseYes") : this.$t("inUseNo");
        },

        /**
         * The list that an action changes.
         * @param {string} kind a resource kind, or a prune kind
         * @returns {string} images, volumes, or networks
         */
        listKindOf(kind) {
            // The prune kind "images-all" belongs to the images list
            return kind === "images-all" ? "images" : kind;
        },

        /**
         * The name that docker accepts for an image.
         * @param {object} img an image row
         * @returns {string} repository:tag, or the ID when the tag is none
         */
        imageName(img) {
            if (img.Tag === "<none>" || img.Repository === "<none>") {
                return img.ID;
            }
            return `${img.Repository}:${img.Tag}`;
        },

        /**
         * The short form of an ID.
         * @param {string} id a docker ID, with or without the sha256 prefix
         * @returns {string} the first 12 characters of the hash
         */
        shortId(id) {
            return (id || "").replace("sha256:", "").substring(0, 12);
        },

        /**
         * True for the networks that docker makes and that you cannot remove.
         * @param {string} name the network name
         * @returns {boolean}
         */
        isDefaultNetwork(name) {
            return DEFAULT_NETWORKS.includes(name);
        },

        /**
         * True when the agent keeps the row for a check at a later time.
         * @param {object} row an image update row
         * @returns {boolean}
         */
        hasNextCheck(row) {
            if (!row.nextCheck) {
                return false;
            }
            return new Date(row.nextCheck).getTime() > Date.now();
        },

        /**
         * A readable time, in the same format as the compose page.
         * @param {string|number} value a date string or a timestamp
         * @returns {string} the time, or an empty string
         */
        formatTime(value) {
            if (!value) {
                return "";
            }
            return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
        },
    },
};
</script>

<style scoped>
.section {
    margin-bottom: 1rem;
}

.section-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
}

.section-title {
    font-weight: 600;
    font-size: 1.1rem;
    margin-right: auto;
}

.note {
    font-size: 0.9em;
    color: var(--bs-secondary-color);
}

td, th {
    overflow-wrap: anywhere;
}

/* A long plan must not make the dialog longer than the screen */
.plan-list {
    max-height: 40vh;
    overflow-y: auto;
    padding-left: 1.2rem;
    margin-bottom: 0.5rem;
    overflow-wrap: anywhere;
}

.use-badge {
    font-weight: 500;
    white-space: nowrap;
}
</style>
