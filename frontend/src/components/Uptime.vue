<template>
    <span :class="className">{{ statusName }}</span>
</template>

<script>
import { statusColor, statusNameShort } from "../../../common/util-common";

export default {
    props: {
        stack: {
            type: Object,
            default: null,
        },
        fixedWidth: {
            type: Boolean,
            default: false,
        },
    },

    computed: {
        uptime() {
            return this.$t("notAvailableShort");
        },

        color() {
            return statusColor(this.stack?.status);
        },

        statusName() {
            return this.$t(statusNameShort(this.stack?.status));
        },

        className() {
            // Remap the shared status colours for presentation only, leaving
            // common/util-common.ts untouched:
            //   primary -> success  so that "active" reads green, not blue.
            //   dark    -> subtle   because `bg-dark` is near-black in light mode
            //                       and near-invisible in dark mode, which made the
            //                       least important state the loudest badge.
            const variant = {
                primary: "bg-success",
                dark: "bg-secondary-subtle text-secondary-emphasis border",
            }[this.color] ?? `bg-${this.color}`;

            let className = `badge rounded-pill ${variant}`;

            if (this.fixedWidth) {
                className += " fixed-width";
            }
            return className;
        },
    },
};
</script>

<style scoped>
.badge {
    min-width: 62px;
}

.fixed-width {
    width: 62px;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
