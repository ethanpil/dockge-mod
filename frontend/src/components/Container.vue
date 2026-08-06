<template>
    <div class="container-card mb-2">
        <div class="panel-head ccard-head" :class="{ closed: !showConfig }">
            <span class="svc-title" :title="name">{{ name }}</span>
            <span class="img-note"><span class="img-name">{{ imageName }}</span><template v-if="imageTag">:{{ imageTag }}</template></span>
            <span class="counts d-none d-sm-inline">{{ countsSummary }}</span>
            <div class="head-actions">
                <button class="btn btn-secondary btn-sm head-btn" :aria-expanded="showConfig ? 'true' : 'false'" @click="showConfig = !showConfig">
                    <template v-if="showConfig"><font-awesome-icon icon="chevron-up" /> {{ $t("closeEdit") }}</template>
                    <template v-else><font-awesome-icon icon="edit" /> {{ $t("Edit") }}</template>
                </button>
                <button class="btn btn-outline-danger btn-sm head-btn" @click="$refs.confirmRemove.show()">
                    <font-awesome-icon icon="trash" />
                    {{ $t("deleteContainer") }}
                </button>
            </div>
        </div>

        <!-- Delete removes the service from the file immediately, so ask first -->
        <Confirm ref="confirmRemove" btn-style="btn-danger" :yes-text="$t('deleteContainer')" :no-text="$t('cancel')" @yes="remove">
            <i18n-t keypath="deleteContainerMsg" tag="span">
                <strong>{{ name }}</strong>
            </i18n-t>
        </Confirm>

        <transition name="slide-fade" appear>
            <div v-if="showConfig" class="config">
                <div class="grid-image mb-2">
                    <!-- Image -->
                    <div class="field">
                        <div class="f-label">{{ $t("dockerImage") }}</div>
                        <input
                            v-model="service.image"
                            class="form-control form-control-sm mono"
                            :list="datalistId"
                        />
                        <datalist :id="datalistId">
                            <option value="louislam/uptime-kuma:1" />
                        </datalist>
                    </div>

                    <!-- Restart Policy -->
                    <div class="field">
                        <div class="f-label">{{ $t("restartPolicy") }}</div>
                        <select v-model="service.restart" class="form-select form-select-sm">
                            <option value="always">{{ $t("restartPolicyAlways") }}</option>
                            <option value="unless-stopped">{{ $t("restartPolicyUnlessStopped") }}</option>
                            <option value="on-failure">{{ $t("restartPolicyOnFailure") }}</option>
                            <option value="no">{{ $t("restartPolicyNo") }}</option>
                        </select>
                    </div>
                </div>

                <div class="grid-lists">
                    <!-- Ports -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("port", 2) }}
                            <button v-if="canAdd.ports" class="mini-btn add-btn" @click="$refs.portsInput?.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="portsInput" name="ports" :display-name="$t('port')" placeholder="HOST:CONTAINER" :compact="true" />
                    </div>

                    <!-- Volumes -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("volume", 2) }}
                            <button v-if="canAdd.volumes" class="mini-btn add-btn" @click="$refs.volumesInput?.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="volumesInput" name="volumes" :display-name="$t('volume')" placeholder="HOST:CONTAINER" :compact="true" />
                    </div>

                    <!-- Environment Variables -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("environmentVariable", 2) }}
                            <button v-if="canAdd.env" class="mini-btn add-btn" @click="$refs.envInput?.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="envInput" name="environment" :display-name="$t('environmentVariable')" placeholder="KEY=VALUE" :compact="true" />
                    </div>

                    <!-- Networks + Depends on -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("network", 2) }}
                            <button v-if="canAdd.networks" class="mini-btn add-btn" @click="$refs.networksInput?.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <div v-if="networkList.length === 0 && service.networks && service.networks.length > 0" class="text-warning small mb-1">
                            {{ $t("NoNetworksAvailable") }}
                        </div>
                        <ArraySelect ref="networksInput" name="networks" :display-name="$t('network')" placeholder="Network Name" :options="networkList" :compact="true" />

                        <div class="f-label mt-2">
                            {{ $t("dependsOn") }}
                            <button v-if="canAdd.depends" class="mini-btn add-btn" @click="$refs.dependsInput?.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="dependsInput" name="depends_on" :display-name="$t('dependsOn')" :placeholder="$t(`containerName`)" :compact="true" />
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
import { defineComponent } from "vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import ArrayInput from "./ArrayInput.vue";
import ArraySelect from "./ArraySelect.vue";
import Confirm from "./Confirm.vue";

/**
 * True when a compose field holds a simple list that the form can edit.
 * A map, or a list of objects (the long syntax), must go to the YAML editor.
 * @param {*} value the field value
 * @returns {boolean} true if the form can add an item
 */
function isSimpleList(value) {
    if (value === undefined || value === null) {
        return true;
    }
    if (!Array.isArray(value)) {
        return false;
    }
    return !value.some((item) => typeof item === "object" && item !== null);
}

/**
 * The editable per-service card of edit mode. View mode renders the
 * containers table in Compose.vue instead.
 */
