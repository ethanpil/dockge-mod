<template>
    <div>
        <div class="my-3">
            <p class="note">{{ $t("dockgeHealthNote") }}</p>

            <div v-if="!loaded" class="my-3">
                <font-awesome-icon icon="spinner" spin />
            </div>

            <div v-else class="health-list">
                <div v-for="item in health" :key="item.key" class="health-item">
                    <font-awesome-icon
                        :icon="item.ok ? 'check-circle' : 'times-circle'"
                        :class="item.ok ? 'text-success' : 'text-danger'"
                    />
                    <div class="health-text">
                        <div class="health-name">{{ labelOf(item.key) }}</div>
                        <div class="health-info">{{ item.info }}</div>
                    </div>
                </div>
            </div>

            <button class="btn btn-normal mt-3" type="button" :disabled="!loaded" @click="load">
                <font-awesome-icon icon="rotate" class="me-1" />
                {{ $t("refresh") }}
            </button>
        </div>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

export default {
    name: "Health",
    components: {
        FontAwesomeIcon,
    },

    data() {
        return {
            loaded: false,
            health: [],
            // Each request keeps its own timer here, so the unmount can
            // stop every timer that still waits
            healthTimers: [],
        };
    },

    computed: {
        /**
         * The display names of the checks, by key.
         * @returns {object} key to display name
         */
        labels() {
            return {
                docker: this.$t("healthDocker"),
                dockerCompose: this.$t("healthDockerCompose"),
                git: this.$t("healthGit"),
                stacksDir: this.$t("healthStacksDir"),
                dataDir: this.$t("healthDataDir"),
            };
        },
    },

    mounted() {
        this.load();
    },

    unmounted() {
        this.healthTimers.forEach(clearTimeout);
    },

    methods: {
        /**
         * Get the health report from the server. A timer ends the wait if
         * the server does not answer, so the button does not stay disabled
         * for ever. An error keeps no old results on the screen.
         * @returns {void}
         */
        load() {
            this.loaded = false;

            // The handle stays in this function, so a late answer of an
            // earlier request cannot stop the timer of a later one.
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                this.loaded = true;
                this.health = [];
                this.$root.toastError(this.$t("requestTimeout"));
            }, 30000);
            this.healthTimers.push(timer);

            this.$root.getSocket().emit("getDockgeHealth", (res) => {
                clearTimeout(timer);
                if (settled) {
                    return;
                }
                settled = true;
                this.loaded = true;
                if (res.ok) {
                    this.health = res.health;
                } else {
                    this.health = [];
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * The display name of a check. An unknown key shows as itself, so a
         * new check on the server still gets a line.
         * @param {string} key key of the check
         * @returns {string} display name
         */
        labelOf(key) {
            return this.labels[key] ?? key;
        },
    },
};
</script>

<style scoped>
.note {
    font-size: 0.9em;
    color: var(--bs-secondary-color);
}

.health-item {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--bs-border-color);
}

.health-item:last-child {
    border-bottom: 0;
}

.health-name {
    font-weight: 600;
}

.health-info {
    font-size: 0.85em;
    color: var(--bs-secondary-color);
    overflow-wrap: anywhere;
}
</style>
