<template>
    <div>
        <div class="my-3">
            <p class="note">{{ $t("notificationsNote") }}</p>

            <div v-if="!loaded" class="my-3">
                <font-awesome-icon icon="spinner" spin />
            </div>

            <div v-else>
                <div v-if="notifications.length === 0" class="note mb-3">{{ $t("noNotifications") }}</div>

                <div v-for="item in notifications" :key="item.id" class="target-item">
                    <div class="target-text">
                        <div class="target-name">
                            {{ item.name }}
                            <span class="badge ms-1" :class="item.active ? 'bg-primary' : 'bg-secondary'">
                                {{ item.active ? $t("notificationActive") : $t("notificationInactive") }}
                            </span>
                        </div>
                        <div class="target-info">
                            {{ item.type }} · {{ eventLabels(item.events) }}
                        </div>
                    </div>
                    <button class="btn btn-normal btn-sm" type="button" @click="edit(item)">
                        <font-awesome-icon icon="pen" /> {{ $t("editNotification") }}
                    </button>
                </div>

                <button v-if="!form" class="btn btn-primary mt-3" type="button" @click="add">
                    <font-awesome-icon icon="plus" /> {{ $t("addNotification") }}
                </button>
            </div>

            <!-- Add or edit form -->
            <form v-if="form" class="shadow-box form-box mt-3" autocomplete="off" @submit.prevent="save">
                <div class="mb-3">
                    <label for="notificationName" class="form-label">{{ $t("notificationName") }}</label>
                    <input id="notificationName" v-model="form.name" type="text" class="form-control" required>
                </div>

                <div class="mb-3">
                    <label for="notificationType" class="form-label">{{ $t("notificationType") }}</label>
                    <select id="notificationType" v-model="form.type" class="form-select">
                        <option v-for="type in types" :key="type" :value="type">{{ type }}</option>
                    </select>
                </div>

                <div class="mb-3">
                    <label for="notificationUrl" class="form-label">{{ $t("notificationUrl") }}</label>
                    <input id="notificationUrl" v-model="form.url" type="text" class="form-control" required>
                </div>

                <div class="mb-3">
                    <div class="form-label">{{ $t("notificationEvents") }}</div>
                    <div v-for="event in events" :key="event" class="form-check">
                        <input :id="`event-${event}`" v-model="form.events" class="form-check-input" type="checkbox" :value="event">
                        <label :for="`event-${event}`" class="form-check-label">{{ $t(`event_${event}`) }}</label>
                    </div>
                </div>

                <div class="form-check form-switch mb-3">
                    <input id="notificationActive" v-model="form.active" class="form-check-input" type="checkbox">
                    <label for="notificationActive" class="form-check-label">{{ $t("notificationActive") }}</label>
                </div>

                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-primary" type="submit" :disabled="busy">
                        <font-awesome-icon v-if="busy" icon="spinner" spin class="me-1" />
                        {{ $t("Save") }}
                    </button>
                    <button class="btn btn-normal" type="button" :disabled="busy" @click="test">
                        {{ $t("testNotification") }}
                    </button>
                    <button v-if="form.id" class="btn btn-danger" type="button" :disabled="busy" @click="$refs.confirmDelete.show()">
                        {{ $t("deleteNotification") }}
                    </button>
                    <button class="btn btn-secondary ms-auto" type="button" :disabled="busy" @click="form = null">
                        {{ $t("cancel") }}
                    </button>
                </div>
            </form>

            <Confirm ref="confirmDelete" btn-style="btn-danger" :yes-text="$t('deleteNotification')" :no-text="$t('cancel')" @yes="remove">
                {{ $t("deleteNotificationMsg") }}
            </Confirm>
        </div>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import Confirm from "../Confirm.vue";

const TYPES = [ "webhook", "ntfy", "apprise" ];
const EVENTS = [ "image_update", "container_exited", "container_unhealthy" ];

export default {
    name: "Notifications",
    components: {
        FontAwesomeIcon,
        Confirm,
    },

    data() {
        return {
            loaded: false,
            busy: false,
            notifications: [],
            // The target in the form, or null when the form is closed
            form: null,
            types: TYPES,
            events: EVENTS,
        };
    },

    mounted() {
        this.load();
    },

    created() {
        // The cancel functions of the requests that wait for an answer
        this.cancels = [];
    },

    unmounted() {
        // The requests that wait must stay quiet after the page is gone
        this.cancels.forEach((cancel) => cancel());
    },

    methods: {
        /**
         * Send an event to the server and keep the cancel function, so
         * the unmount can stop the wait.
         * @param {string} event event name
         * @param {Array} args arguments before the callback
         * @param {Function} cb gets the answer, or a timeout result
         * @returns {void}
         */
        request(event, args, cb) {
            const cancel = this.$root.emitWithTimeout(event, args, 30000, (res) => {
                this.cancels = this.cancels.filter((c) => c !== cancel);
                cb(res);
            });
            this.cancels.push(cancel);
        },

        /**
         * Get the list of targets from the server.
         * @returns {void}
         */
        load() {
            this.loaded = false;
            this.request("getNotifications", [], (res) => {
                this.loaded = true;
                if (res.ok) {
                    this.notifications = res.notifications;
                } else {
                    this.notifications = [];
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Open the form for a new target.
         * @returns {void}
         */
        add() {
            this.form = {
                name: "",
                type: TYPES[0],
                url: "",
                events: [ ...EVENTS ],
                active: true,
            };
        },

        /**
         * Open the form with a copy of a target.
         * @param {object} item the target
         * @returns {void}
         */
        edit(item) {
            this.form = {
                ...item,
                events: [ ...item.events ],
            };
        },

        /**
         * Save the form, then get the list again.
         * @returns {void}
         */
        save() {
            this.busy = true;
            this.request("saveNotification", [ this.form ], (res) => {
                this.busy = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.form = null;
                    this.load();
                }
            });
        },

        /**
         * Send a test message with the form data. The target is not saved.
         * @returns {void}
         */
        test() {
            this.busy = true;
            this.request("testNotification", [ this.form ], (res) => {
                this.busy = false;
                this.$root.toastRes(res);
            });
        },

        /**
         * Delete the target in the form, then get the list again.
         * @returns {void}
         */
        remove() {
            this.busy = true;
            this.request("deleteNotification", [ this.form.id ], (res) => {
                this.busy = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.form = null;
                    this.load();
                }
            });
        },

        /**
         * The display names of the events of a target.
         * @param {string[]} events event keys
         * @returns {string} names, with commas between them
         */
        eventLabels(events) {
            if (!events || events.length === 0) {
                return this.$t("noEvents");
            }
            return events.map((e) => this.$t(`event_${e}`)).join(", ");
        },
    },
};
</script>

<style scoped>
.note {
    font-size: 0.9em;
    color: var(--bs-secondary-color);
}

.target-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--bs-border-color);
}

.target-item:last-of-type {
    border-bottom: 0;
}

.target-text {
    flex: 1;
    min-width: 0;
}

.target-name {
    font-weight: 600;
}

.target-info {
    font-size: 0.85em;
    color: var(--bs-secondary-color);
    overflow-wrap: anywhere;
}

.form-box {
    padding: 0.75rem;
}
</style>
