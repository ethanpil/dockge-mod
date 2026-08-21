<template>
    <div class="shadow-box mb-3" :style="boxStyle">
        <div class="list-header">
            <div class="header-top">
                <button
                    class="btn btn-sm btn-outline-secondary me-2" :class="{ 'active': selectMode }" type="button" :disabled="bulkRunning"
                    @click="selectMode = !selectMode"
                >
                    {{ $t("select") }}
                </button>

                <div class="search-wrapper">
                    <a v-if="searchText == ''" class="search-icon">
                        <font-awesome-icon icon="search" />
                    </a>
                    <a v-if="searchText != ''" class="search-icon" style="cursor: pointer" @click="clearSearchText">
                        <font-awesome-icon icon="times" />
                    </a>
                    <form>
                        <input v-model="searchText" class="form-control form-control-sm search-input" autocomplete="off" />
                    </form>
                </div>
            </div>

            <!-- The status filter and the search text apply together -->
            <div class="header-filter">
                <label class="filter-label" for="stackStatusFilter">{{ $t("filterStatus") }}</label>
                <select id="stackStatusFilter" v-model="filterState.status" class="form-select form-select-sm filter-select">
                    <option :value="null">{{ $t("filterAll") }}</option>
                    <option value="active">{{ $t("active") }}</option>
                    <option value="exited">{{ $t("exited") }}</option>
                    <option value="inactive">{{ $t("inactive") }}</option>
                </select>
            </div>

            <!-- Bulk actions. The backend has one event for one stack, thus
                 the actions run one stack after the other. -->
            <div v-if="selectMode" class="selection-controls">
                <div class="selection-row">
                    <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="bulkRunning" @click="selectVisible">{{ $t("selectAll") }}</button>
                    <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="bulkRunning || selectedStackCount === 0" @click="selectedStacks = {}">{{ $t("clear") }}</button>
                    <span v-if="bulkRunning" class="selection-note">
                        <font-awesome-icon icon="spinner" spin class="me-1" />{{ $t("bulkProgress", { n: bulkDone, m: bulkTotal }) }}
                    </span>
                    <span v-else class="selection-note">{{ $t("selectedStackCount", [ selectedStackCount ]) }}</span>
                </div>
                <div class="selection-row">
                    <button class="btn btn-sm btn-primary" type="button" :disabled="bulkDisabled" @click="runBulk('startStack')">
                        <font-awesome-icon icon="play" class="me-1" />{{ $t("startStack") }}
                    </button>
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="runBulk('stopStack')">
                        <font-awesome-icon icon="stop" class="me-1" />{{ $t("stopStack") }}
                    </button>
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="runBulk('restartStack')">
                        <font-awesome-icon icon="rotate" class="me-1" />{{ $t("restartStack") }}
                    </button>
                    <button class="btn btn-sm btn-normal" type="button" :disabled="bulkDisabled" @click="runBulk('updateStack')">
                        <font-awesome-icon icon="cloud-arrow-down" class="me-1" />{{ $t("updateStack") }}
                    </button>
                </div>
            </div>
        </div>
        <div ref="stackList" class="stack-list" :class="{ scrollbar: scrollbar }" :style="stackListStyle">
            <div v-if="agentStackList[0] && agentStackList[0].stacks.length === 0" class="text-center mt-3">
                <router-link to="/compose">{{ $t("addFirstStackMsg") }}</router-link>
            </div>
            <div v-for="(agent, agentIndex) in agentStackList" :key="agentIndex" class="stack-list-inner">
                <div
                    v-if="$root.agentCount > 1" class="p-2 agent-select"
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
    </div>
</template>

<script>
import StackListItem from "../components/StackListItem.vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { CREATED_FILE, CREATED_STACK, EXITED, RUNNING, UNKNOWN, statusNameShort } from "../../../common/util-common";

export default {
    components: {
        StackListItem,
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
            windowTop: 0,
            filterState: {
                status: null,
                active: null,
                tags: null,
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

                // filter by active
                let activeMatch = true;
                if (this.filterState.active != null && this.filterState.active.length > 0) {
                    activeMatch = this.filterState.active.includes(stack.active);
                }

                // filter by tags
                let tagsMatch = true;
                if (this.filterState.tags != null && this.filterState.tags.length > 0) {
                    tagsMatch = stack.tags.map(tag => tag.tag_id) // convert to array of tag IDs
                        .filter(stackTagId => this.filterState.tags.includes(stackTagId)) // perform Array Intersaction between filter and stack's tags
                        .length > 0;
                }

                return searchTextMatch && statusMatch && activeMatch && tagsMatch;
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

        stackListStyle() {
            //let listHeaderHeight = 107;
            let listHeaderHeight = 48;

            // The filter row
            listHeaderHeight += 36;

            if (this.selectMode) {
                listHeaderHeight += 74;
            }

            return {
                "height": `calc(100% - ${listHeaderHeight}px)`
            };
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
            return this.filterState.status != null || this.filterState.active != null || this.filterState.tags != null || this.searchText !== "";
        }
    },
    watch: {
        selectMode() {
            if (!this.selectMode) {
                this.selectedStacks = {};
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
            if (window.top.scrollY <= 133) {
                this.windowTop = window.top.scrollY;
            } else {
                this.windowTop = 133;
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
.shadow-box {
    height: calc(100vh - 150px);
    position: sticky;
    top: 10px;
    // ~10% smaller than the body size; inherited by the rows and the header.
    font-size: 0.9rem;
}

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.list-header {
    background-color: var(--bs-tertiary-bg);
    border-bottom: 1px solid var(--bs-border-color);
    border-radius: calc(var(--bs-border-radius) - 1px) calc(var(--bs-border-radius) - 1px) 0 0;
    // Cancels the .shadow-box padding so the header spans the full box width.
    margin: -0.25rem;
    margin-bottom: 0.5rem;
    padding: 0.4rem 0.5rem;
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.header-filter {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
}

.filter-label {
    font-size: 11px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
}

.filter-select {
    font-size: 12px;
    padding-top: 0.15rem;
    padding-bottom: 0.15rem;
}

.search-wrapper {
    display: flex;
    align-items: center;
    // Fill the header rather than sitting at its right edge.
    flex: 1 1 auto;
    min-width: 0;

    form {
        flex: 1 1 auto;
        min-width: 0;
    }
}

.search-icon {
    padding: 0 8px 0 2px;
    color: var(--bs-secondary-color);

    // Clear filter button (X)
    svg[data-icon="times"] {
        cursor: pointer;

        &:hover {
            opacity: 0.5;
        }
    }
}

.search-input {
    width: 100%;
}

.stack-item {
    width: 100%;
}

.tags {
    margin-top: 4px;
    padding-left: 67px;
    display: flex;
    flex-wrap: wrap;
    gap: 0;
}

.bottom-style {
    padding-left: 67px;
    margin-top: 5px;
}

.selection-controls {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;

    .btn {
        padding: 0.1rem 0.45rem;
        font-size: 11.5px;
    }
}

.selection-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem;
}

.selection-note {
    font-size: 11.5px;
    color: var(--bs-secondary-color);
    margin-left: auto;
    white-space: nowrap;
}

.agent-select {
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--bs-secondary-color);
    padding-left: 10px;
    padding-right: 10px;
    display: flex;
    align-items: center;
    user-select: none;
}
</style>
