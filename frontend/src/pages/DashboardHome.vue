<template>
    <transition name="slide-fade" appear>
        <div v-if="$route.name === 'DashboardHome'">
            <div class="page-head">
                <h1 class="page-title">{{ $t("home") }}</h1>
                <!-- Windows sends no load average, but it still has a CPU count -->
                <span v-if="hostStats.load || hostStats.cpus" class="panel-note mono"><template v-if="hostStats.load">{{ $t("hostLoad", { load: hostStats.load }) }}</template><template v-if="hostStats.load && hostStats.cpus"> · </template><template v-if="hostStats.cpus">{{ $t("hostCpus", { n: hostStats.cpus }) }}</template></span>
            </div>

            <!-- Stat tiles -->
            <div class="tiles">
                <div class="tile">
                    <div class="tile-label">{{ $t("active") }}</div>
                    <div class="tile-value text-success">{{ activeNum }}</div>
                    <div class="tile-sub">{{ $tc("stacksCount", activeNum) }}</div>
                </div>
                <div class="tile">
                    <div class="tile-label">{{ $t("exited") }}</div>
                    <div class="tile-value" :class="exitedNum > 0 ? 'text-danger' : ''">{{ exitedNum }}</div>
                    <div class="tile-sub">{{ $tc("stacksCount", exitedNum) }}</div>
                </div>
                <div class="tile">
                    <div class="tile-label">{{ $t("inactive") }}</div>
                    <div class="tile-value text-secondary">{{ inactiveNum }}</div>
                    <div class="tile-sub">{{ $tc("stacksCount", inactiveNum) }}</div>
                </div>
                <div v-if="dfContainers" class="tile">
                    <div class="tile-label">{{ $tc("container", 2) }}</div>
                    <div class="tile-value">{{ dfContainers.Active }}<span class="tile-dim"> / {{ dfContainers.TotalCount }}</span></div>
                    <div class="tile-sub">{{ $t("runningTotal") }}</div>
                </div>
                <div v-if="hostStats.mem" class="tile">
                    <div class="tile-label">{{ $t("memory") }}</div>
                    <div class="tile-value">{{ formatBytes(hostStats.mem.used) }}<span class="tile-dim"> / {{ formatBytes(hostStats.mem.total) }}</span></div>
                    <div class="tile-meter">
                        <div class="tile-meter-fill" :class="memPercent > 85 ? 'bg-danger' : 'bg-success'" :style="{ width: memPercent + '%' }"></div>
                    </div>
                </div>
                <div v-if="dockerDiskTotal" class="tile">
                    <div class="tile-label">{{ $t("dockerDisk") }}</div>
                    <div class="tile-value">{{ dockerDiskTotal }}</div>
                    <div class="tile-sub">{{ $t("reclaimable") }} {{ dockerDiskReclaimable }}</div>
                </div>
                <div v-if="dfImages" class="tile">
                    <div class="tile-label">{{ $t("images") }}</div>
                    <div class="tile-value">{{ dfImages.TotalCount }}</div>
                    <div class="tile-sub">{{ dockerSize(dfImages.Size) }}</div>
                </div>
                <div v-if="dfVolumes" class="tile">
                    <div class="tile-label">{{ $tc("volume", 2) }}</div>
                    <div class="tile-value">{{ dfVolumes.TotalCount }}</div>
                    <div class="tile-sub">{{ dockerSize(dfVolumes.Size) }}</div>
                </div>
            </div>

            <div class="row gx-3 first-row">
                <!-- Left -->
                <div class="col-md-7">
                    <!-- Docker Run -->
                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ $t("Docker Run") }}</span>
                            <span class="panel-note">{{ $t("dockerRunNote") }}</span>
                        </div>
                        <div class="panel-body">
                            <textarea id="name" v-model="dockerRunCommand" type="text" class="form-control docker-run mb-3" required placeholder="docker run ..." :aria-label="$t('Docker Run')"></textarea>
                            <button class="btn-normal btn" @click="convertDockerRun">{{ $t("Convert to Compose") }}</button>
                        </div>
                    </div>
                </div>
                <!-- Right -->
                <div class="col-md-5">
                    <!-- Agent List -->
                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ $tc("dockgeAgent", 2) }}</span>
                            <span class="badge bg-warning-subtle text-warning-emphasis state-badge">beta</span>
                            <button v-if="!showAgentForm" class="mini-btn ms-auto" @click="showAgentForm = true">{{ $t("addAgent") }}</button>
                        </div>
                        <div>
                            <div v-for="(agentItem, endpoint) in $root.agentList" :key="endpoint" class="agent">
                                <span class="status-dot" :class="agentDotClass(endpoint)"></span>

                                <!-- Agent Display Name -->
                                <div class="agent-text">
                                    <span v-if="endpoint === ''" class="agent-title">{{ $t("currentEndpoint") }}</span>
                                    <template v-else>
                                        <span class="agent-title">{{ $root.endpointDisplayFunction(endpoint) }}</span>
                                        <span v-if="agentItem.name" class="agent-url mono">{{ endpoint }}</span>
                                    </template>
                                </div>

                                <!-- Agent Status -->
                                <span v-if="$root.agentStatusList[endpoint]" class="agent-status" :class="agentStatusClass(endpoint)">{{ agentStatusText(endpoint) }}</span>

                                <!-- Edit Name. An agent row has no name field when the database cannot store one. -->
                                <button v-if="endpoint !== '' && agentItem.name !== undefined" type="button" class="mini-btn" @click="showEditAgentName(agentItem)">
                                    {{ $t("editAgentName") }}
                                </button>

                                <!-- Remove Button -->
                                <button v-if="endpoint !== ''" type="button" class="mini-btn text-danger" @click="showRemoveAgent(agentItem.url)">
                                    {{ $t("remove") }}
                                </button>
                            </div>

                            <!-- Edit Dialog -->
                            <Confirm ref="editAgentNameDialog" :no-close-on-backdrop="true" :yes-text="$t('updateAgentName')" :no-text="$t('cancel')" @yes="updateName(editingAgent.url, editingAgent.updatedName)">
                                <template v-if="editingAgent">
                                    <label for="updatedName" class="form-label">{{ $t("agentName") }}</label>
                                    <input id="updatedName" v-model="editingAgent.updatedName" type="text" class="form-control" optional>
                                </template>
                            </Confirm>

                            <!-- Remove Agent Dialog -->
                            <Confirm ref="removeAgentDialog" btn-style="btn-danger" :yes-text="$t('removeAgent')" :no-text="$t('cancel')" @yes="removeAgent(removingAgentUrl)">
                                <p>{{ removingAgentUrl }}</p>
                                {{ $t("removeAgentMsg") }}
                            </Confirm>

                            <!-- Add Agent Form -->
                            <form v-if="showAgentForm" class="agent-form" @submit.prevent="addAgent">
                                <div class="mb-3">
                                    <label for="url" class="form-label">{{ $t("dockgeURL") }}</label>
                                    <input id="url" v-model="agent.url" type="url" class="form-control" required placeholder="http://">
                                </div>

                                <div class="mb-3">
                                    <label for="username" class="form-label">{{ $t("Username") }}</label>
                                    <input id="username" v-model="agent.username" type="text" class="form-control" required>
                                </div>

                                <div class="mb-3">
                                    <label for="password" class="form-label">{{ $t("Password") }}</label>
                                    <input id="password" v-model="agent.password" type="password" class="form-control" required autocomplete="new-password">
                                </div>

                                <div class="mb-3">
                                    <label for="name" class="form-label">{{ $t("agentName") }}</label>
                                    <input id="name" v-model="agent.name" type="text" class="form-control" optional>
                                </div>

                                <button type="submit" class="btn btn-primary me-2" :disabled="connectingAgent">
                                    <template v-if="connectingAgent">{{ $t("connecting") }}</template>
                                    <template v-else>{{ $t("connect") }}</template>
                                </button>
                                <button type="button" class="btn btn-normal" :disabled="connectingAgent" @click="showAgentForm = false">{{ $t("cancel") }}</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </transition>
    <router-view ref="child" />
