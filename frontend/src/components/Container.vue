<template>
    <div class="container-card mb-2">
        <div class="ccard-head" :class="{ closed: !showConfig }">
            <span class="svc-title">{{ name }}</span>
            <span class="img-note"><span class="img-name">{{ imageName }}</span><template v-if="imageTag">:{{ imageTag }}</template></span>
            <span class="counts d-none d-sm-inline">{{ countsSummary }}</span>
            <div class="head-actions">
                <button class="btn btn-secondary btn-sm head-btn" @click="showConfig = !showConfig">
                    <template v-if="showConfig"><font-awesome-icon icon="chevron-up" /> {{ $t("closeEdit") }}</template>
                    <template v-else><font-awesome-icon icon="edit" /> {{ $t("Edit") }}</template>
                </button>
                <button class="btn btn-outline-danger btn-sm head-btn" @click="remove">
                    <font-awesome-icon icon="trash" />
                    {{ $t("deleteContainer") }}
                </button>
            </div>
        </div>

        <transition name="slide-fade" appear>
            <div v-if="showConfig" class="config">
                <div class="grid-image mb-2">
                    <!-- Image -->
                    <div class="field">
                        <div class="f-label">{{ $t("dockerImage") }}</div>
                        <input
                            v-model="service.image"
                            class="form-control form-control-sm mono"
                            list="image-datalist"
                        />
                        <datalist id="image-datalist">
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
                            <button class="add-btn" @click="$refs.portsInput.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="portsInput" name="ports" :display-name="$t('port')" placeholder="HOST:CONTAINER" :compact="true" />
                    </div>

                    <!-- Volumes -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("volume", 2) }}
                            <button class="add-btn" @click="$refs.volumesInput.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="volumesInput" name="volumes" :display-name="$t('volume')" placeholder="HOST:CONTAINER" :compact="true" />
                    </div>

                    <!-- Environment Variables -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("environmentVariable", 2) }}
                            <button class="add-btn" @click="$refs.envInput.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <ArrayInput ref="envInput" name="environment" :display-name="$t('environmentVariable')" placeholder="KEY=VALUE" :compact="true" />
                    </div>

                    <!-- Networks + Depends on -->
                    <div class="field">
                        <div class="f-label">
                            {{ $tc("network", 2) }}
                            <button class="add-btn" @click="$refs.networksInput.addField()">+ {{ $t("add") }}</button>
                        </div>
                        <div v-if="networkList.length === 0 && service.networks && service.networks.length > 0" class="text-warning small mb-1">
                            {{ $t("NoNetworksAvailable") }}
                        </div>
                        <ArraySelect ref="networksInput" name="networks" :display-name="$t('network')" placeholder="Network Name" :options="networkList" :compact="true" />

                        <div class="f-label mt-2">
                            {{ $t("dependsOn") }}
                            <button class="add-btn" @click="$refs.dependsInput.addField()">+ {{ $t("add") }}</button>
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

/**
 * The editable per-service card of edit mode. View mode renders the
 * containers table in Compose.vue instead.
 */
export default defineComponent({
    components: {
        FontAwesomeIcon,
        ArrayInput,
        ArraySelect,
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
        first: {
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
            showConfig: this.defaultOpen,
        };
    },
    computed: {

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
         * Item counts for the closed card, e.g. "2 ports, 1 volume, 2 env".
         * The environment can be a list or a map in compose files.
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
            const ports = len(this.service.ports);
            const volumes = len(this.service.volumes);
            const env = len(this.service.environment);
            return [
                `${ports} ${this.$tc("port", ports).toLowerCase()}`,
                `${volumes} ${this.$tc("volume", volumes).toLowerCase()}`,
                `${env} env`,
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
.container-card {
    border: 1px solid var(--bs-border-color);
    border-radius: 4px;
}

.ccard-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.5rem;
    background-color: var(--bs-tertiary-bg);
    border-bottom: 1px solid var(--bs-border-color);
    border-radius: 4px 4px 0 0;
    min-width: 0;

    &.closed {
        border-bottom: 0;
        border-radius: 4px;
    }
}

.svc-title {
    font-weight: 600;
    white-space: nowrap;
}

.img-note {
    font-size: 11.5px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    .img-name {
        color: var(--bs-body-color);
        font-weight: 500;
    }
}

.counts {
    font-size: 11px;
    color: var(--bs-secondary-color);
    white-space: nowrap;
}

.head-actions {
    margin-left: auto;
    display: flex;
    gap: 0.3rem;
}

.head-btn {
    padding: 0.1rem 0.45rem;
    font-size: 11.5px;
    border-radius: 3px;
    white-space: nowrap;
}

.config {
    padding: 0.5rem;
}

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
}

.add-btn {
    margin-left: auto;
    border: 1px solid var(--bs-border-color);
    background: transparent;
    color: var(--bs-secondary-color);
    border-radius: 3px;
    font-size: 10.5px;
    line-height: 1.4;
    padding: 0 0.35rem;
    cursor: pointer;

    &:hover {
        color: var(--bs-body-color);
    }
}

.mono {
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
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
