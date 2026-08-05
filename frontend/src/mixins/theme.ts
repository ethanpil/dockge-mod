import { defineComponent } from "vue";

export default defineComponent({
    data() {
        return {
            system: (window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light",
            userTheme: localStorage.theme,
            statusPageTheme: "light",
            forceStatusPageTheme: false,
            path: "",
        };
    },

    computed: {
        theme() {
            if (this.userTheme === "auto") {
                return this.system;
            }
            return this.userTheme;
        },

        isDark() {
            return this.theme === "dark";
        }
    },

    watch: {
        "$route.fullPath"(path) {
            this.path = path;
        },

        userTheme(to, from) {
            localStorage.theme = to;
        },

        styleElapsedTime(to, from) {
            localStorage.styleElapsedTime = to;
        },

        theme(to, from) {
            document.body.classList.remove(from);
            this.applyTheme();
        },

        userHeartbeatBar(to, from) {
            localStorage.heartbeatBarTheme = to;
        },

        heartbeatBarTheme(to, from) {
            document.body.classList.remove(from);
            document.body.classList.add(this.heartbeatBarTheme);
        }
    },

    mounted() {
        // Default Dark
        if (! this.userTheme) {
            this.userTheme = "dark";
        }

        this.applyTheme();

        // Follow OS theme changes live when the user selected "auto"
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
            this.system = e.matches ? "dark" : "light";
        });
    },

    methods: {
        /**
         * Apply the current theme to the document
         * @returns {void}
         */
        applyTheme() {
            document.body.classList.add(this.theme);
            document.documentElement.setAttribute("data-bs-theme", this.theme);
            this.updateThemeColorMeta();
        },

        /**
         * Update the theme color meta tag
         * @returns {void}
         */
        updateThemeColorMeta() {
            if (this.theme === "dark") {
                document.querySelector("#theme-color").setAttribute("content", "#212529");
            } else {
                document.querySelector("#theme-color").setAttribute("content", "#ffffff");
            }
        }
    }
});

