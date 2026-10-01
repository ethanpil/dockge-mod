<template>
    <div class="container-actions">
        <router-link v-if="running" class="mini-btn shell-btn" :to="bashTo">{{ $t("shell") }}</router-link>
        <div v-if="multi" class="dropdown">
            <button
                class="mini-btn"
                data-bs-toggle="dropdown"
                data-bs-boundary="viewport"
                aria-expanded="false"
                :title="$t('actions')"
                :aria-label="$t('actions')"
                @mousedown="useFixedMenu"
                @keydown="useFixedMenu"
            >
                <font-awesome-icon icon="ellipsis" />
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li v-if="!running">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('start')">
                        <font-awesome-icon icon="play" fixed-width class="me-2" /> {{ $t("startStack") }}
                    </button>
                </li>
                <li v-if="restartable">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('restart')">
                        <font-awesome-icon icon="rotate" fixed-width class="me-2" /> {{ $t("restartStack") }}
                    </button>
                </li>
                <li v-if="restartable">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('stop')">
                        <font-awesome-icon icon="stop" fixed-width class="me-2" /> {{ $t("stopStack") }}
                    </button>
                </li>
            </ul>
        </div>
        <span v-if="!hasActions" class="text-body-secondary">—</span>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { Dropdown } from "bootstrap";

/**
 * The shell link and the actions menu of a container, shared by the desktop table and the mobile
 * cards so the two cannot drift apart. The visibility rules mirror the
 * original per-service card buttons exactly, including "unhealthy": a running
 * container with a failing healthcheck must keep Restart and Stop — they are
 * the two actions that recover it.
 */
export default {
    components: {
        FontAwesomeIcon,
    },
    props: {
        status: {
            type: String,
            default: "N/A",
        },
        serviceCount: {
            type: Number,
            required: true,
        },
        processing: {
            type: Boolean,
            default: false,
        },
        /** Router location of the Bash terminal for this service */
        bashTo: {
            type: [ Object, String ],
            default: "",
        },
        /** False for a Dockge 1.5.0 agent, which has no service events */
        serviceActions: {
            type: Boolean,
            default: true,
        },
    },
    emits: [
        "start",
        "restart",
        "stop",
    ],
    computed: {
        running() {
            return this.status === "running" || this.status === "healthy";
        },

        restartable() {
            return this.running || this.status === "unhealthy";
        },

        /** Start, restart, and stop of one service of several */
        multi() {
            return this.serviceActions && this.serviceCount > 1;
        },

        hasActions() {
            return this.running || this.multi;
        },
    },
    methods: {
        /**
         * Make the menu use a fixed position before bootstrap makes a default
         * one. The container table scrolls sideways, and a menu inside that
         * box is cut off and adds a scrollbar. A fixed menu is not in the box.
         *
         * mousedown and keydown come before the click that bootstrap listens
         * for, so the instance that this makes is the instance that bootstrap
         * then uses.
         * @param {Event} e the mousedown or keydown on the toggle button
         * @returns {void}
         */
        useFixedMenu(e) {
            Dropdown.getOrCreateInstance(e.currentTarget, {
                popperConfig: (defaults) => ({
                    ...defaults,
                    strategy: "fixed",
                }),
            });
        },
    },
};
</script>

<style scoped lang="scss">
.container-actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
}

.shell-btn {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
}
</style>