</template>

<script>
import { statusNameShort } from "../../../common/util-common";
import { formatBytes, parseDockerSize } from "../util-frontend";
import Confirm from "../components/Confirm.vue";

export default {
    components: {
        Confirm,
    },
    props: {
        calculatedHeight: {
            type: Number,
            default: 0
        }
    },
    data() {
        return {
            dockerRunCommand: "",
            showAgentForm: false,
            editingAgent: null,
            removingAgentUrl: null,
            connectingAgent: false,
            agent: {
                url: "http://",
                username: "",
                password: "",
                name: "",
                updatedName: "",
            },
            hostStats: {},
            hostStatsTimer: null,
            // Set when the page is destroyed. A reply that comes after that
            // must not start the poll again on a page that is gone.
            stopHostStats: false,
        };
    },

    computed: {
        activeNum() {
            return this.getStatusNum("active");
        },
        inactiveNum() {
            return this.getStatusNum("inactive");
        },
        exitedNum() {
            return this.getStatusNum("exited");
        },

        dfContainers() {
            return this.dfRow("Containers");
        },
        dfImages() {
            return this.dfRow("Images");
        },
        dfVolumes() {
            return this.dfRow("Local Volumes");
        },

        memPercent() {
            if (!this.hostStats.mem?.total) {
                return 0;
            }
            return Math.round(this.hostStats.mem.used / this.hostStats.mem.total * 100);
        },

        /** Sum of every `docker system df` row: images, containers, volumes. */
        dockerDiskTotal() {
            if (!Array.isArray(this.hostStats.df) || this.hostStats.df.length === 0) {
                return "";
            }
            const bytes = this.hostStats.df.reduce((sum, row) => sum + parseDockerSize(row.Size), 0);
            return bytes > 0 ? formatBytes(bytes) : "";
        },

        dockerDiskReclaimable() {
            const bytes = (this.hostStats.df ?? []).reduce((sum, row) => sum + parseDockerSize((row.Reclaimable ?? "").split(" ")[0]), 0);
            return formatBytes(bytes);
        },
    },

    mounted() {
        // This component is the PARENT route of /compose/*, and the keyed
        // router-view remounts it on every navigation — without the guard,
        // every stack click would run a `docker system df` for tiles that
        // are not even rendered.
        if (this.$route.name === "DashboardHome") {
            this.requestHostStats();
        }
    },

    beforeUnmount() {
        this.stopHostStats = true;
        clearTimeout(this.hostStatsTimer);
    },

    methods: {
        formatBytes,

        /**
         * Show a docker size in the units the other tiles use. Docker prints
         * decimal units, and the tiles print binary units, so the total must
         * not look smaller than one of its parts.
         * @param {string} size size from `docker system df`
         * @returns {string} the same size in binary units
         */
        dockerSize(size) {
            return formatBytes(parseDockerSize(size));
        },

        /** Row of `docker system df` by type, or null when unavailable. */
        dfRow(type) {
            if (!Array.isArray(this.hostStats.df)) {
                return null;
            }
            return this.hostStats.df.find((row) => row.Type === type) ?? null;
        },

        /**
         * Poll host statistics for the tiles. The event goes to this
         * server, which always has it. A time limit keeps the poll alive
         * after a loss of the connection.
         * @returns {void}
         */
        requestHostStats() {
            this.$root.emitAgentWithTimeout("", "hostStats", [], 30000, (res) => {
                if (this.stopHostStats) {
                    return;
                }
                if (res.ok && res.hostStats) {
                    this.hostStats = res.hostStats;
                }
                // Re-arm only after the response, like the other polls in this
                // app. To re-arm when the request goes out lets slow responses
                // overlap and collect docker system df processes.
                clearTimeout(this.hostStatsTimer);
                this.hostStatsTimer = setTimeout(() => {
                    if (this.$route.name === "DashboardHome") {
                        this.requestHostStats();
                    }
                }, 15000);
            });
        },

        showEditAgentName(agentItem) {
            // Copy instead of referencing the live $root.agentList entry, which
            // is replaced wholesale on every "agentList" socket push.
            this.editingAgent = {
                url: agentItem.url,
                name: agentItem.name ?? "",
                // Prefill so confirming without typing keeps the current name
                updatedName: agentItem.name ?? "",
            };
            this.$refs.editAgentNameDialog.show();
        },

        showRemoveAgent(url) {
            this.removingAgentUrl = url;
            this.$refs.removeAgentDialog.show();
        },

        addAgent() {
            this.connectingAgent = true;
            this.$root.getSocket().emit("addAgent", this.agent, (res) => {
                this.$root.toastRes(res);

                if (res.ok) {
                    this.showAgentForm = false;
                    this.agent = {
                        url: "http://",
                        username: "",
                        password: "",
                        name: "",
                    };
                }

                this.connectingAgent = false;
            });
        },

        removeAgent(url) {
            this.$root.getSocket().emit("removeAgent", url, (res) => {
                if (res.ok) {
                    this.$root.toastRes(res);

                    let urlObj = new URL(url);
                    let endpoint = urlObj.host;

                    // Remove the stack list and status list of the removed agent
                    delete this.$root.allAgentStackList[endpoint];
                }
            });
        },

        updateName(url, updatedName) {
            this.$root.getSocket().emit("updateAgent", url, updatedName, (res) => {
                this.$root.toastRes(res);
            });
        },

        /**
         * The colour of the status dot of an agent.
         * @param {string} endpoint the agent endpoint
         * @returns {string} the class of the dot
         */
        agentDotClass(endpoint) {
            const status = this.$root.agentStatusList[endpoint];
            if (status === "online") {
                return "dot-success";
            }
            return status === "offline" ? "dot-danger" : "dot-secondary";
        },

        agentStatusClass(endpoint) {
            const status = this.$root.agentStatusList[endpoint];
            if (status === "online") {
                return "text-success";
            }
            return status === "offline" ? "text-danger" : "text-body-secondary";
        },

        agentStatusText(endpoint) {
            const status = this.$root.agentStatusList[endpoint];
            if (status === "online") {
                return this.$t("agentOnline");
            }
            return status === "offline" ? this.$t("agentOffline") : this.$t(status);
        },

        getStatusNum(statusName) {
            let num = 0;

            for (let stackName in this.$root.completeStackList) {
                const stack = this.$root.completeStackList[stackName];
                if (statusNameShort(stack.status) === statusName) {
                    num += 1;
                }
            }
            return num;
        },

        convertDockerRun() {
            if (this.dockerRunCommand.trim() === "docker run") {
                this.$root.toastError("Please enter a docker run command");
                return;
            }

            // composerize is working in dev, but after "vite build", it is not working
            // So pass to backend to do the conversion
            this.$root.getSocket().emit("composerize", this.dockerRunCommand, (res) => {
                if (res.ok) {
                    this.$root.composeTemplate = res.composeTemplate;
                    this.$router.push("/compose");
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
    }
};
</script>

<style lang="scss" scoped>
.page-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin-bottom: 1rem;
}

.page-title {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
}

.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.tile {
    min-width: 0;
    padding: 0.85rem 1rem;
    background-color: var(--app-surface);
    border: 1px solid var(--bs-border-color);
    border-radius: 8px;
}

.tile-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--bs-secondary-color);
}

.tile-value {
    font-size: 1.7rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tile-dim {
    color: var(--bs-secondary-color);
    font-size: 0.6em;
    font-weight: 500;
}

.tile-sub {
    font-size: 12px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tile-meter {
    height: 4px;
    border-radius: 2px;
    background-color: var(--bs-secondary-bg);
    margin-top: 0.5rem;
    overflow: hidden;
}

.tile-meter-fill {
    height: 100%;
    border-radius: 2px;
}

// .state-badge is global (main.scss)

.docker-run {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    min-height: 110px;
}

.agent {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0.4rem 1rem;

    + .agent {
        border-top: 1px solid var(--bs-border-color);
    }
}

.agent-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.agent-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
}

.agent-url {
    font-size: 12px;
    color: var(--bs-secondary-color);
}

.agent-status {
    font-size: 12px;
    font-weight: 600;
}

.agent-form {
    padding: 1rem;
    border-top: 1px solid var(--bs-border-color);
}
</style>
