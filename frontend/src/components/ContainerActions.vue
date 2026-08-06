<template>
    <div class="container-actions">
        <div v-if="hasActions" class="dropdown">
            <button class="btn btn-secondary btn-sm dropdown-toggle actions-btn" data-bs-toggle="dropdown" aria-expanded="false">
                {{ $t("actions") }}
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li v-if="running">
                    <router-link class="dropdown-item" :to="bashTo">
                        <font-awesome-icon icon="terminal" class="me-1" /> Bash
                    </router-link>
                </li>
                <li v-if="running && serviceCount > 1"><hr class="dropdown-divider"></li>
                <li v-if="!running && serviceCount > 1">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('start')">
                        <font-awesome-icon icon="play" class="me-1" /> {{ $t("startStack") }}
                    </button>
                </li>
                <li v-if="restartable && serviceCount > 1">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('restart')">
                        <font-awesome-icon icon="rotate" class="me-1" /> {{ $t("restartStack") }}
                    </button>
                </li>
                <li v-if="restartable && serviceCount > 1">
                    <button class="dropdown-item" :disabled="processing" @click="$emit('stop')">
                        <font-awesome-icon icon="stop" class="me-1" /> {{ $t("stopStack") }}
                    </button>
                </li>
            </ul>
        </div>
        <span v-else class="text-body-secondary">—</span>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

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

        hasActions() {
            return this.running || this.serviceCount > 1;
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
