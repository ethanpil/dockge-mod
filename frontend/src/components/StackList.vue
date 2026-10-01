<template>
    <div class="shadow-box stack-box mb-3" :style="boxStyle">
        <div class="list-header">
            <div class="header-top">
                <div class="search-wrapper">
                    <font-awesome-icon v-if="searchText == ''" icon="search" class="search-icon" />
                    <button v-else type="button" class="search-icon search-clear" :aria-label="$t('clear')" @click="clearSearchText">
                        <font-awesome-icon icon="times" />
                    </button>
                    <input v-model="searchText" class="search-input" autocomplete="off" :placeholder="$t('searchStacks')" :aria-label="$t('searchStacks')" />
                </div>

                <button
                    class="btn btn-sm btn-normal" :class="{ 'active': selectMode }" type="button" :disabled="bulkRunning"
                    @click="selectMode = !selectMode"
                >
                    {{ $t("select") }}
                </button>
            </div>

            <!-- The status filter and the search text apply together -->
            <div class="header-filter" role="group" :aria-label="$t('filterStatus')">
                <button
                    v-for="option in statusOptions" :key="option.value ?? 'all'" type="button" class="chip"
                    :class="{ active: filterState.status === option.value }" :aria-pressed="filterState.status === option.value"
                    @click="filterState.status = option.value"
                >
                    {{ option.label }} <span class="chip-count">{{ option.count }}</span>
                </button>
            </div>

            <!-- Bulk actions. The backend has one event for one stack, thus
                 the actions run one stack after the other. -->
            <div v-if="selectMode" class="selection-controls">
                <div class="selection-row">
                    <span v-if="bulkRunning" class="selection-note">
                        <font-awesome-icon icon="spinner" spin class="me-1" />{{ $t("bulkProgress", { n: bulkDone, m: bulkTotal }) }}
                    </span>
                    <span v-else class="selection-note">{{ $t("selectedStackCount", [ selectedStackCount ]) }}</span>
                    <button class="link-btn" type="button" :disabled="bulkRunning" @click="selectVisible">{{ $t("selectAll") }}</button>
                    <button class="link-btn" type="button" :disabled="bulkRunning || selectedStackCount === 0" @click="selectedStacks = {}">{{ $t("clear") }}</button>
                </div>
                <div class="selection-grid">
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="runBulk('startStack')">
                        <font-awesome-icon icon="play" class="me-1" />{{ $t("startStack") }}
                    </button>
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="askBulk('stopStack')">
                        <font-awesome-icon icon="stop" class="me-1" />{{ $t("stopStack") }}
                    </button>
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="askBulk('restartStack')">
                        <font-awesome-icon icon="rotate" class="me-1" />{{ $t("restartStack") }}
                    </button>
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="askBulk('updateStack')">
                        <font-awesome-icon icon="cloud-arrow-down" class="me-1" />{{ $t("updateStack") }}
                    </button>
                </div>
            </div>
        </div>
        <div ref="stackList" class="stack-list" :class="{ scrollbar: scrollbar }">
            <div v-if="agentStackList.length === 0" class="text-center my-3">
                <span v-if="filtersActive" class="text-body-secondary">{{ $t("noStackMatch") }}</span>
                <router-link v-else to="/compose">{{ $t("addFirstStackMsg") }}</router-link>
            </div>
            <div v-for="(agent, agentIndex) in agentStackList" :key="agentIndex" class="stack-list-inner">
                <div
                    v-if="$root.agentCount > 1" class="agent-select"
                    @click="closedAgents.set(agent.endpoint, !closedAgents.get(agent.endpoint))"
                >
                    <span class="me-1">
                        <font-awesome-icon v-show="closedAgents.get(agent.endpoint)" icon="chevron-circle-right" />
                        <font-awesome-icon v-show="!closedAgents.get(agent.endpoint)" icon="chevron-circle-down" />
                    </span>
                    <span v-if="agent.endpoint === 'current'">{{ $t("currentEndpoint") }}</span>
                    <span v-else>{{ agent.endpoint }}</span>
                </div>
                <StackListItem
                    v-for="(item, index) in agent.stacks"
                    v-show="$root.agentCount === 1 || !closedAgents.get(agent.endpoint)" :key="index" :stack="item" :isSelectMode="selectMode"
                    :isSelected="isSelected" :select="select" :deselect="deselect"
                />
            </div>
        </div>

        <!-- The list box is sticky, which would put the dialog under the
             backdrop of Bootstrap, so the dialog goes to the body -->
        <Teleport to="body">
            <Confirm ref="confirmBulk" btn-style="btn-danger" :yes-text="pendingBulkLabel" :no-text="$t('cancel')" @yes="runBulk(pendingBulk)">
                {{ $t("bulkConfirmMsg", { action: pendingBulkLabel, n: selectedStackCount }) }}
            </Confirm>
        </Teleport>
    </div>
