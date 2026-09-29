<template>
    <div class="container-actions">
        <div v-if="hasActions" class="dropdown">
            <button
                class="btn btn-secondary btn-sm dropdown-toggle actions-btn"
                data-bs-toggle="dropdown"
                data-bs-boundary="viewport"
                aria-expanded="false"
                @mousedown="useFixedMenu"
                @keydown="useFixedMenu"
            >
                {{ $t("actions") }}
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li v-if="running">
                    <router-link class="dropdown-item" :to="bashTo">
                        <font-awesome-icon icon="terminal" fixed-width class="me-2" /> Bash
                    </router-link>
                </li>
                <li v-if="running && multi"><hr class="dropdown-divider"></li>
                <li v-if="!running && multi">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('start')">
                        <font-awesome-icon icon="play" fixed-width class="me-2" /> {{ $t("startStack") }}
                    </button>
                </li>
                <li v-if="restartable && multi">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('restart')">
                        <font-awesome-icon icon="rotate" fixed-width class="me-2" /> {{ $t("restartStack") }}
                    </button>
                </li>
                <li v-if="restartable && multi">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('stop')">
                        <font-awesome-icon icon="stop" fixed-width class="me-2" /> {{ $t("stopStack") }}
                    </button>
                </li>
            </ul>
        </div>
        <span v-else class="text-body-secondary">—</span>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { Dropdown } from "bootstrap";

/**
 * The per-container Actions menu, shared by the desktop table and the mobile
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
.actions-btn {
    padding: 0.05rem 0.4rem;
    font-size: 11.5px;
    border-radius: 2px;
    white-space: nowrap;
}
</style>
