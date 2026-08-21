import { defineComponent } from "vue";

// The key of the saved layout in localStorage
const STORAGE_KEY = "dockgeModPanels";

// The step of the arrow keys on a handle
const SPLIT_KEY_STEP = 5;
const HEIGHT_KEY_STEP = 20;

/**
 * Read the saved layout. A broken value gives an empty layout.
 * @returns {object} the saved splitLeft and panelHeights
 */
function readStoredLayout() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return (stored && typeof stored === "object") ? stored : {};
    } catch (e) {
        return {};
    }
}

/**
 * The drag handles of the compose page. The divider between the two
 * file panels sets a width. The handle below a panel sets a height.
 * The layout stays in localStorage, so a reload keeps it.
 *
 * The page must give the divider the ref "split".
 */
export default defineComponent({
    data() {
        const stored = readStoredLayout();
        const heights = stored.panelHeights ?? {};
        return {
            // Width of the compose panel, as a percent of the split. 0 hides
            // the compose panel and 100 hides the override panel.
            splitLeft: (typeof stored.splitLeft === "number") ? stored.splitLeft : 50,
            // Heights that the user sets with the drag handles, in pixels.
            // A null gives the default layout.
            panelHeights: {
                files: heights.files ?? null,
                logs: heights.logs ?? null,
                editYaml: heights.editYaml ?? null,
                editOverride: heights.editOverride ?? null,
            },
        };
    },

    watch: {
        splitLeft() {
            this.storePanelLayout();
        },

        panelHeights: {
            handler() {
                this.storePanelLayout();
            },
            deep: true,
        },
    },

    methods: {
        /**
         * Write the layout to localStorage. A panel without a height is
         * not in the stored object.
         * @returns {void}
         */
        storePanelLayout() {
            const panelHeights = {};
            for (const key in this.panelHeights) {
                if (this.panelHeights[key]) {
                    panelHeights[key] = this.panelHeights[key];
                }
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                splitLeft: this.splitLeft,
                panelHeights,
            }));
        },

        /**
         * Start to drag the divider between the two panels. Pointer events
         * cover the mouse and touch.
         * @param {PointerEvent} e the pointerdown on the divider
         * @returns {void}
         */
        startSplitDrag(e) {
            e.preventDefault();
            document.addEventListener("pointermove", this.onSplitDrag);
            document.addEventListener("pointerup", this.endSplitDrag);
            document.addEventListener("pointercancel", this.endSplitDrag);
            document.body.classList.add("split-dragging");
        },

        /**
         * Move the divider with the pointer. The limits keep a part of each
         * panel on screen, because the buttons are the way to hide one.
         * @param {PointerEvent} e the pointermove
         * @returns {void}
         */
        onSplitDrag(e) {
            const box = this.$refs.split?.getBoundingClientRect();
            if (!box || box.width <= 0) {
                return;
            }
            const percent = ((e.clientX - box.left) / box.width) * 100;
            this.splitLeft = Math.min(90, Math.max(10, Math.round(percent)));
        },

        /**
         * Stop the drag.
         * @returns {void}
         */
        endSplitDrag() {
            document.removeEventListener("pointermove", this.onSplitDrag);
            document.removeEventListener("pointerup", this.endSplitDrag);
            document.removeEventListener("pointercancel", this.endSplitDrag);
            document.body.classList.remove("split-dragging");
        },

        /**
         * Put the divider at a set position. 0 hides the compose panel, 100
         * hides the override panel, and 50 gives both the same width.
         * @param {number} percent width of the compose panel
         * @returns {void}
         */
        setSplit(percent) {
            this.splitLeft = percent;
        },

        /**
         * Move the divider with the arrow keys. The limits are the same as
         * for a drag.
         * @param {KeyboardEvent} e the keydown on the divider
         * @returns {void}
         */
        onSplitKeydown(e) {
            let step;
            if (e.key === "ArrowLeft") {
                step = -SPLIT_KEY_STEP;
            } else if (e.key === "ArrowRight") {
                step = SPLIT_KEY_STEP;
            } else {
                return;
            }
            e.preventDefault();
            this.splitLeft = Math.min(90, Math.max(10, this.splitLeft + step));
        },

        /**
         * The style variable for a panel with a height from a drag handle.
         * The h-fixed class reads it. Without a height the panel keeps its
         * default layout.
         * @param {string} key name of the height
         * @returns {object} the style
         */
        panelVar(key) {
            const height = this.panelHeights[key];
            if (!height) {
                return {};
            }
            return {
                "--panel-h": height + "px",
            };
        },

        /**
         * Start to drag a height handle. The element above the handle is
         * the element that changes. Pointer events cover the mouse and
         * touch. A start height over the window height goes down to the
         * window height, so one movement can make a very tall editor
         * short.
         * @param {PointerEvent} event the pointerdown on the handle
         * @param {string} key name of the height
         * @returns {void}
         */
        startHeightDrag(event, key) {
            event.preventDefault();
            const target = event.currentTarget.previousElementSibling;
            if (!target) {
                return;
            }
            this.heightDrag = {
                key,
                startY: event.clientY,
                startHeight: Math.min(target.getBoundingClientRect().height, window.innerHeight),
                lastY: event.clientY,
                raf: null,
            };
            document.addEventListener("pointermove", this.onHeightDrag);
            document.addEventListener("pointerup", this.endHeightDrag);
            document.addEventListener("pointercancel", this.endHeightDrag);
            document.body.classList.add("vresize-dragging");
        },

        /**
         * Move a height handle with the pointer. The write waits for the
         * next animation frame, because each write makes the page lay out
         * again.
         * @param {PointerEvent} event the pointermove
         * @returns {void}
         */
        onHeightDrag(event) {
            if (!this.heightDrag) {
                return;
            }
            this.heightDrag.lastY = event.clientY;

            if (this.heightDrag.raf) {
                return;
            }
            this.heightDrag.raf = requestAnimationFrame(() => {
                if (!this.heightDrag) {
                    return;
                }
                this.heightDrag.raf = null;
                this.applyDragHeight();
            });
        },

        /**
         * Write the height that the last pointer position gives.
         * @returns {void}
         */
        applyDragHeight() {
            const drag = this.heightDrag;
            if (!drag) {
                return;
            }
            this.setPanelHeight(drag.key, drag.startHeight + drag.lastY - drag.startY);
        },

        /**
         * Write a height, in the limits of a drag.
         * @param {string} key name of the height
         * @param {number} height the height in pixels
         * @returns {void}
         */
        setPanelHeight(key, height) {
            this.panelHeights[key] = Math.min(window.innerHeight * 2, Math.max(150, Math.round(height)));
        },

        /**
         * Stop the height drag.
         * @returns {void}
         */
        endHeightDrag() {
            if (this.heightDrag) {
                // Take the last position of the pointer. A frame that
                // waits holds it, and a cancel alone would lose it.
                if (this.heightDrag.raf) {
                    cancelAnimationFrame(this.heightDrag.raf);
                    this.applyDragHeight();
                }
            }
            this.heightDrag = null;
            document.removeEventListener("pointermove", this.onHeightDrag);
            document.removeEventListener("pointerup", this.endHeightDrag);
            document.removeEventListener("pointercancel", this.endHeightDrag);
            document.body.classList.remove("vresize-dragging");
        },

        /**
         * Change a height with the arrow keys. A panel without a height
         * starts from the height it has on screen.
         * @param {KeyboardEvent} event the keydown on the handle
         * @param {string} key name of the height
         * @returns {void}
         */
        onHeightKeydown(event, key) {
            let step;
            if (event.key === "ArrowUp") {
                step = -HEIGHT_KEY_STEP;
            } else if (event.key === "ArrowDown") {
                step = HEIGHT_KEY_STEP;
            } else {
                return;
            }
            event.preventDefault();
            const target = event.currentTarget.previousElementSibling;
            const height = this.panelHeights[key] ?? target?.getBoundingClientRect().height;
            if (!height) {
                return;
            }
            this.setPanelHeight(key, height + step);
        },

        /**
         * Give a panel its default height back. The watcher removes the
         * stored value.
         * @param {string} key name of the height
         * @returns {void}
         */
        resetHeight(key) {
            this.panelHeights[key] = null;
        },
    },
});
