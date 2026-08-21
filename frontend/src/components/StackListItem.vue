<template>
    <router-link :to="url" :class="{ 'dim' : !stack.isManagedByDockge, 'active': isSelectMode && isSelected(selectKey) }" class="item" :title="stackName" @click.capture="onClick">
        <!-- In select mode a click on the row changes the selection, and
             the link does not open. The capture listener runs before the
             navigate handler of the link, which stops on a prevented
             event. -->
        <input v-if="isSelectMode" type="checkbox" class="form-check-input select-box me-2" :checked="isSelected(selectKey)" :disabled="!stack.isManagedByDockge" tabindex="-1" />
        <Uptime :stack="stack" :dot="true" class="me-2" />
        <div class="title">
            <span>{{ stackName }}</span>
        </div>
        <!-- An agent of upstream dockge does not send imageUpdates -->
        <span v-if="stack.imageUpdates > 0" class="update-badge" :title="$t('updateAvailableCount', { n: stack.imageUpdates })" role="img" :aria-label="$t('updateAvailableCount', { n: stack.imageUpdates })">
            <font-awesome-icon icon="arrow-up" />
        </span>
    </router-link>
</template>

<script>
import Uptime from "./Uptime.vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

export default {
    components: {
        Uptime,
        FontAwesomeIcon,
    },
    props: {
        /** Stack this represents */
        stack: {
            type: Object,
            default: null,
        },
        /** If the user is in select mode */
        isSelectMode: {
            type: Boolean,
            default: false,
        },
        /** How many ancestors are above this stack */
        depth: {
            type: Number,
            default: 0,
        },
        /** Callback to determine if stack is selected */
        isSelected: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is selected */
        select: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is deselected */
        deselect: {
            type: Function,
            default: () => {}
        },
    },
    data() {
        return {
            isCollapsed: true,
        };
    },
    computed: {
        endpointDisplay() {
            return this.$root.endpointDisplayFunction(this.stack.endpoint);
        },
        url() {
            if (this.stack.endpoint) {
                return `/compose/${this.stack.name}/${this.stack.endpoint}`;
            } else {
                return `/compose/${this.stack.name}`;
            }
        },
        depthMargin() {
            return {
                marginLeft: `${31 * this.depth}px`,
            };
        },
        stackName() {
            return this.stack.name;
        },
        /** The key of the stack in completeStackList */
        selectKey() {
            return this.stack.name + "_" + (this.stack.endpoint || "");
        },
    },
    watch: {
        isSelectMode() {
            // TODO: Resize the heartbeat bar, but too slow
            // this.$refs.heartbeatBar.resize();
        }
    },
    beforeMount() {

    },
    methods: {
        /**
         * Changes the collapsed value of the current stack and saves
         * it to local storage
         * @returns {void}
         */
        changeCollapsed() {
            this.isCollapsed = !this.isCollapsed;

            // Save collapsed value into local storage
            let storage = window.localStorage.getItem("stackCollapsed");
            let storageObject = {};
            if (storage !== null) {
                storageObject = JSON.parse(storage);
            }
            storageObject[`stack_${this.stack.id}`] = this.isCollapsed;

            window.localStorage.setItem("stackCollapsed", JSON.stringify(storageObject));
        },

        /**
         * Toggle selection of stack
         * @returns {void}
         */
        toggleSelection() {
            if (this.isSelected(this.selectKey)) {
                this.deselect(this.selectKey);
            } else {
                this.select(this.selectKey);
            }
        },

        /**
         * In select mode the row is a checkbox, not a link. A stack that
         * is not managed by dockge has no actions, thus it stays out.
         * @param {MouseEvent} e the click
         * @returns {void}
         */
        onClick(e) {
            if (!this.isSelectMode) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (this.stack.isManagedByDockge) {
                this.toggleSelection();
            }
        },
    },
};
</script>

<style lang="scss" scoped>
// .item is styled globally via ".stack-list .item" in main.scss

.select-box {
    flex: 0 0 auto;
    margin-top: 0;
    pointer-events: none;
}

.dim {
    opacity: 0.5;
}

// Long names truncate with an ellipsis (full name in the title tooltip)
// instead of wrapping to several lines in the narrow sidebar.
.title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

// Marks a stack with an image that has a new version
.update-badge {
    margin-left: auto;
    padding-left: 0.4rem;
    font-size: 11px;
    color: var(--bs-info);
    flex: 0 0 auto;
}
</style>