</template>

<script>
import StackListItem from "../components/StackListItem.vue";
import Confirm from "../components/Confirm.vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { CREATED_FILE, CREATED_STACK, EXITED, RUNNING, UNKNOWN, statusNameShort } from "../../../common/util-common";

export default {
    components: {
        StackListItem,
        Confirm,
        FontAwesomeIcon,
    },
    props: {
        /** Should the scrollbar be shown */
        scrollbar: {
            type: Boolean,
        },
    },
    data() {
        return {
            searchText: "",
            selectMode: false,
            // The selected stacks, by the key of completeStackList
            selectedStacks: {},
            // True while a bulk action runs. The count shows the progress.
            bulkRunning: false,
            bulkDone: 0,
            bulkTotal: 0,
            // The bulk action that waits for the confirm dialog
            pendingBulk: null,
            windowTop: 0,
            filterState: {
                status: null,
            },
            closedAgents: new Map(),
        };
    },
    computed: {
        /**
         * Improve the sticky appearance of the list by increasing its
         * height as user scrolls down.
         * Not used on mobile.
         * @returns {object} Style for stack list
         */
        boxStyle() {
            if (window.innerWidth > 550) {
                return {
                    height: `calc(100vh - 160px + ${this.windowTop}px)`,
                };
            } else {
                return {
                    height: "calc(100vh - 160px)",
                };
            }

        },

        /**
         * Returns a sorted list of stacks based on the applied filters and search text.
         * @returns {Array} The sorted list of stacks.
         */
        agentStackList() {
            let result = Object.values(this.$root.completeStackList);

            result = result.filter(stack => {
                // filter by search text
                // finds stack name, tag name or tag value
                let searchTextMatch = true;
                if (this.searchText !== "") {
                    const loweredSearchText = this.searchText.toLowerCase();
                    searchTextMatch =
                        stack.name.toLowerCase().includes(loweredSearchText)
                        || stack.tags.find(tag => tag.name.toLowerCase().includes(loweredSearchText)
                            || tag.value?.toLowerCase().includes(loweredSearchText));
                }

                // filter by status. The names are the same as the status
                // dot uses, thus "inactive" covers both created states.
                let statusMatch = true;
                if (this.filterState.status != null) {
                    statusMatch = statusNameShort(stack.status) === this.filterState.status;
                }

                return searchTextMatch && statusMatch;
            });

            result.sort((m1, m2) => {

                // sort by managed by dockge
                if (m1.isManagedByDockge && !m2.isManagedByDockge) {
                    return -1;
                } else if (!m1.isManagedByDockge && m2.isManagedByDockge) {
                    return 1;
                }

                // sort by status
                if (m1.status !== m2.status) {
                    if (m2.status === RUNNING) {
                        return 1;
                    } else if (m1.status === RUNNING) {
                        return -1;
                    } else if (m2.status === EXITED) {
                        return 1;
                    } else if (m1.status === EXITED) {
                        return -1;
                    } else if (m2.status === CREATED_STACK) {
                        return 1;
                    } else if (m1.status === CREATED_STACK) {
                        return -1;
                    } else if (m2.status === CREATED_FILE) {
                        return 1;
                    } else if (m1.status === CREATED_FILE) {
                        return -1;
                    } else if (m2.status === UNKNOWN) {
                        return 1;
                    } else if (m1.status === UNKNOWN) {
                        return -1;
                    }
                }
                return m1.name.localeCompare(m2.name);
            });

            // Group stacks by endpoint, sorting them so the local endpoint is first
            // and the rest are sorted alphabetically
            result = [
                ...result.reduce((acc, stack) => {
                    const endpoint = stack.endpoint || "current";
                    if (!acc.has(endpoint)) {
                        acc.set(endpoint, []);
                    }
                    acc.get(endpoint).push(stack);
                    return acc;
                }, new Map()).entries()
            ].map(([ endpoint, stacks ]) => ({
                endpoint,
                stacks
            })).sort((a, b) => {
                if (a.endpoint === "current" && b.endpoint !== "current") {
                    return -1;
                } else if (a.endpoint !== "current" && b.endpoint === "current") {
                    return 1;
                }
                return a.endpoint.localeCompare(b.endpoint);
            });

            return result;
        },

        /**
         * The status filter buttons, each with the count of its stacks.
         * @returns {object[]} value, label and count of each button
         */
        statusOptions() {
            const counts = {
                active: 0,
                exited: 0,
                inactive: 0,
            };
            const stacks = Object.values(this.$root.completeStackList);
            for (const stack of stacks) {
                const name = statusNameShort(stack.status);
                if (name in counts) {
                    counts[name]++;
                }
            }
            return [
                {
                    value: null,
                    label: this.$t("filterAll"),
                    count: stacks.length,
                },
                ...Object.keys(counts).map((name) => ({
                    value: name,
                    label: this.$t(name),
                    count: counts[name],
                })),
            ];
        },

        selectedStackCount() {
            return Object.keys(this.selectedStacks).length;
        },

        bulkDisabled() {
            return this.bulkRunning || this.selectedStackCount === 0;
        },

        /**
         * Determines if any filters are active.
         * @returns {boolean} True if any filter is active, false otherwise.
         */
        filtersActive() {
            return this.filterState.status != null || this.searchText !== "";
        },

        pendingBulkLabel() {
            return this.pendingBulk ? this.$t(this.pendingBulk) : "";
        },
    },
    watch: {
        selectMode() {
            if (!this.selectMode) {
                this.selectedStacks = {};
            }
        },

        /**
         * A stack that is no longer in the list leaves the selection. A
         * bulk action then does not run for a stack that was deleted.
         * @returns {void}
         */
        "$root.completeStackList"(list) {
            for (const key of Object.keys(this.selectedStacks)) {
                if (!(key in list)) {
                    delete this.selectedStacks[key];
                }
            }
        },
    },
    mounted() {
        window.addEventListener("scroll", this.onScroll);
    },
    beforeUnmount() {
        window.removeEventListener("scroll", this.onScroll);
    },
    methods: {
        /**
         * Handle user scroll
         * @returns {void}
         */
        onScroll() {
            if (window.top.scrollY <= 110) {
                this.windowTop = window.top.scrollY;
            } else {
                this.windowTop = 110;
            }
        },

        /**
         * Clear the search bar
         * @returns {void}
         */
        clearSearchText() {
            this.searchText = "";
        },
        /**
         * Deselect a stack
         * @param {string} id key of the stack in completeStackList
         * @returns {void}
         */
        deselect(id) {
            delete this.selectedStacks[id];
        },
        /**
         * Select a stack
         * @param {string} id key of the stack in completeStackList
         * @returns {void}
         */
        select(id) {
            this.selectedStacks[id] = true;
        },
        /**
         * Determine if stack is selected
         * @param {string} id key of the stack in completeStackList
         * @returns {bool} Is the stack selected?
         */
        isSelected(id) {
            return id in this.selectedStacks;
        },
        /**
         * Select the stacks that the filter shows. A stack that is not
         * managed by dockge has no actions, thus it is not selected.
         * @returns {void}
         */
        selectVisible() {
            for (const agent of this.agentStackList) {
                for (const stack of agent.stacks) {
                    if (stack.isManagedByDockge) {
                        this.select(stack.name + "_" + (stack.endpoint || ""));
                    }
                }
            }
        },
        /**
         * Run one stack event for each selected stack, one after the
         * other. A failure shows a toast and the run continues with the
         * next stack.
         * @param {string} event startStack, stopStack, restartStack or updateStack
         * @returns {Promise<void>}
         */
        /**
         * Ask before a bulk action that stops or recreates containers.
         * @param {string} event the socket event of the action
         * @returns {void}
         */
        askBulk(event) {
            this.pendingBulk = event;
            this.$refs.confirmBulk.show();
        },

        async runBulk(event) {
            const keys = Object.keys(this.selectedStacks);
            if (this.bulkRunning || keys.length === 0) {
                return;
            }

            this.bulkRunning = true;
            this.bulkDone = 0;
            this.bulkTotal = keys.length;

            for (const key of keys) {
                const stack = this.$root.completeStackList[key];
                if (stack) {
                    const res = await new Promise((resolve) => {
                        this.$root.emitAgentWithTimeout(stack.endpoint || "", event, [ stack.name ], 300000, resolve);
                    });
                    if (!res.ok) {
                        const msg = res.msgi18n ? this.$t(res.msg) : res.msg;
                        this.$root.toastError(stack.name + ": " + msg);
                    }
                }
                this.bulkDone++;
            }

            this.bulkRunning = false;
        },
    },
};
</script>

