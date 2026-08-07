<template>
    <div>
        <h1 v-show="show" class="fs-3 mb-3">
            {{ $t("Settings") }}
        </h1>

        <div class="shadow-box shadow-box-settings">
            <div class="row">
                <div v-if="showSubMenu" class="settings-menu col-lg-3 col-md-5">
                    <router-link
                        v-for="(item, key) in subMenus"
                        :key="key"
                        :to="`/settings/${key}`"
                    >
                        <div class="menu-item">
                            {{ item.title }}
                        </div>
                    </router-link>

                    <!-- Logout Button -->
                    <a v-if="$root.isMobile && $root.loggedIn && $root.socket.token !== 'autoLogin'" class="logout" @click.prevent="$root.logout">
                        <div class="menu-item">
                            <font-awesome-icon icon="sign-out-alt" />
                            {{ $t("Logout") }}
                        </div>
                    </a>
                </div>
                <div class="settings-content col-lg-9 col-md-7">
                    <div v-if="currentPage" class="settings-content-header">
                        {{ subMenus[currentPage].title }}
                    </div>
                    <div class="mx-3">
                        <router-view v-slot="{ Component }">
                            <transition name="slide-fade" appear>
                                <component :is="Component" />
                            </transition>
                        </router-view>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { useRoute } from "vue-router";

export default {
    data() {
        return {
            show: true,
            settings: {},
            settingsLoaded: false,
        };
    },

    computed: {
        currentPage() {
            let pathSplit = useRoute().path.split("/");
            let pathEnd = pathSplit[pathSplit.length - 1];
            if (!pathEnd || pathEnd === "settings") {
                return null;
            }
            return pathEnd;
        },

        showSubMenu() {
            if (this.$root.isMobile) {
                return !this.currentPage;
            } else {
                return true;
            }
        },

        subMenus() {
            return {
                general: {
                    title: this.$t("general"),
                },
                appearance: {
                    title: this.$t("Appearance"),
                },
                security: {
                    title: this.$t("Security"),
                },
                globalEnv: {
                    title: this.$t("GlobalEnv"),
                },
                composeOverride: {
                    title: this.$t("composeOverrideTemplate"),
                },
                about: {
                    title: this.$t("About"),
                },
            };
        },
    },

    watch: {
        "$root.isMobile"() {
            this.loadGeneralPage();
        }
    },

    mounted() {
        this.loadSettings();
        this.loadGeneralPage();
    },

    methods: {

        /**
         * Load the general settings page
         * For desktop only, on mobile do nothing
         */
        loadGeneralPage() {
            if (!this.currentPage && !this.$root.isMobile) {
                this.$router.push("/settings/appearance");
            }
        },

        /** Load settings from server */
        loadSettings() {
            this.$root.getSocket().emit("getSettings", (res) => {
                this.settings = res.data;
                this.settingsLoaded = true;
            });
        },

        /**
         * Callback for saving settings
         * @callback saveSettingsCB
         * @param {Object} res Result of operation
         */

        /**
         * Save Settings
         * @param {saveSettingsCB} [callback]
         * @param {string} [currentPassword] Only need for disableAuth to true
         */
        saveSettings(callback, currentPassword) {
            let valid = this.validateSettings();
            if (valid.success) {
                this.$root.getSocket().emit("setSettings", this.settings, currentPassword, (res) => {
                    this.$root.toastRes(res);
                    this.loadSettings();

                    if (callback) {
                        callback();
                    }
                });
            } else {
                this.$root.toastError(valid.msg);
            }
        },

        /**
         * Ensure settings are valid
         * @returns {Object} Contains success state and error msg
         */
        validateSettings() {
            if (this.settings.keepDataPeriodDays < 0) {
                return {
                    success: false,
                    msg: this.$t("dataRetentionTimeError"),
                };
            }
            return {
                success: true,
                msg: "",
            };
        },
    }
};
</script>

<style lang="scss" scoped>
.shadow-box-settings {
    padding: 1rem;
    min-height: calc(100vh - 155px);
}

footer {
    color: var(--bs-secondary-color);
    font-size: 13px;
    margin-top: 20px;
    padding-bottom: 30px;
    text-align: center;
}

.settings-menu {
    a {
        text-decoration: none !important;
        color: var(--bs-body-color);
    }

    .active .menu-item,
    a:hover .menu-item {
        color: var(--bs-body-color);
    }

    .menu-item {
        border-radius: var(--bs-border-radius);
        margin: 0.25em;
        padding: 0.4em 0.8em;
        cursor: pointer;
        border-left-width: 0;
    }

    .menu-item:hover {
        background: var(--bs-tertiary-bg);
    }

    .active .menu-item {
        background: var(--bs-primary-bg-subtle);
        border-left: 3px solid var(--bs-primary);
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
    }
}

.settings-content {
    .settings-content-header {
        border-bottom: 1px solid var(--bs-border-color);
        margin-bottom: 0.75rem;
        padding: 0.25rem 1em 0.75rem;
        font-size: 1.25rem;
        font-weight: 600;

        .mobile & {
            padding: 15px 0 0 0;
        }
    }
}

.logout {
    color: var(--bs-danger) !important;
}
</style>
