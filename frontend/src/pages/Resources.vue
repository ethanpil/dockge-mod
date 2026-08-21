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
                        {{ $t("pruneDangling") }}
                    </button>
                    <button class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.images" @click="ask('prune', 'images-all')">
                        {{ $t("pruneUnused") }}
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
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="resources.images.length === 0">
                                <td colspan="5" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="img in resources.images" :key="img.ID + img.Repository + img.Tag">
                                <td>{{ img.Repository }}:{{ img.Tag }}</td>
                                <td><code>{{ shortId(img.ID) }}</code></td>
                                <td>{{ img.Size }}</td>
                                <td>{{ img.CreatedSince }}</td>
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
                        {{ $t("pruneUnused") }}
                    </button>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("name") }}</th>
                                <th>{{ $t("driver") }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="resources.volumes.length === 0">
                                <td colspan="3" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="vol in resources.volumes" :key="vol.Name">
                                <td>{{ vol.Name }}</td>
                                <td>{{ vol.Driver }}</td>
                                <td class="text-end">
                                    <button class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.volumes" @click="ask('remove', 'volumes', vol.Name)">
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
                        {{ $t("pruneUnused") }}
                    </button>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("name") }}</th>
                                <th>{{ $t("driver") }}</th>
                                <th>{{ $t("scope") }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="resources.networks.length === 0">
                                <td colspan="4" class="note">{{ $t("noResources") }}</td>
                            </tr>
                            <tr v-for="net in resources.networks" :key="net.ID">
                                <td>{{ net.Name }}</td>
                                <td>{{ net.Driver }}</td>
                                <td>{{ net.Scope }}</td>
                                <td class="text-end">
                                    <button v-if="!isDefaultNetwork(net.Name)" class="btn btn-outline-danger btn-sm" type="button" :disabled="busy.networks" @click="ask('remove', 'networks', net.Name)">
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
                    <button class="btn btn-primary btn-sm" type="button" :disabled="busy.updates || checking" @click="checkNow">
                        <font-awesome-icon v-if="checking" icon="spinner" spin class="me-1" />
                        {{ $t("checkNow") }}
                    </button>
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
                                <td>{{ formatTime(row.checkedAt) }}</td>
                                <td class="text-danger">{{ row.error }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <Confirm ref="confirm" btn-style="btn-danger" :yes-text="$t('yes')" :no-text="$t('cancel')" @yes="run">
                <span v-if="pending && pending.action === 'remove'">{{ $t("removeResourceMsg", [ pending.name ]) }}</span>
                <span v-else>{{ $t("pruneResourceMsg") }}</span>
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
        };
    },

    computed: {
        endpoint() {
            return this.$route.params.endpoint || "";
        },
    },

    watch: {
        endpoint() {
            this.loadAll();
        },
    },

    mounted() {
        this.loadAll();
    },

    unmounted() {
        // The requests that wait must stay quiet after the page is gone
        this.cancels.forEach((cancel) => cancel());
        this.timers.forEach((t) => clearTimeout(t));
    },

    created() {
        // Timers of the check that reload the page later
        this.timers = [];
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
         * Start a check on the agent. The check runs in the background, so
         * the rows load again after a short time and after a longer time.
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
                // A check that already runs gives started false. The page
                // then only loads the rows again, and the button stays
                // usable.
                if (res.started === false) {
                    this.checking = false;
                    this.$root.toastRes({
                        ok: true,
                        msg: "checkInProgress",
                        msgi18n: true,
                    });
                    this.timers.push(setTimeout(() => this.loadUpdates(), 3000));
                    this.timers.push(setTimeout(() => this.loadUpdates(), 30000));
                    return;
                }
                this.timers.push(setTimeout(() => this.loadUpdates(), 3000));
                this.timers.push(setTimeout(() => {
                    this.checking = false;
                    this.loadUpdates();
                }, 30000));
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
            this.pending = { action,
                kind,
                name };
            this.$refs.confirm.show();
        },

        /**
         * Run the action that the user confirmed, then load the list again.
         * @returns {void}
         */
        run() {
            const { action, kind, name } = this.pending;
            this.pending = null;
            // The prune kind "images-all" belongs to the images list
            const listKind = kind === "images-all" ? "images" : kind;
            this.busy[listKind] = true;

            const args = action === "remove" ? [ kind, name ] : [ kind ];
            const event = action === "remove" ? "removeDockerResource" : "pruneDockerResources";
            this.request(event, args, (res) => {
                this.busy[listKind] = false;
                this.$root.toastRes(res);
                this.load(listKind);
            });
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
</style>
