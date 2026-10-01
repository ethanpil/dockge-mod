<template>
    <div class="d-flex justify-content-center align-items-center">
        <div class="logo d-flex flex-column justify-content-center align-items-center">
            <img class="my-4" src="/icon.svg" width="200" height="200" alt="" />
            <div class="fs-4 fw-bold">dockge-mod</div>
            <div>{{ $t("Version") }}: {{ $root.info.version }}</div>
            <div class="frontend-version">{{ $t("Frontend Version") }}: {{ $root.frontendVersion }}</div>

            <div class="mt-3">
                <a href="https://github.com/ethanpil/dockge-mod" target="_blank" rel="noopener">github.com/ethanpil/dockge-mod</a>
            </div>
            <i18n-t keypath="aboutCompat" tag="div" class="compat-note mt-1">
                <template #dockge>
                    <a href="https://github.com/louislam/dockge" target="_blank" rel="noopener">Dockge</a>
                </template>
                <template #commit>
                    <a href="https://github.com/louislam/dockge/commit/f809ae192b571944ad773e9866d3e67064ae8043" target="_blank" rel="noopener" class="mono">f809ae1</a>
                </template>
            </i18n-t>

        </div>
    </div>
</template>

<script>
export default {
    inject: [ "settingsPage" ],

    computed: {
        settingsLoaded() {
            return this.settingsPage.settingsLoaded;
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

.compat-note {
    font-size: 0.85em;
    color: var(--bs-secondary-color);
    max-width: 34em;
    text-align: center;
}

</style>
