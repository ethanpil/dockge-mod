<template>
    <div class="shadow-box">
        <div v-pre ref="terminal" class="main-terminal"></div>

        <!-- Right click menu. Ctrl+C and Ctrl+V go to the shell, so the
             terminal needs another way to reach the clipboard. -->
        <div v-if="menuOpen" ref="menu" class="term-menu" :style="{ top: menuY + 'px', left: menuX + 'px' }">
            <button type="button" class="term-menu-item" :disabled="!menuSelection" @click="menuCopy">
                <font-awesome-icon icon="copy" class="me-2" />{{ $t("copy") }}
            </button>
            <button v-if="canInput" type="button" class="term-menu-item" @click="menuPaste">
                <font-awesome-icon icon="paste" class="me-2" />{{ $t("paste") }}
            </button>
        </div>
    </div>
</template>

<script>
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TERMINAL_COLS, TERMINAL_ROWS } from "../../../common/util-common";

export default {
    /**
     * @type {Terminal}
     */
    terminal: null,
    components: {

    },
    props: {
        name: {
            type: String,
            required: true,
        },

        endpoint: {
            type: String,
            required: true,
        },

        // Require if mode is interactive
        stackName: {
            type: String,
            default: "",
        },

        // Require if mode is interactive
        serviceName: {
            type: String,
            default: "",
        },

        // Require if mode is interactive
        shell: {
            type: String,
            default: "bash",
        },

        rows: {
            type: Number,
            default: TERMINAL_ROWS,
        },

        cols: {
            type: Number,
            default: TERMINAL_COLS,
        },

        // Mode
        // displayOnly: Only display terminal output
        // mainTerminal: Allow input limited commands and output
        // interactive: Free input and output
        mode: {
            type: String,
            default: "displayOnly",
        }
    },
    emits: [ "has-data" ],
    data() {
        return {
            first: true,
            terminalInputBuffer: "",
            cursorPosition: 0,
            lastSentRows: null,
            lastSentCols: null,
            menuOpen: false,
            menuX: 0,
            menuY: 0,
            // Text that was selected when the menu opened. The menu takes the
            // focus, and the terminal drops its selection when that happens.
            menuSelection: "",
        };
    },
    computed: {
        /** True for the modes that send what the user types to a shell */
        canInput() {
            return this.mode === "mainTerminal" || this.mode === "interactive";
        },
    },
    watch: {
        // Report the size again when the name arrives after the mount
        name() {
            this.emitResize();
        },
    },
    created() {

    },
    mounted() {
        let cursorBlink = true;

        if (this.mode === "displayOnly") {
            cursorBlink = false;
        }

        this.terminal = new Terminal({
            fontSize: 14,
            fontFamily: "'JetBrains Mono', monospace",
            cursorBlink,
            cols: this.cols,
            rows: this.rows,
        });

        if (this.mode === "mainTerminal") {
            this.mainTerminalConfig();
        } else if (this.mode === "interactive") {
            this.interactiveTerminalConfig();
        }

        //this.terminal.loadAddon(new WebLinksAddon());

        // Bind to a div
        this.terminal.open(this.$refs.terminal);
        this.terminal.focus();

        // Add right-click context menu handler for paste
        this.$refs.terminal.addEventListener("contextmenu", this.handleContextMenu);

        // Ctrl+V reaches the hidden textarea of xterm as a paste event. The
        // component reads keys with onKey, which a paste does not raise.
        this.$refs.terminal.addEventListener("paste", this.handleNativePaste);

        // Add selection handler for copy to clipboard
        this.terminal.onSelectionChange(() => {
            this.handleSelection();
        });

        // Notify parent component when data is received
        this.terminal.onCursorMove(() => {
            console.debug("onData triggered");
            if (this.first) {
                this.$emit("has-data");
                this.first = false;
            }
        });

        this.bind();

        // Create a new Terminal
        if (this.mode === "mainTerminal") {
            this.$root.emitAgent(this.endpoint, "mainTerminal", this.name, (res) => {
                if (!res.ok) {
                    this.$root.toastRes(res);
                }
            });
        } else if (this.mode === "interactive") {
            console.debug("Create Interactive terminal:", this.name);
            this.$root.emitAgent(this.endpoint, "interactiveTerminal", this.stackName, this.serviceName, this.shell, (res) => {
                if (!res.ok) {
                    this.$root.toastRes(res);
                }
            });
        }
        // Fit the terminal width to the div container size after terminal is created.
        this.updateTerminalSize();
    },

    unmounted() {
        window.removeEventListener("resize", this.onResizeEvent); // Remove the resize event listener from the window object.
        this.$root.unbindTerminal(this.name);
        this.terminal.dispose();
        this.$refs.terminal?.removeEventListener("contextmenu", this.handleContextMenu);
        this.$refs.terminal?.removeEventListener("paste", this.handleNativePaste);
        this.closeMenu();
    },

    methods: {
        bind(endpoint, name) {
            // Workaround: normally this.name should be set, but it is not sometimes, so we use the parameter, but eventually this.name and name must be the same name
            if (name) {
                this.$root.unbindTerminal(name);
                this.$root.bindTerminal(endpoint, name, this.terminal);
                console.debug("Terminal bound via parameter: " + name);
            } else if (this.name) {
                this.$root.unbindTerminal(this.name);
                this.$root.bindTerminal(this.endpoint, this.name, this.terminal);
                console.debug("Terminal bound: " + this.name);
            } else {
                console.debug("Terminal name not set");
            }
        },

        removeInput() {
            const textAfterCursorLength = this.terminalInputBuffer.length - this.cursorPosition;
            const spaces = " ".repeat(textAfterCursorLength);
            const backspaceCount = this.terminalInputBuffer.length;
            const backspaces = "\b \b".repeat(backspaceCount);
            this.cursorPosition = 0;
            this.terminal.write(spaces + backspaces);
            this.terminalInputBuffer = "";
        },

        clearCurrentLine() {
            // Move cursor to the beginning of the input and clear it
            const backspaces = "\b".repeat(this.cursorPosition);
            const spaces = " ".repeat(this.terminalInputBuffer.length);
            const moreBackspaces = "\b".repeat(this.terminalInputBuffer.length);
            this.terminal.write(backspaces + spaces + moreBackspaces);
        },

        mainTerminalConfig() {
            this.terminal.onKey(e => {
                // Optional: keep for debugging
                // console.debug("Encode: " + JSON.stringify(e.key));

                if (e.key === "\r") {
                    // Return if no input
                    if (this.terminalInputBuffer.length === 0) {
                        return;
                    }

                    const buffer = this.terminalInputBuffer;

                    // Remove the input from the terminal
                    this.removeInput();

                    this.$root.emitAgent(this.endpoint, "terminalInput", this.name, buffer + e.key, (err) => {
                        this.$root.toastError(err.msg);
                    });
                } else if (e.key === "\u007F") {      // Backspace
                    if (this.cursorPosition > 0) {
                        // Remove character to the left of cursor
                        const beforeCursor = this.terminalInputBuffer.slice(0, this.cursorPosition - 1);
                        const afterCursor = this.terminalInputBuffer.slice(this.cursorPosition);
                        this.terminalInputBuffer = beforeCursor + afterCursor;
                        this.cursorPosition--;

                        // Redraw the line
                        this.terminal.write("\b" + afterCursor + " \b".repeat(afterCursor.length + 1));
                    }
                } else if (e.key === "\u001B\u005B\u0033\u007E") { // Delete key
                    if (this.cursorPosition < this.terminalInputBuffer.length) {
                        // Remove character to the right of cursor
                        const beforeCursor = this.terminalInputBuffer.slice(0, this.cursorPosition);
                        const afterCursor = this.terminalInputBuffer.slice(this.cursorPosition + 1);
                        this.terminalInputBuffer = beforeCursor + afterCursor;

                        // Redraw the line from cursor position
                        this.terminal.write(afterCursor + " \b".repeat(afterCursor.length + 1));
                    }
                } else if (e.key === "\u001B\u005B\u0041" || e.key === "\u001B\u005B\u0042") {      // UP OR DOWN
                    // Do nothing
                } else if (e.key === "\u001B\u005B\u0043") {      // RIGHT
                    if (this.cursorPosition < this.terminalInputBuffer.length) {
                        this.terminal.write(this.terminalInputBuffer[this.cursorPosition]);
                        this.cursorPosition++;
                    }
                } else if (e.key === "\u001B\u005B\u0044") {      // LEFT
                    if (this.cursorPosition > 0) {
                        this.terminal.write("\b");
                        this.cursorPosition--;
                    }
                } else if (e.key === "\u0003") {      // Ctrl + C
                    console.debug("Ctrl + C");
                    this.$root.emitAgent(this.endpoint, "terminalInput", this.name, e.key);
                    this.removeInput();
                } else if (e.key === "\u0016" || (e.domEvent?.ctrlKey && e.key.toLowerCase() === "v")) {      // Ctrl + V
                    this.handlePaste();
                } else if (e.key === "\u0009" || e.key.startsWith("\u001B")) {      // TAB or other special keys
                    // Do nothing
                } else {
                    const textBeforeCursor = this.terminalInputBuffer.slice(0, this.cursorPosition);
                    const textAfterCursor = this.terminalInputBuffer.slice(this.cursorPosition);
                    this.terminalInputBuffer = textBeforeCursor + e.key + textAfterCursor;
                    this.terminal.write(e.key + textAfterCursor + "\b".repeat(textAfterCursor.length));
                    this.cursorPosition++;
                }
            });
        },

        interactiveTerminalConfig() {
            this.terminal.onKey(e => {
                // Handle Ctrl+V for paste
                if (e.key === "\u0016" || (e.domEvent?.ctrlKey && e.key.toLowerCase() === "v")) {
                    this.handlePaste();
                    return;
                }

                this.$root.emitAgent(this.endpoint, "terminalInput", this.name, e.key, (res) => {
                    if (!res.ok) {
                        this.$root.toastRes(res);
                    }
                });
            });
        },

        /**
         * Update the terminal size to fit the container size.
         *
         * If the terminalFitAddOn is not created, creates it, loads it and then fits the terminal to the appropriate size.
         * It then addes an event listener to the window object to listen for resize events and calls the fit method of the terminalFitAddOn.
         */
        updateTerminalSize() {
            if (!Object.hasOwn(this, "terminalFitAddOn")) {
                this.terminalFitAddOn = new FitAddon();
                this.terminal.loadAddon(this.terminalFitAddOn);
                window.addEventListener("resize", this.onResizeEvent);
            }
            this.terminalFitAddOn.fit();

            // Push the fitted size to the backend. Without this the pty keeps the
            // hardcoded default width until the user happens to resize the window,
            // which makes output wrap mid-word on any wider viewport.
            this.emitResize();
        },
        /**
         * Handles the resize event of the terminal component.
         */
        onResizeEvent() {
            this.terminalFitAddOn.fit();
            this.emitResize();
        },
        /**
         * Report the fitted size, skipping the send when it has not changed —
         * a window resize event fires on every mounted terminal, including
         * ones whose box did not move.
         */
        emitResize() {
            // The parent can set the name after this component mounts, which
            // bind() also works around. A size for an empty name goes to a
            // terminal that does not exist, and it must not stop the correct
            // message that the name watcher sends later.
            if (!this.name) {
                return;
            }

            const rows = this.terminal.rows;
            const cols = this.terminal.cols;
            if (rows === this.lastSentRows && cols === this.lastSentCols) {
                return;
            }
            this.lastSentRows = rows;
            this.lastSentCols = cols;
            this.$root.emitAgent(this.endpoint, "terminalResize", this.name, rows, cols);
        },

        /**
         * Read the clipboard and send what it holds.
         *
         * Only a page on https or on localhost has navigator.clipboard. On
         * any other page the browser gives the clipboard to a paste event
         * only, so tell the user to use the keyboard.
         * @returns {Promise<void>}
         */
        async handlePaste() {
            if (!navigator.clipboard?.readText) {
                this.$root.toastError(this.$t("pasteNeedsKeyboard"));
                return;
            }

            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    this.pasteText(text);
                }
            } catch (error) {
                console.error("Failed to read from clipboard:", error);
                this.$root.toastError(this.$t("pasteNeedsKeyboard"));
            }
        },

        /**
         * Paste text into the terminal based on current mode
         */
        pasteText(text) {
            if (this.mode === "mainTerminal") {
                // For main terminal, insert text at current cursor position
                const beforeCursor = this.terminalInputBuffer.slice(0, this.cursorPosition);
                const afterCursor = this.terminalInputBuffer.slice(this.cursorPosition);

                // Update the buffer with inserted text
                this.terminalInputBuffer = beforeCursor + text + afterCursor;

                // Clear the current line and rewrite it
                this.clearCurrentLine();
                this.terminal.write(this.terminalInputBuffer);

                // Move cursor to the correct position (after the pasted text)
                this.cursorPosition += text.length;
                const backspaces = "\b".repeat(afterCursor.length);
                this.terminal.write(backspaces);

            } else if (this.mode === "interactive") {
                // For interactive terminal, send directly to server
                this.$root.emitAgent(this.endpoint, "terminalInput", this.name, text, (res) => {
                    if (!res.ok) {
                        this.$root.toastRes(res);
                    }
                });
            }
        },

        /**
         * Open the right click menu at the pointer.
         * @param {MouseEvent} event the contextmenu event
         * @returns {void}
         */
        handleContextMenu(event) {
            event.preventDefault();

            // Read the selection now. The menu button takes the focus, and
            // the terminal clears its selection when it loses the focus.
            this.menuSelection = this.terminal.getSelection() ?? "";
            this.menuX = event.clientX;
            this.menuY = event.clientY;
            this.menuOpen = true;

            document.addEventListener("mousedown", this.closeMenu);
            document.addEventListener("keydown", this.onMenuKeydown);
            window.addEventListener("resize", this.closeMenu);
            window.addEventListener("scroll", this.closeMenu, true);
        },

        /**
         * Close the right click menu.
         * @param {Event} [e] the event that closes the menu
         * @returns {void}
         */
        closeMenu(e) {
            // A press on the menu must reach the button. mousedown comes
            // before click, and the button is gone if the menu closes first.
            if (e?.type === "mousedown" && this.$refs.menu?.contains(e.target)) {
                return;
            }

            if (!this.menuOpen) {
                return;
            }
            this.menuOpen = false;
            document.removeEventListener("mousedown", this.closeMenu);
            document.removeEventListener("keydown", this.onMenuKeydown);
            window.removeEventListener("resize", this.closeMenu);
            window.removeEventListener("scroll", this.closeMenu, true);
        },

        /**
         * Close the menu with Escape.
         * @param {KeyboardEvent} e the keydown event
         * @returns {void}
         */
        onMenuKeydown(e) {
            if (e.key === "Escape") {
                this.closeMenu();
            }
        },

        /**
         * Copy the selected text from the menu.
         * @returns {void}
         */
        menuCopy() {
            const text = this.menuSelection;
            this.closeMenu();
            if (text) {
                this.copyToClipboard(text);
            }
        },

        /**
         * Paste from the menu.
         * @returns {Promise<void>}
         */
        async menuPaste() {
            this.closeMenu();
            await this.handlePaste();
        },

        /**
         * Send text that the browser pasted. A page that is not on https has
         * no clipboard object, so this event is the only way to paste there.
         * @param {ClipboardEvent} e the paste event
         * @returns {void}
         */
        handleNativePaste(e) {
            if (!this.canInput) {
                return;
            }
            const text = e.clipboardData?.getData("text");
            if (text) {
                e.preventDefault();
                this.pasteText(text);
            }
        },

        /**
         * Handle text selection in terminal - copy to clipboard
         */
        handleSelection() {
            const selectedText = this.terminal.getSelection();
            if (selectedText && selectedText.length > 0) {
                this.copyToClipboard(selectedText);
            }
        },

        /**
         * Copy text to the clipboard.
         *
         * A page that is not on https has no navigator.clipboard. The old
         * execCommand still works there, so use it as a second choice.
         * @param {string} text the text to copy
         * @returns {Promise<void>}
         */
        async copyToClipboard(text) {
            if (navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(text);
                    return;
                } catch (error) {
                    console.error("Failed to copy to clipboard:", error);
                }
            }

            const box = document.createElement("textarea");
            box.value = text;
            box.setAttribute("readonly", "");
            box.style.position = "fixed";
            box.style.opacity = "0";
            document.body.appendChild(box);
            box.select();
            try {
                document.execCommand("copy");
            } catch (error) {
                console.error("Failed to copy to clipboard:", error);
            }
            document.body.removeChild(box);
        },
    }
};
</script>

<style scoped lang="scss">
.shadow-box {
    padding: 0.5rem;
}

.main-terminal {
    height: 100%;
}

// Fixed, so a terminal inside a box that scrolls cannot cut the menu off
.term-menu {
    position: fixed;
    z-index: 1080;
    min-width: 140px;
    padding: 0.25rem 0;
    background-color: var(--bs-body-bg);
    border: 1px solid var(--bs-border-color);
    border-radius: var(--bs-border-radius);
    box-shadow: 0 0.5rem 1rem rgb(0 0 0 / 18%);
}

.term-menu-item {
    display: block;
    width: 100%;
    padding: 0.3rem 0.9rem;
    border: 0;
    background: transparent;
    text-align: left;
    font-size: 13px;
    color: var(--bs-body-color);

    &:hover:not(:disabled) {
        background-color: var(--bs-tertiary-bg);
    }

    &:disabled {
        color: var(--bs-secondary-color);
    }
}
</style>

<style lang="scss">
.terminal {
    background-color: black !important;
    height: 100%;
}
</style>
