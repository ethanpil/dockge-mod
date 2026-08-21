<template>
    <transition name="slide-fade" appear>
        <div v-if="$route.name === 'DashboardHome'">
            <!-- Stat tiles -->
            <div class="panel">
                <div class="panel-head">
                    <span class="panel-title">{{ $t("home") }}</span>
                    <!-- Windows sends no load average, but it still has a CPU count -->
                    <span v-if="hostStats.load || hostStats.cpus" class="panel-note mono"><template v-if="hostStats.load">load {{ hostStats.load }}</template><template v-if="hostStats.load && hostStats.cpus"> · </template><template v-if="hostStats.cpus">{{ hostStats.cpus }} cpu</template></span>
                </div>
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
            </div>

            <div class="row gx-2 first-row">
                <!-- Left -->
                <div class="col-md-7">
                    <!-- Docker Run -->
                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ $t("Docker Run") }}</span>
                            <span class="panel-note">{{ $t("Convert to Compose") }}</span>
                        </div>
                        <div class="panel-body">
                            <textarea id="name" v-model="dockerRunCommand" type="text" class="form-control form-control-sm docker-run mb-2" required placeholder="docker run ..."></textarea>
                            <button class="btn-normal btn btn-sm" @click="convertDockerRun">{{ $t("Convert to Compose") }}</button>
                        </div>
                    </div>
                </div>
                <!-- Right -->
                <div class="col-md-5">
                    <!-- Agent List -->
                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ $tc("dockgeAgent", 2) }}</span>
                            <span class="badge bg-warning state-badge">beta</span>
                        </div>
                        <div class="panel-body">
                            <div v-for="(agentItem, endpoint) in $root.agentList" :key="endpoint" class="mb-3 agent">
                                <!-- Agent Status -->
                                <template v-if="$root.agentStatusList[endpoint]">
                                    <span v-if="$root.agentStatusList[endpoint] === 'online'" class="badge bg-primary me-2">{{ $t("agentOnline") }}</span>
                                    <span v-else-if="$root.agentStatusList[endpoint] === 'offline'" class="badge bg-danger me-2">{{ $t("agentOffline") }}</span>
                                    <span v-else class="badge bg-secondary me-2">{{ $t($root.agentStatusList[endpoint]) }}</span>
                                </template>

                                <!-- Agent Display Name -->
                                <template v-if="$root.agentStatusList[endpoint]">
                                    <span v-if="endpoint === '' && agentItem.name === ''" class="badge bg-secondary me-2">Current</span>
                                    <span v-else-if="agentItem.name === ''" :href="agentItem.url" class="me-2">{{ endpoint }}</span>
                                    <span v-else :href="agentItem.url" class="me-2">{{ agentItem.name }}</span>
                                </template>

                                <!-- Edit Name  -->
                                <font-awesome-icon v-if="agentItem.name !== ''" class="action" icon="pen-to-square" @click="showEditAgentName(agentItem)" />

                                <!-- Remove Button -->
                                <font-awesome-icon v-if="endpoint !== ''" class="ms-2 action text-danger remove-agent" icon="trash" @click="showRemoveAgent(agentItem.url)" />
                            </div>

                            <!-- Edit Dialog -->
                            <Confirm ref="editAgentNameDialog" :no-close-on-backdrop="true" :yes-text="$t('Update Name')" :no-text="$t('cancel')" @yes="updateName(editingAgent.url, editingAgent.updatedName)">
                                <template v-if="editingAgent">
                                    <label for="updatedName" class="form-label">Current value: {{ $t(editingAgent.name) }}</label>
                                    <input id="updatedName" v-model="editingAgent.updatedName" type="text" class="form-control" optional>
                                </template>
                            </Confirm>

                            <!-- Remove Agent Dialog -->
                            <Confirm ref="removeAgentDialog" btn-style="btn-danger" :yes-text="$t('removeAgent')" :no-text="$t('cancel')" @yes="removeAgent(removingAgentUrl)">
                                <p>{{ removingAgentUrl }}</p>
                                {{ $t("removeAgentMsg") }}
                            </Confirm>

                            <button v-if="!showAgentForm" class="btn btn-normal btn-sm" @click="showAgentForm = !showAgentForm">{{ $t("addAgent") }}</button>

                            <!-- Add Agent Form -->
                            <form v-if="showAgentForm" @submit.prevent="addAgent">
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
                                    <label for="name" class="form-label">{{ $t("Friendly Name") }}</label>
                                    <input id="name" v-model="agent.name" type="text" class="form-control" optional>
                                </div>

                                <button type="submit" class="btn btn-primary" :disabled="connectingAgent">
                                    <template v-if="connectingAgent">{{ $t("connecting") }}</template>
                                    <template v-else>{{ $t("connect") }}</template>
                                </button>
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
         * Poll host statistics for the tiles. The event only exists on
         * dockge-mod backends; an upstream agent never answers, the callback
         * never fires and the extra tiles simply stay hidden.
         * @returns {void}
         */
        requestHostStats() {
            this.$root.emitAgent("", "hostStats", (res) => {
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
                name: agentItem.name,
                // Prefill so confirming without typing keeps the current name
                updatedName: agentItem.name,
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
.tiles {
    display: flex;
    flex-wrap: wrap;
    border-radius: 0 0 4px 4px;
    overflow: hidden;
    // Pushes the last column's divider outside the clip, so it does not
    // double up with the panel border.
    margin-right: -1px;
}

.tile {
    flex: 1 1 160px;
    min-width: 150px;
    padding: 0.5rem 0.6rem;
    border-right: 1px solid var(--bs-border-color);
    // Row dividers: every tile draws a top border; the first row's one is
    // pulled up under the panel head's bottom border.
    border-top: 1px solid var(--bs-border-color);
    margin-top: -1px;
}

.tile-label {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--bs-secondary-color);
}

.tile-value {
    font-size: 1.15rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tile-dim {
    color: var(--bs-secondary-color);
    font-size: 0.85em;
    font-weight: 500;
}

.tile-sub {
    font-size: 11px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tile-meter {
    height: 4px;
    border-radius: 2px;
    background-color: var(--bs-secondary-bg);
    margin-top: 0.4rem;
    overflow: hidden;
}

.tile-meter-fill {
    height: 100%;
    border-radius: 2px;
}

// .state-badge is global (main.scss)

.docker-run {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
}

.remove-agent {
    cursor: pointer;
}

.agent {
    a {
        text-decoration: none;
    }
}
</style>
