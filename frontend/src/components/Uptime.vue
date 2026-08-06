<template>
    <span v-if="dot" class="status-dot" :class="'dot-' + dotColor" :title="statusName" role="img" :aria-label="statusName"></span>
    <span v-else :class="className">{{ statusName }}</span>
</template>

<script>
import { statusColor, statusNameShort } from "../../../common/util-common";

export default {
    props: {
        stack: {
            type: Object,
            default: null,
        },
        /** Render as a small status dot instead of a pill */
        dot: {
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

        dotColor() {
            // Same presentation remap as className: primary -> success (green),
            // dark -> secondary (muted).
            return {
                primary: "success",
                dark: "secondary",
            }[this.color] ?? this.color;
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

            return `badge rounded-pill ${variant}`;
        },
    },
};
</script>

<style scoped>
.badge {
    min-width: 62px;
}

/* .status-dot / .dot-* are global (main.scss) */
</style>
