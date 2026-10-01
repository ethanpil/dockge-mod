<template>
    <div>
        <div v-if="! $root.socketIO.connected && ! $root.socketIO.firstConnect" class="lost-connection">
            <div class="container-fluid">
                {{ $root.socketIO.connectionErrorMsg }}
                <div v-if="$root.socketIO.showReverseProxyGuide">
                    {{ $t("reverseProxyMsg1") }} <a href="https://github.com/ethanpil/dockge-mod#reverse-proxy" target="_blank">{{ $t("reverseProxyMsg2") }}</a>
                </div>
            </div>
        </div>

        <header class="app-header">
            <router-link to="/" class="brand">
                <img src="/icon.svg" width="28" height="28" alt="" />
                <span>dockge-mod</span>
            </router-link>

            <nav v-if="$root.loggedIn" class="app-nav">
                <router-link to="/" class="app-nav-link">
                    <font-awesome-icon icon="home" /> <span>{{ $t("home") }}</span>
                </router-link>
                <router-link to="/console" class="app-nav-link">
                    <font-awesome-icon icon="terminal" /> <span>{{ $t("console") }}</span>
                </router-link>
                <router-link to="/resources" class="app-nav-link">
                    <font-awesome-icon icon="layer-group" /> <span>{{ $t("resources") }}</span>
                </router-link>
            </nav>

            <div v-if="$root.loggedIn" class="dropdown dropdown-profile-pic">
                <button type="button" class="profile-btn" data-bs-toggle="dropdown" :aria-label="$t('accountMenu')">
                    <span class="profile-pic">{{ $root.usernameFirstChar }}</span>
                    <font-awesome-icon icon="angle-down" />
                </button>

                <!-- Header's Dropdown Menu -->
                <ul class="dropdown-menu dropdown-menu-end">
                    <!-- Username -->
                    <li>
                        <i18n-t v-if="$root.username != null" tag="span" keypath="signedInDisp" class="dropdown-item-text">
                            <strong>{{ $root.username }}</strong>
                        </i18n-t>
                        <span v-if="$root.username == null" class="dropdown-item-text">{{ $t("signedInDispDisabled") }}</span>
                    </li>

                    <li><hr class="dropdown-divider"></li>

                    <li>
                        <button class="dropdown-item" @click="scanFolder">
                            <font-awesome-icon icon="arrows-rotate" fixed-width class="me-1" /> {{ $t("scanFolder") }}
                        </button>
                    </li>

                    <li>
                        <router-link to="/settings/general" class="dropdown-item" :class="{ active: $route.path.includes('settings') }">
                            <font-awesome-icon icon="cog" fixed-width class="me-1" /> {{ $t("Settings") }}
                        </router-link>
                    </li>

                    <li>
                        <button class="dropdown-item" @click="$root.logout">
                            <font-awesome-icon icon="sign-out-alt" fixed-width class="me-1" /> {{ $t("Logout") }}
                        </button>
                    </li>
                </ul>
            </div>
        </header>

        <main>
            <div v-if="$root.socketIO.connecting" class="container mt-5">
                <h4>{{ $t("connecting...") }}</h4>
            </div>

            <router-view v-if="$root.loggedIn" />
            <Login v-if="! $root.loggedIn && $root.allowLoginDialog" />
        </main>
    </div>
</template>

<script>
import Login from "../components/Login.vue";
import { ALL_ENDPOINTS } from "../../../common/util-common";

export default {

    components: {
        Login,
    },

    data() {
        return {

        };
    },

    computed: {

    },

    watch: {

    },

    mounted() {

    },

    beforeUnmount() {

    },

    methods: {
        scanFolder() {
            this.$root.emitAgent(ALL_ENDPOINTS, "requestStackList", (res) => {
                this.$root.toastRes(res);
            });
        },
    },

};
</script>

<style lang="scss" scoped>
main {
    min-height: calc(100vh - 160px);
}

.app-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    min-height: 56px;
    padding: 0.4rem 1.5rem;
    margin-bottom: 1.25rem;
    background-color: var(--app-surface);
    border-bottom: 1px solid var(--bs-border-color);
}

.brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-right: auto;
    font-size: 16px;
    font-weight: 600;
    color: var(--bs-body-color);
    text-decoration: none;
}

.app-nav {
    display: flex;
    gap: 0.25rem;
}

.app-nav-link {
    padding: 0.45rem 0.75rem;
    border-radius: 6px;
    font-weight: 500;
    color: var(--bs-secondary-color);
    text-decoration: none;
    white-space: nowrap;

    &:hover {
        color: var(--bs-body-color);
        background-color: var(--bs-tertiary-bg);
    }

    &.active {
        color: var(--bs-body-color);
        background-color: var(--bs-secondary-bg);
    }
}

.lost-connection {
    padding: 5px;
    background-color: var(--bs-danger);
    color: white;
    position: fixed;
    width: 100%;
    z-index: 99999;
}

// Profile button with dropdown
.dropdown-profile-pic {
    user-select: none;

    .profile-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 10px 0 6px;
        border: 1px solid var(--bs-border-color);
        border-radius: 18px;
        color: var(--bs-body-color);
        background-color: var(--app-raised);

        &:hover {
            background-color: var(--bs-secondary-bg);
        }
    }

    .dropdown-item-text {
        font-size: 13px;
    }

    .profile-pic {
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        background-color: var(--bs-primary);
        width: 24px;
        height: 24px;
        border-radius: 50%;
        font-weight: 600;
        font-size: 11px;
    }
}

@media (max-width: 575.98px) {
    .app-header {
        padding: 0.4rem 0.75rem;
    }

    .app-nav-link span {
        display: none;
    }
}
</style>
