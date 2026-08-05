<template>
    <div class="d-flex justify-content-center align-items-center">
        <div class="logo d-flex flex-column justify-content-center align-items-center">
            <object class="my-4" width="200" height="200" data="/icon.svg" />
            <div class="fs-4 fw-bold">dockge-mod</div>
            <div>{{ $t("Version") }}: {{ $root.info.version }}</div>
            <div class="frontend-version">{{ $t("Frontend Version") }}: {{ $root.frontendVersion }}</div>

            <div v-if="!$root.isFrontendBackendVersionMatched" class="alert alert-warning mt-4" role="alert">
                ⚠️ {{ $t("Frontend Version do not match backend version!") }}
            </div>
        </div>
    </div>
</template>

<script>
export default {
    computed: {
        settingsLoaded() {
            return this.$parent.$parent.$parent.settingsLoaded;
        },
    },

    watch: {

    }
};
</script>

<style lang="scss" scoped>
.logo {
    margin: 4em 1em;
}

.frontend-version {
    font-size: 0.9em;
    color: var(--bs-secondary-color);
}

</style>
