<template>
    <div class="dashboard">
        <aside class="dashboard-side">
            <router-link to="/compose" class="btn btn-primary w-100 mb-2"><font-awesome-icon icon="plus" class="me-1" /> {{ $t("newStack") }}</router-link>
            <StackList :scrollbar="true" />
        </aside>

        <div ref="container" class="dashboard-main mb-3">
            <!-- Add :key to disable vue router re-use the same component -->
            <router-view :key="$route.fullPath" :calculatedHeight="height" />
        </div>
    </div>
</template>

<script>

import StackList from "../components/StackList.vue";

export default {
    components: {
        StackList,
    },
    data() {
        return {
            height: 0
        };
    },
    mounted() {
        this.height = this.$refs.container.offsetHeight;
    },
};
</script>

<style lang="scss" scoped>
.dashboard {
    display: flex;
    gap: 1.25rem;
    padding: 0 1.5rem;
}

.dashboard-side {
    flex: 0 0 264px;
    min-width: 0;
}

.dashboard-main {
    flex: 1 1 0;
    min-width: 0;
}

@media (max-width: 1079.98px) {
    .dashboard-side {
        flex-basis: 220px;
    }
}

@media (max-width: 767.98px) {
    .dashboard {
        flex-direction: column;
        gap: 0.75rem;
        padding: 0 0.75rem;
    }

    .dashboard-side {
        flex: 0 0 auto;
    }
}
</style>