<style lang="scss" scoped>
.stack-box {
    height: calc(100vh - 150px);
    position: sticky;
    top: 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
}

.list-header {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--bs-border-color);
}

.stack-list {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0.5rem;
}

.header-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.search-wrapper {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1 1 auto;
    min-width: 0;
    height: 31px;
    padding: 0 0.6rem;
    border: 1px solid var(--bs-border-color);
    border-radius: 6px;
    background-color: var(--app-input-bg);

    &:focus-within {
        border-color: var(--bs-primary);
    }
}

.search-icon {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--bs-secondary-color);
}

.search-clear {
    padding: 0;
    border: 0;
    background: transparent;

    &:hover {
        color: var(--bs-body-color);
    }
}

.search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--bs-body-color);
    font-size: 13px;
}

.header-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.chip {
    height: 26px;
    padding: 0 0.6rem;
    border: 1px solid var(--bs-border-color);
    border-radius: 13px;
    background: transparent;
    color: var(--bs-secondary-color);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;

    &:hover {
        color: var(--bs-body-color);
    }

    &.active {
        color: var(--bs-primary-text-emphasis);
        background-color: var(--bs-primary-bg-subtle);
        border-color: var(--bs-primary-border-subtle);
    }
}

.chip-count {
    font-variant-numeric: tabular-nums;
}

.selection-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--bs-border-color);
}

.selection-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.selection-note {
    font-size: 12px;
    font-weight: 600;
    margin-right: auto;
    white-space: nowrap;
}

.link-btn {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--bs-link-color);
    font-size: 12px;

    &:disabled {
        color: var(--bs-secondary-color);
    }
}

.selection-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
}

.agent-select {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--bs-secondary-color);
    padding: 0.4rem 0.6rem;
    display: flex;
    align-items: center;
    user-select: none;
}

@media (max-width: 767.98px) {
    .stack-box {
        position: static;
        height: auto !important;
        max-height: 50vh;
    }
}
</style>
