<template>
    <div>
        <h5>{{ $t("Internal Networks") }}</h5>
        <ul class="list-group">
            <li v-for="(networkRow, index) in networkList" :key="index" class="list-group-item">
                <input v-model="networkRow.key" type="text" class="no-bg domain-input" :placeholder="$t(`Network name...`)" />
                <font-awesome-icon icon="times" class="action remove ms-2 me-3 text-danger" @click="remove(index)" />
            </li>
        </ul>

        <button class="btn btn-normal btn-sm mt-3 me-2" @click="addField">{{ $t("addInternalNetwork") }}</button>

        <h5 class="mt-3">{{ $t("External Networks") }}</h5>

        <div v-if="externalNetworkList.length === 0">
            {{ $t("No External Networks") }}
        </div>

        <div v-for="(networkName, index) in externalNetworkList" :key="networkName" class="form-check form-switch my-3">
            <input :id=" 'external-network' + index" v-model="selectedExternalList[networkName]" class="form-check-input" type="checkbox">

            <label class="form-check-label" :for=" 'external-network' +index">
                {{ networkName }}
            </label>

            <span v-if="false" class="text-danger ms-2 delete">Delete</span>
        </div>

        <div v-if="false" class="input-group mb-3">
            <input
                placeholder="New external network name..."
                class="form-control"
                @keyup.enter="createExternelNetwork"
            />
            <button class="btn btn-normal btn-sm  me-2" type="button">
                {{ $t("createExternalNetwork") }}
            </button>
        </div>

        <div v-if="false">
            <button class="btn btn-primary btn-sm mt-3 me-2" @click="applyToYAML">{{ $t("applyToYAML") }}</button>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            networkList: [],
            externalList: {},
            selectedExternalList: {},
            externalNetworkList: [],
        };
    },
    computed: {
        jsonConfig() {
            return this.$parent.$parent.jsonConfig;
        },

        stack() {
            return this.$parent.$parent.stack;
        },

        editorFocus() {
            return this.$parent.$parent.editorFocus;
        },

        endpoint() {
            return this.$parent.$parent.endpoint;
        },
    },
    watch: {
        "jsonConfig.networks": {
            handler() {
                if (this.editorFocus) {
                    console.debug("jsonConfig.networks changed");
                    this.loadNetworkList();
                }
            },
            deep: true,
        },

        "selectedExternalList": {
            handler() {
                for (const networkName in this.selectedExternalList) {
                    const enable = this.selectedExternalList[networkName];

                    if (enable) {
                        if (!this.externalList[networkName]) {
                            this.externalList[networkName] = {};
                        }
                        this.externalList[networkName].external = true;
                    } else {
                        delete this.externalList[networkName];
                    }
                }
                this.applyToYAML();
            },
            deep: true,
        },

        "networkList": {
            handler() {
                this.applyToYAML();
            },
            deep: true,
        }

    },
    mounted() {
        this.loadNetworkList();
        this.loadExternalNetworkList();
    },
    methods: {
        loadNetworkList() {
            this.networkList = [];
            this.externalList = {};

            for (const key in this.jsonConfig.networks) {
                let obj = {
                    key: key,
                    value: this.jsonConfig.networks[key],
                };

                if (obj.value && obj.value.external) {
                    this.externalList[key] = Object.assign({}, obj.value);
                } else {
                    this.networkList.push(obj);
                }
            }

            // Restore selectedExternalList
            this.selectedExternalList = {};
            for (const networkName in this.externalList) {
                this.selectedExternalList[networkName] = true;
            }
        },

        loadExternalNetworkList() {
            this.$root.emitAgent(this.endpoint, "getDockerNetworkList", (res) => {
                if (res.ok) {
                    this.externalNetworkList = res.dockerNetworkList.filter((n) => {
                        // Filter out this stack networks
                        if (n.startsWith(this.stack.name + "_")) {
                            return false;
                        }
                        // They should be not supported.
                        // https://docs.docker.com/compose/compose-file/06-networks/#host-or-none
                        if (n === "none" || n === "host" || n === "bridge") {
                            return false;
                        }
                        return true;
                    });
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        addField() {
            this.networkList.push({
                key: "",
                value: {},
            });
        },

        remove(index) {
            this.networkList.splice(index, 1);
            this.applyToYAML();
        },

        applyToYAML() {
            if (this.editorFocus) {
                return;
            }

            const networks = {};

            // Internal networks
            for (const networkRow of this.networkList) {
                networks[networkRow.key] = networkRow.value;
            }

            // External networks
            for (const networkName in this.externalList) {
                networks[networkName] = this.externalList[networkName];
            }

            // A stack with no network must keep no networks key. This method
            // runs when edit mode opens, thus an empty key here would put
            // "networks: {}" in a compose file that the user did not change.
            if (Object.keys(networks).length === 0) {
                if (this.jsonConfig.networks) {
                    delete this.jsonConfig.networks;
                }
                return;
            }

            this.jsonConfig.networks = networks;

            console.debug("applyToYAML", this.jsonConfig.networks);
        }

    },
};
</script>

<style lang="scss" scoped>
.delete {
    text-decoration: underline;
    font-size: 13px;
    cursor: pointer;
}
</style>
