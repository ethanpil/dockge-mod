<template>
    <div>
        <div v-if="valid">
            <ul v-if="isArrayInited" class="list-group">
                <li v-for="(value, index) in array" :key="index" class="list-group-item">
                    <input v-model="array[index]" type="text" class="no-bg domain-input" :placeholder="placeholder" />
                    <font-awesome-icon icon="times" class="action remove ms-2 me-3 text-danger" @click="remove(index)" />
                </li>
            </ul>

            <button v-if="!compact" class="btn btn-normal btn-sm mt-3" @click="addField">{{ $t("addListItem", [ displayName ]) }}</button>
        </div>
        <div v-else>
            {{ $t("LongSyntaxNotSupported") }}
        </div>
    </div>
</template>

<script>
import { isSimpleList } from "../util-frontend";

export default {
    props: {
        name: {
            type: String,
            required: true,
        },
        placeholder: {
            type: String,
            default: "",
        },
        displayName: {
            type: String,
            required: true,
        },
        objectType: {
            type: String,
            default: "service",
        },
        /** Hide the add button. The parent then calls addField() with a ref. */
        compact: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {

        };
    },
    computed: {
        array() {
            // Create the array if not exists, it should be safe.
            if (!this.service[this.name]) {
                return [];
            }
            return this.service[this.name];
        },

        /**
         * Check if the array is inited before called v-for.
         * Prevent empty arrays inserted to the YAML file.
         * @return {boolean}
         */
        isArrayInited() {
            return this.service[this.name] !== undefined;
        },

        /**
         * Not a good name, but it is used to get the object.
         */
        service() {
            if (this.objectType === "service") {
                // Used in Container.vue
                return this.$parent.$parent.service;
            } else if (this.objectType === "x-dockge") {

                if (!this.$parent.$parent.jsonConfig["x-dockge"]) {
                    return {};
                }

                // Used in Compose.vue
                return this.$parent.$parent.jsonConfig["x-dockge"];
            } else {
                return {};
            }
        },

        valid() {
            return isSimpleList(this.array);
        }

    },
    created() {

    },
    methods: {
        addField() {

            // Create the object if not exists.
            if (this.objectType === "x-dockge") {
                if (!this.$parent.$parent.jsonConfig["x-dockge"]) {
                    this.$parent.$parent.jsonConfig["x-dockge"] = {};
                }
            }

            // Create the array if not exists.
            if (!this.service[this.name]) {
                this.service[this.name] = [];
            }

            this.array.push("");
        },
        remove(index) {
            const service = this.service;
            this.array.splice(index, 1);

            // An empty list must not stay in the compose file. Without this,
            // the removal of the last item keeps "urls: []" or "ports: []" in
            // the file of the user.
            if (Array.isArray(service[this.name]) && service[this.name].length === 0) {
                delete service[this.name];

                // The x-dockge object also goes away when it holds nothing
                if (this.objectType === "x-dockge" && Object.keys(service).length === 0) {
                    delete this.$parent.$parent.jsonConfig["x-dockge"];
                }
            }
        },
    }
};
</script>