export default defineComponent({
    components: {
        FontAwesomeIcon,
        ArrayInput,
        ArraySelect,
        Confirm,
    },
    props: {
        name: {
            type: String,
            required: true,
        },
        isEditMode: {
            type: Boolean,
            default: false,
        },
        /** Open the config on mount (used when the stack has few services) */
        defaultOpen: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {
            // null means "follow defaultOpen"; a click sets an explicit choice
            openChoice: null,
        };
    },
    computed: {

        /**
         * Open state of the config. A card that the user did not touch
         * follows the defaultOpen property, so a card added to a small stack
         * opens even when the new service count crosses the limit.
         */
        showConfig: {
            get() {
                return this.openChoice ?? this.defaultOpen;
            },
            set(value) {
                this.openChoice = value;
            },
        },

        /**
         * Which lists the form can add an item to. The list editors show
         * "long syntax is not supported" for the other forms, and their add
         * button must not write into a value they cannot show.
         */
        canAdd() {
            return {
                ports: isSimpleList(this.service.ports),
                volumes: isSimpleList(this.service.volumes),
                env: isSimpleList(this.service.environment),
                networks: isSimpleList(this.service.networks),
                depends: isSimpleList(this.service.depends_on),
            };
        },

        /** Unique per card, because several cards can be open at once */
        datalistId() {
            return `image-datalist-${this.name}`;
        },

        networkList() {
            let list = [];
            for (const networkName in this.jsonObject.networks) {
                list.push(networkName);
            }
            return list;
        },

        service() {
            if (!this.jsonObject.services[this.name]) {
                return {};
            }
            return this.jsonObject.services[this.name];
        },

        jsonObject() {
            return this.$parent.$parent.jsonConfig;
        },

        envsubstJSONConfig() {
            return this.$parent.$parent.envsubstJSONConfig;
        },

        envsubstService() {
            if (!this.envsubstJSONConfig.services[this.name]) {
                return {};
            }
            return this.envsubstJSONConfig.services[this.name];
        },

        imageName() {
            if (this.envsubstService.image) {
                return this.envsubstService.image.split(":")[0];
            } else {
                return "";
            }
        },

        imageTag() {
            if (this.envsubstService.image) {
                let tag = this.envsubstService.image.split(":")[1];

                if (tag) {
                    return tag;
                } else {
                    return "latest";
                }
            } else {
                return "";
            }
        },

        /**
         * Item counts for the card header, for example
         * "2 ports · 1 volume · 2 env". A compose file can give the
         * environment as a list or as a map.
         */
        countsSummary() {
            const len = (v) => {
                if (Array.isArray(v)) {
                    return v.length;
                }
                if (v && typeof v === "object") {
                    return Object.keys(v).length;
                }
                return 0;
            };
            // Only the count 1 is singular. $tc with 0 selects the singular
            // form in some rules, which gives "0 port".
            const label = (key, n) => this.$tc(key, n === 1 ? 1 : 2).toLowerCase();
            const ports = len(this.service.ports);
            const volumes = len(this.service.volumes);
            const env = len(this.service.environment);
            return [
                `${ports} ${label("port", ports)}`,
                `${volumes} ${label("volume", volumes)}`,
                `${env} ${this.$t("envAbbrev")}`,
            ].join(" · ");
        },
    },
    methods: {
        remove() {
            delete this.jsonObject.services[this.name];
        },
    }
});
</script>

<style scoped lang="scss">
/* .panel-head, .panel-title, .mini-btn and .mono are global (main.scss) */
.container-card {
    border: 1px solid var(--bs-border-color);
    border-radius: 4px;
}

/* Only the differences from the global .panel-head */
.ccard-head {
    gap: 0.6rem;
    min-width: 0;
    flex-wrap: wrap;

    &.closed {
        border-bottom: 0;
        border-radius: 4px;
    }
}

.svc-title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.img-note {
    font-size: 11.5px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;

    .img-name {
        color: var(--bs-body-color);
        font-weight: 500;
    }
}

.counts {
    font-size: 11px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.head-actions {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
    flex: 0 0 auto;
}

// Keep the touch target at the 24px minimum; Delete is destructive and
// sits beside Close.
.head-btn {
    padding: 0.15rem 0.5rem;
    font-size: 11.5px;
    line-height: 1.5;
    min-height: 24px;
    border-radius: 3px;
    white-space: nowrap;
}

.config {
    padding: 0.5rem;
}

/* .panel-title supplies the type; this adds the row layout */
.f-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--bs-secondary-color);
    margin-bottom: 0.2rem;
    min-height: 24px;
}

/* .mini-btn (global) supplies the look; this adds the placement */
.add-btn {
    margin-left: auto;
}

/* Image wide, restart policy narrow */
.grid-image {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 0.5rem 0.8rem;
}

/* Ports | Volumes / Environment | Networks+Depends */
.grid-lists {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 0.8rem;
}

@media (max-width: 767.98px) {
    .grid-image,
    .grid-lists {
        grid-template-columns: 1fr;
    }
}

.field {
    min-width: 0;
}

/* Tighten the shared list editors inside the card only */
.config :deep(.list-group li) {
    padding: 2px 0 2px 8px;
}

.config :deep(.domain-input) {
    font-size: 12.5px;
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
}
</style>
