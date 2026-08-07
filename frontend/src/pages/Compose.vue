<template>
    <transition name="slide-fade" appear>
        <div>
            <div class="title-row mb-2">
                <h1 v-if="isAdd" class="fs-4 mb-0">{{ $t("compose") }}</h1>
                <template v-else>
                    <Uptime :stack="globalStack" :pill="true" />
                    <h1 class="fs-4 mb-0 title-name">{{ stack.name }}</h1>
                    <!-- Outside the title, which truncates with an ellipsis -->
                    <span v-if="isDirty" class="dirty-dot" :title="$t('unsavedChanges')" role="img" :aria-label="$t('unsavedChanges')">&#9679;</span>
                    <span v-if="$root.agentCount > 1 && endpoint !== ''" class="agent-name">
                        ({{ endpointDisplay }})
                    </span>
                    <span v-if="!isEditMode && serviceCount > 0" class="panel-note d-none d-sm-inline">{{ serviceCount }} {{ $tc("container", serviceCount).toLowerCase() }}</span>
                </template>

                <div v-if="stack.isManagedByDockge" class="toolbar ms-auto">
                    <div class="btn-group btn-group-sm me-2" role="group">
                        <button v-if="isEditMode" class="btn btn-primary" :disabled="processing" @click="deployStack">
                            <font-awesome-icon icon="rocket" class="me-1" />
                            {{ $t("deployStack") }}
                        </button>

                        <button
                            v-if="isEditMode"
                            class="btn"
                            :class="isDirty ? 'btn-success' : 'btn-normal'"
                            :disabled="processing || (!isDirty && !isAdd)"
                            @click="saveStackAndExit"
                        >
                            <font-awesome-icon icon="save" class="me-1" />
                            {{ $t("saveStackDraft") }}<template v-if="isDirty"> &#9679;</template>
                        </button>

                        <button v-if="!isEditMode" class="btn btn-secondary" :disabled="processing" @click="enableEditMode">
                            <font-awesome-icon icon="pen" class="me-1" />
                            {{ $t("editStack") }}
                        </button>

                        <button v-if="!isEditMode && !active" class="btn btn-primary" :disabled="processing" @click="startStack">
                            <font-awesome-icon icon="play" class="me-1" />
                            {{ $t("startStack") }}
                        </button>

                        <button v-if="!isEditMode && active" class="btn btn-normal" :disabled="processing" @click="restartStack">
                            <font-awesome-icon icon="rotate" class="me-1" />
                            {{ $t("restartStack") }}
                        </button>

                        <button v-if="!isEditMode" class="btn btn-normal" :disabled="processing" @click="updateStack">
                            <font-awesome-icon icon="cloud-arrow-down" class="me-1" />
                            {{ $t("updateStack") }}
                        </button>

                        <button v-if="!isEditMode && active" class="btn btn-normal" :disabled="processing" @click="stopStack">
                            <font-awesome-icon icon="stop" class="me-1" />
                            {{ $t("stopStack") }}
                        </button>

                        <button type="button" class="btn btn-normal dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false">
                            <span class="visually-hidden">{{ $t("downStack") }}</span>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li>
                                <button type="button" class="dropdown-item" @click="downStack">
                                    <font-awesome-icon icon="stop" class="me-1" />
                                    {{ $t("downStack") }}
                                </button>
                            </li>
                        </ul>
                    </div>

                    <button v-if="isEditMode && !isAdd" class="btn btn-sm btn-normal" :disabled="processing" @click="discardStack">{{ $t("discardStack") }}</button>
                    <button v-if="!isEditMode" class="btn btn-sm btn-outline-danger" :disabled="processing" @click="$refs.confirmDeleteStack.show()">
                        <font-awesome-icon icon="trash" class="me-1" />
                        {{ $t("deleteStack") }}
                    </button>
                </div>
            </div>

            <!-- URLs -->
            <div v-if="urls.length > 0" class="mb-3">
                <a v-for="(urlItem, index) in urls" :key="index" target="_blank" :href="urlItem.url" class="text-decoration-none">
                    <span class="badge bg-secondary me-2">{{ urlItem.display }}</span>
                </a>
            </div>

            <!-- Progress Terminal -->
            <transition name="slide-fade" appear>
                <Terminal
                    v-show="showProgressTerminal"
                    ref="progressTerminal"
                    class="mb-3 terminal"
                    :name="terminalName"
                    :endpoint="endpoint"
                    :rows="progressTerminalRows"
                    @has-data="showProgressTerminal = true; submitted = true;"
                ></Terminal>
            </transition>

            <div v-if="stack.isManagedByDockge" class="row">
                <div class="col-12" :class="{ 'view-col': !isEditMode }">
                    <!-- General -->
                    <div v-if="isAdd" class="panel">
                        <div class="panel-head"><span class="panel-title">{{ $t("general") }}</span></div>
                        <div class="panel-body">
                            <!-- Stack Name -->
                            <div>
                                <label for="name" class="form-label">{{ $t("stackName") }}</label>
                                <input id="name" v-model="stack.name" type="text" class="form-control" required @blur="stackNameToLowercase">
                                <div class="form-text">{{ $t("Lowercase only") }}</div>
                            </div>

                            <!-- Endpoint -->
                            <div class="mt-3">
                                <label for="name" class="form-label">{{ $t("dockgeAgent") }}</label>
                                <select v-model="stack.endpoint" class="form-select">
                                    <option v-for="(agent, agentEndpoint) in $root.agentList" :key="agentEndpoint" :value="agentEndpoint" :disabled="$root.agentStatusList[agentEndpoint] != 'online'">
                                        ({{ $root.agentStatusList[agentEndpoint] }}) {{ (agent.name !== '') ? agent.name : agent.url || $t("Current") }}
                                    </option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Containers (edit mode): editable cards -->
                    <div v-if="isEditMode" class="panel">
                        <div class="panel-head"><span class="panel-title">{{ $tc("container", 2) }}</span></div>
                        <div class="panel-body">
                            <div class="input-group input-group-sm mb-2">
                                <input
                                    v-model="newContainerName"
                                    :placeholder="$t(`New Container Name...`)"
                                    class="form-control"
                                    @keyup.enter="addContainer"
                                />
                                <button class="btn btn-primary" @click="addContainer">
                                    {{ $t("addContainer") }}
                                </button>
                            </div>

                            <div ref="containerList">
                                <Container
                                    v-for="(service, name) in jsonConfig.services"
                                    :key="name"
                                    :name="name"
                                    :is-edit-mode="isEditMode"
                                    :default-open="serviceCount < 3"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- Containers (view mode): dense table, stacked cards on mobile -->
                    <div v-if="!isEditMode && hasContainers" class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ $tc("container", 2) }}</span>
                            <span class="panel-note">{{ containerRows.length }}</span>
                        </div>

                        <!-- One layout renders at a time. Both together would
                             double the rows that every 5 second poll patches. -->
                        <div v-if="wideLayout" class="ctable-scroll">
                            <table class="ctable">
                                <thead>
                                    <tr>
                                        <th class="c-svc">{{ $t("service") }}</th>
                                        <th class="c-img">{{ $t("dockerImage") }}</th>
                                        <th class="c-state">{{ $t("state") }}</th>
                                        <th class="c-up">{{ $t("uptime") }}</th>
                                        <th class="c-addr">{{ $t("ip") }} / {{ $tc("port", 2) }}</th>
                                        <th class="c-num">{{ $t("CPU") }}</th>
                                        <th class="c-num">{{ $t("memory") }}</th>
                                        <th class="c-num c-net">{{ $t("networkIO") }}</th>
                                        <th class="c-num c-blk">{{ $t("blockIO") }}</th>
                                        <th class="c-act"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="row in containerRows" :key="row.key">
                                        <td class="c-svc">
                                            <span class="status-dot me-2" :class="'dot-' + row.color"></span><strong class="svc-name" :title="row.service">{{ row.service }}</strong>
                                            <div v-if="row.showInstanceName" class="cell-sub">{{ row.instanceName }}</div>
                                        </td>
                                        <td class="c-img cell-muted">{{ imageOf(row.service) }}</td>
                                        <td class="c-state"><span class="badge state-badge" :class="stateBadgeClass(row.status)">{{ row.status }}</span></td>
                                        <td class="c-up mono">{{ row.uptime ?? "—" }}</td>
                                        <td class="c-addr mono">
                                            <div v-if="row.ip">{{ row.ip }}</div>
                                            <div v-for="link in row.portLinks" :key="link.text" class="cell-muted">
                                                <a :href="link.url" target="_blank" rel="noopener" class="port-link">{{ link.text }}</a>
                                            </div>
                                            <template v-if="!row.ip && row.portLinks.length === 0">—</template>
                                        </td>
                                        <td class="c-num mono">{{ row.stat?.CPUPerc ?? "—" }}</td>
                                        <td class="c-num mono" :title="memoryTitleOf(row.stat)">
                                            <template v-if="row.memUsed">
                                                <div>{{ row.memUsed }}</div>
                                                <div v-if="row.memPerc" class="cell-muted">{{ row.memPerc }}</div>
                                            </template>
                                            <template v-else>—</template>
                                        </td>
                                        <td class="c-num c-net mono cell-muted">
                                            <template v-if="row.net">
                                                <div><span class="io-k">I</span>{{ row.net.in }}</div>
                                                <div><span class="io-k">O</span>{{ row.net.out }}</div>
                                            </template>
                                            <template v-else>—</template>
                                        </td>
                                        <td class="c-num c-blk mono cell-muted">
                                            <template v-if="row.blk">
                                                <div><span class="io-k">I</span>{{ row.blk.in }}</div>
                                                <div><span class="io-k">O</span>{{ row.blk.out }}</div>
                                            </template>
                                            <template v-else>—</template>
                                        </td>
                                        <td class="c-act">
                                            <!-- Actions are service-scoped (docker compose has no per-replica
                                             stop), so they render once per service, on its first row. -->
                                            <ContainerActions
                                                v-if="row.first"
                                                :status="row.status"
                                                :service-count="serviceCount"
                                                :processing="processing"
                                                :bash-to="bashLink(row.service)"
                                                @start="startService(row.service)"
                                                @restart="restartService(row.service)"
                                                @stop="stopService(row.service)"
                                            />
                                            <span v-else class="cell-muted">—</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Narrow screens: stacked cards -->
                        <div v-else>
                            <div v-for="row in containerRows" :key="row.key" class="mcard">
                                <div class="mcard-top">
                                    <span class="status-dot" :class="'dot-' + row.color"></span>
                                    <strong class="text-truncate">{{ row.service }}</strong>
                                    <span class="badge state-badge" :class="stateBadgeClass(row.status)">{{ row.status }}</span>
                                    <ContainerActions
                                        v-if="row.first"
                                        class="ms-auto"
                                        :status="row.status"
                                        :service-count="serviceCount"
                                        :processing="processing"
                                        :bash-to="bashLink(row.service)"
                                        @start="startService(row.service)"
                                        @restart="restartService(row.service)"
                                        @stop="stopService(row.service)"
                                    />
                                </div>
                                <div class="mcard-img cell-muted">{{ imageOf(row.service) }}</div>
                                <div class="mcard-grid">
                                    <span class="k">{{ $t("uptime") }}</span><span class="mono">{{ row.uptime ?? "—" }}</span>
                                    <span class="k">{{ $t("ip") }}</span><span class="mono">{{ row.ip || "—" }}</span>
                                    <span class="k">{{ $tc("port", 2) }}</span><span class="mono">
                                        <template v-if="row.portLinks.length">
                                            <div v-for="link in row.portLinks" :key="link.text">
                                                <a :href="link.url" target="_blank" rel="noopener" class="port-link">{{ link.text }}</a>
                                            </div>
                                        </template>
                                        <template v-else>—</template>
                                    </span>
                                    <span class="k">{{ $t("CPU") }}</span><span class="mono">{{ row.stat?.CPUPerc ?? "—" }}</span>
                                    <span class="k">{{ $t("memory") }}</span><span class="mono">{{ row.stat?.MemUsage ?? "—" }}</span>
                                    <span class="k">{{ $t("networkIO") }}</span><span class="mono">{{ row.stat?.NetIO ?? "—" }}</span>
                                    <span class="k">{{ $t("blockIO") }}</span><span class="mono">{{ row.stat?.BlockIO ?? "—" }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button v-if="false && isEditMode && jsonConfig.services && Object.keys(jsonConfig.services).length > 0" class="btn btn-normal mb-3" @click="addContainer">{{ $t("addContainer") }}</button>

                    <!-- General -->
                    <div v-if="isEditMode" class="panel">
                        <div class="panel-head"><span class="panel-title">{{ $t("extra") }}</span></div>
                        <div class="panel-body">
                            <!-- URLs -->
                            <div class="mb-2">
                                <label class="form-label">
                                    {{ $tc("url", 2) }}
                                </label>
                                <ArrayInput name="urls" :display-name="$t('url')" placeholder="https://" object-type="x-dockge" />
                            </div>
                        </div>
                    </div>

                    <!-- Logs + compose.yaml, side by side, filling the rest of the viewport -->
                    <div v-show="!isEditMode" ref="split" class="panel-split" :style="{ '--split-left': splitLeft + '%' }">
                        <div class="panel split-a" :class="{ pop: expandedPanel === 'logs', 'split-gone': splitLeft === 0 }">
                            <div class="panel-head">
                                <span class="panel-title">{{ $t("logs") }}</span>
                                <span class="panel-note">{{ stack.name }}</span>
                                <button class="mini-btn expand-btn" :title="expandedPanel === 'logs' ? $t('cancel') : $t('expand')" @click="toggleExpand('logs')">
                                    <font-awesome-icon :icon="expandedPanel === 'logs' ? 'compress' : 'expand'" />
                                </button>
                            </div>
                            <div class="panel-fill">
                                <Terminal
                                    ref="combinedTerminal"
                                    class="terminal"
                                    :name="combinedTerminalName"
                                    :endpoint="endpoint"
                                    :rows="combinedTerminalRows"
                                    :cols="combinedTerminalCols"
                                ></Terminal>
                            </div>
                        </div>

                        <!-- Drag to change the width. The buttons hide one
                             side or put the divider back in the middle. -->
                        <div class="split-bar" @mousedown="startSplitDrag">
                            <div class="split-actions">
                                <button type="button" class="split-btn" :title="$t('hideLeftPanel')" @mousedown.stop @click="setSplit(0)">&lsaquo;</button>
                                <button type="button" class="split-btn" :title="$t('equalPanels')" @mousedown.stop @click="setSplit(50)">&#9474;</button>
                                <button type="button" class="split-btn" :title="$t('hideRightPanel')" @mousedown.stop @click="setSplit(100)">&rsaquo;</button>
                            </div>
                        </div>

                        <div class="panel split-b" :class="{ pop: expandedPanel === 'yaml', 'split-gone': splitLeft === 100 }">
                            <div class="panel-head">
                                <span class="panel-title">{{ stack.composeFileName }}</span>
                                <button class="mini-btn expand-btn" :title="expandedPanel === 'yaml' ? $t('cancel') : $t('expand')" @click="toggleExpand('yaml')">
                                    <font-awesome-icon :icon="expandedPanel === 'yaml' ? 'compress' : 'expand'" />
                                </button>
                            </div>
                            <div class="panel-fill editor-fill">
                                <code-mirror
                                    v-if="!isEditMode"
                                    v-model="stack.composeYAML"
                                    :extensions="extensions"
                                    minimal
                                    wrap="true"
                                    dark="true"
                                    tab="true"
                                    :disabled="true"
                                    :hasFocus="editorFocus"
                                />
                            </div>
                        </div>
                    </div>
                    <div v-if="expandedPanel" class="panel-backdrop" @click="toggleExpand(expandedPanel)"></div>
                </div>
                <div v-if="isEditMode" class="col-12">
                    <!-- YAML editor -->
                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ stack.composeFileName }}</span>
                            <span v-if="yamlError" class="panel-note text-danger">{{ yamlError }}</span>
                        </div>
                        <div class="editor-box edit-mode">
                            <code-mirror
                                ref="editor"
                                v-model="stack.composeYAML"
                                :extensions="extensions"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                                :disabled="!isEditMode"
                                :hasFocus="editorFocus"
                                @change="yamlCodeChange"
                            />
                        </div>
                    </div>

                    <!-- ENV editor -->
                    <div class="panel">
                        <div class="panel-head"><span class="panel-title">.env</span></div>
                        <div class="editor-box edit-mode">
                            <code-mirror
                                ref="editor"
                                v-model="stack.composeENV"
                                :extensions="extensionsEnv"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                                :disabled="!isEditMode"
                                :hasFocus="editorFocus"
                                @change="yamlCodeChange"
                            />
                        </div>
                    </div>

                    <!-- Volumes -->
                    <div v-if="false">
                        <h4 class="fs-5 mb-2">{{ $tc("volume", 2) }}</h4>
                        <div class="shadow-box big-padding mb-3">
                        </div>
                    </div>

                    <!-- Networks -->
                    <div class="panel">
                        <div class="panel-head"><span class="panel-title">{{ $tc("network", 2) }}</span></div>
                        <div class="panel-body">
                            <NetworkInput />
                        </div>
                    </div>

                    <!-- <div class="shadow-box big-padding mb-3">
                        <div class="mb-3">
                            <label for="name" class="form-label"> Search Templates</label>
                            <input id="name" v-model="name" type="text" class="form-control" placeholder="Search..." required>
                        </div>

                        <prism-editor v-if="false" v-model="yamlConfig" class="yaml-editor" :highlight="highlighter" line-numbers @input="yamlCodeChange"></prism-editor>
                    </div>-->
                </div>
            </div>

            <div v-if="!stack.isManagedByDockge && !processing">
                {{ $t("stackNotManagedByDockgeMsg") }}
            </div>

            <!-- Delete Dialog -->
            <Confirm ref="confirmDeleteStack" btn-style="btn-danger" :yes-text="$t('deleteStack')" :no-text="$t('cancel')" @yes="deleteDialog">
                {{ $t("deleteStackMsg") }}
            </Confirm>

            <!-- Unsaved changes dialog: shown when the user leaves edit mode
                 with changes that are not saved. Escape, the backdrop, and
                 the X button all mean "stay", so the pending navigation
                 always gets an answer. The buttons do not close the dialog,
                 because a save keeps it on screen until the server replies. -->
            <Confirm
                ref="confirmLeave"
                :title="$t('unsavedChanges')"
                btn-style="btn-success"
                :yes-text="$t('saveAndLeave')"
                :alt-text="$t('discardAndLeave')"
                :no-text="$t('stay')"
                :no-on-dismiss="true"
                :busy="processing"
                :keep-open="true"
                @yes="resolveLeave('save')"
                @alt="resolveLeave('discard')"
                @no="resolveLeave('stay')"
            >
                <i18n-t keypath="unsavedChangesMsg" tag="span">
                    <strong>{{ stack.name }}</strong>
                </i18n-t>
            </Confirm>
        </div>
    </transition>
</template>

<script>
import CodeMirror from "vue-codemirror6";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { dracula as editorTheme } from "thememirror";
import { lineNumbers, EditorView } from "@codemirror/view";
import { linter, lintGutter } from "@codemirror/lint";
import { parseDocument, Document } from "yaml";

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import {
    COMBINED_TERMINAL_COLS,
    COMBINED_TERMINAL_ROWS,
    copyYAMLComments, envsubstYAML,
    getCombinedTerminalName,
    getComposeTerminalName,
    parseDockerPort,
    PROGRESS_TERMINAL_ROWS,
    RUNNING
} from "../../../common/util-common";
import { formatPorts, formatUptime } from "../util-frontend";
import NetworkInput from "../components/NetworkInput.vue";
import Confirm from "../components/Confirm.vue";
import Container from "../components/Container.vue";
import ContainerActions from "../components/ContainerActions.vue";
import Terminal from "../components/Terminal.vue";
import Uptime from "../components/Uptime.vue";
import ArrayInput from "../components/ArrayInput.vue";
import dotenv from "dotenv";
import { ref } from "vue";

const template = `
services:
  nginx:
    image: nginx:latest
    restart: unless-stopped
    ports:
      - "8080:80"
`;
const envDefault = "# VARIABLE=value #comment";

let yamlErrorTimeout = null;

let serviceStatusTimeout = null;
let dockerStatsTimeout = null;

export default {
    components: {
        NetworkInput,
        FontAwesomeIcon,
        CodeMirror,
        Confirm,
        Container,
        ContainerActions,
        Terminal,
        Uptime,
        ArrayInput,
    },
    beforeRouteUpdate(to, from, next) {
        this.exitConfirm(next);
    },
    beforeRouteLeave(to, from, next) {
        this.exitConfirm(next);
    },
    setup() {
        const editorFocus = ref(false);

        const focusEffectHandler = (state, focusing) => {
            editorFocus.value = focusing;
            return null;
        };

        // Marks each YAML syntax error at its position, with a gutter icon
        // and an underline. The message shows on hover.
        const yamlLinter = linter((view) => {
            const max = view.state.doc.length;
            const doc = parseDocument(view.state.doc.toString());
            return doc.errors.map((e) => {
                const from = Math.min(e.pos?.[0] ?? 0, max);
                let to = Math.min(e.pos?.[1] ?? max, max);
                if (to <= from) {
                    // A zero-width range would not show an underline
                    to = Math.min(from + 1, max);
                }
                return {
                    from,
                    to,
                    severity: "error",
                    // The first line has the summary; the rest is a code frame
                    message: e.message.split("\n")[0],
                };
            });
        });

        const extensions = [
            editorTheme,
            yaml(),
            lineNumbers(),
            lintGutter(),
            yamlLinter,
            EditorView.focusChangeEffect.of(focusEffectHandler)
        ];

        const extensionsEnv = [
            editorTheme,
            python(),
            lineNumbers(),
            EditorView.focusChangeEffect.of(focusEffectHandler)
        ];

        return { extensions,
            extensionsEnv,
            editorFocus };
    },
    yamlDoc: null,  // For keeping the yaml comments
    data() {
        return {
            jsonConfig: {},
            envsubstJSONConfig: {},
            yamlError: "",
            processing: true,
            showProgressTerminal: false,
            progressTerminalRows: PROGRESS_TERMINAL_ROWS,
            combinedTerminalRows: COMBINED_TERMINAL_ROWS,
            combinedTerminalCols: COMBINED_TERMINAL_COLS,
            stack: {

            },
            serviceStatusList: {},
            dockerStats: {},
            isEditMode: false,
            submitted: false,
            newContainerName: "",
            stopServiceStatusTimeout: false,
            stopDockerStatsTimeout: false,
            expandedPanel: null,
            // Width of the logs panel, as a percent of the split. 0 hides the
            // logs panel and 100 hides the compose file panel.
            splitLeft: 50,
            editSnapshot: null,
            // True when the container table fits. Below this the page shows
            // cards instead. Only one of the two renders at a time.
            wideLayout: true,
            wideLayoutQuery: null,
            // True while exitConfirm holds a navigation, from the moment the
            // dialog opens until the choice is complete
            leaving: false,
            // Resolves the open dialog with the user's choice
            leaveResolve: null,
        };
    },
    computed: {
        endpointDisplay() {
            return this.$root.endpointDisplayFunction(this.endpoint);
        },

        urls() {
            if (!this.envsubstJSONConfig["x-dockge"] || !this.envsubstJSONConfig["x-dockge"].urls || !Array.isArray(this.envsubstJSONConfig["x-dockge"].urls)) {
                return [];
            }

            let urls = [];
            for (const url of this.envsubstJSONConfig["x-dockge"].urls) {
                let display;
                try {
                    let obj = new URL(url);
                    let pathname = obj.pathname;
                    if (pathname === "/") {
                        pathname = "";
                    }
                    display = obj.host + pathname + obj.search;
                } catch (e) {
                    display = url;
                }

                urls.push({
                    display,
                    url,
                });
            }
            return urls;
        },

        isAdd() {
            return this.$route.path === "/compose" && !this.submitted;
        },

        hasContainers() {
            return Object.keys(this.jsonConfig.services ?? {}).length > 0;
        },

        /**
         * True when edit mode holds changes that are not saved. Form edits
         * write back into composeYAML, so the two strings cover both the
         * editors and the config cards.
         * @return {boolean}
         */
        isDirty() {
            if (!this.isEditMode || !this.editSnapshot) {
                return false;
            }
            // The name and the endpoint exist only in add mode, but they hold
            // work that the user must not lose without a question.
            return this.stack.composeYAML !== this.editSnapshot.yaml
                || this.stack.composeENV !== this.editSnapshot.env
                || (this.stack.name ?? "") !== this.editSnapshot.name
                || (this.stack.endpoint ?? "") !== this.editSnapshot.endpoint;
        },

        serviceCount() {
            return Object.keys(this.jsonConfig.services ?? {}).length;
        },

        /**
         * One row per container instance of every service, joined with the
         * docker stats when the container is running. Services that have no
         * container yet still get a placeholder row.
         * @return {object[]}
         */
        containerRows() {
            const rows = [];
            for (const service of Object.keys(this.jsonConfig.services ?? {})) {
                const instances = this.serviceStatusList[service];
                if (Array.isArray(instances) && instances.length > 0) {
                    for (const [ i, instance ] of instances.entries()) {
                        const stat = this.dockerStats?.[instance.name] ?? null;
                        const ports = formatPorts(instance.ports);
                        rows.push({
                            key: `${service}#${i}`,
                            service,
                            // Actions are service-wide, so only the first row carries them
                            first: i === 0,
                            instanceName: instance.name,
                            showInstanceName: instances.length > 1,
                            status: instance.status ?? "N/A",
                            color: this.rowColor(instance.status),
                            uptime: formatUptime(instance.uptime),
                            ip: instance.ip ?? "",
                            ports,
                            portLinks: this.portLinks(ports),
                            stat,
                            memUsed: stat?.MemUsage ? stat.MemUsage.split(" /")[0] : "",
                            memPerc: stat?.MemPerc ?? "",
                            net: this.splitIO(stat?.NetIO),
                            blk: this.splitIO(stat?.BlockIO),
                        });
                    }
                } else {
                    rows.push({
                        key: `${service}#none`,
                        service,
                        first: true,
                        instanceName: "",
                        showInstanceName: false,
                        status: "N/A",
                        color: "secondary",
                        uptime: null,
                        ip: "",
                        ports: "",
                        portLinks: [],
                        stat: null,
                        memUsed: "",
                        memPerc: "",
                        net: null,
                        blk: null,
                    });
                }
            }
            return rows;
        },

        /**
         * Get the stack from the global stack list, because it may contain more real-time data like status
         * @return {*}
         */
        globalStack() {
            return this.$root.completeStackList[this.stack.name + "_" + this.endpoint];
        },

        status() {
            return this.globalStack?.status;
        },

        active() {
            return this.status === RUNNING;
        },

        terminalName() {
            if (!this.stack.name) {
                return "";
            }
            return getComposeTerminalName(this.endpoint, this.stack.name);
        },

        combinedTerminalName() {
            if (!this.stack.name) {
                return "";
            }
            return getCombinedTerminalName(this.endpoint, this.stack.name);
        },

        networks() {
            return this.jsonConfig.networks;
        },

        endpoint() {
            return this.stack.endpoint || this.$route.params.endpoint || "";
        },

        url() {
            if (this.stack.endpoint) {
                return `/compose/${this.stack.name}/${this.stack.endpoint}`;
            } else {
                return `/compose/${this.stack.name}`;
            }
        },
    },
    watch: {
        "stack.composeYAML": {
            handler() {
                if (this.editorFocus) {
                    console.debug("yaml code changed");
                    this.yamlCodeChange();
                }
            },
            deep: true,
        },

        "stack.composeENV": {
            handler() {
                if (this.editorFocus) {
                    console.debug("env code changed");
                    this.yamlCodeChange();
                }
            },
            deep: true,
        },

        jsonConfig: {
            handler() {
                if (!this.editorFocus) {
                    console.debug("jsonConfig changed");

                    let doc = new Document(this.jsonConfig);

                    // Stick back the yaml comments
                    if (this.yamlDoc) {
                        copyYAMLComments(doc, this.yamlDoc);
                    }

                    this.stack.composeYAML = doc.toString();
                    this.yamlDoc = doc;
                }
            },
            deep: true,
        },

        $route(to, from) {

        }
    },
    mounted() {
        if (this.isAdd) {
            this.processing = false;
            this.isEditMode = true;

            let composeYAML;
            let composeENV;

            if (this.$root.composeTemplate) {
                composeYAML = this.$root.composeTemplate;
                this.$root.composeTemplate = "";
            } else {
                composeYAML = template;
            }
            if (this.$root.envTemplate) {
                composeENV = this.$root.envTemplate;
                this.$root.envTemplate = "";
            } else {
                composeENV = envDefault;
            }

            // Default Values
            this.stack = {
                name: "",
                composeYAML,
                composeENV,
                isManagedByDockge: true,
                endpoint: "",
            };

            this.yamlCodeChange();
            this.takeEditSnapshot();

        } else {
            this.stack.name = this.$route.params.stackName;
            this.loadStack();
        }

        this.requestServiceStatus();
        this.requestDockerStats();

        window.addEventListener("keydown", this.onComposeKeydown);
        window.addEventListener("beforeunload", this.onBeforeUnload);

        // Same value as the bootstrap md breakpoint
        this.wideLayoutQuery = window.matchMedia("(min-width: 768px)");
        this.wideLayout = this.wideLayoutQuery.matches;
        this.wideLayoutQuery.addEventListener("change", this.onWideLayoutChange);
    },
    beforeUnmount() {
        // The page can be destroyed without a route change, for example when
        // a failed login hides the router view. A pending navigation must
        // still get an answer, or it never finishes.
        this.resolveLeave("stay");
    },
    unmounted() {
        window.removeEventListener("keydown", this.onComposeKeydown);
        window.removeEventListener("beforeunload", this.onBeforeUnload);
        this.wideLayoutQuery?.removeEventListener("change", this.onWideLayoutChange);
        this.endSplitDrag();
    },
    methods: {
        /**
         * Close an expanded logs/yaml overlay with Escape.
         * @param {KeyboardEvent} e keydown event
         * @returns {void}
         */
        onComposeKeydown(e) {
            if (e.key === "Escape" && this.expandedPanel) {
                this.toggleExpand(this.expandedPanel);
            }
        },

        /**
         * The router does not see a tab close or a page reload. The browser
         * shows its own prompt for those two conditions.
         * @param {BeforeUnloadEvent} e beforeunload event
         * @returns {void}
         */
        onBeforeUnload(e) {
            if (this.isEditMode && this.isDirty) {
                e.preventDefault();
                // Chrome requires returnValue to be set
                e.returnValue = "";
            }
        },

        /**
         * Expand a panel into a full screen overlay, or collapse it back.
         * The terminal must refit after the size change, and it only listens
         * for window resize, so dispatch one.
         * @param {string} which "logs" or "yaml"
         * @returns {void}
         */
        toggleExpand(which) {
            this.expandedPanel = (this.expandedPanel === which) ? null : which;
            // Only the logs panel holds a terminal, and only its own geometry
            // changes — a global resize event would make every mounted
            // terminal refit and re-message the backend.
            if (which === "logs") {
                this.$nextTick(() => {
                    this.$refs.combinedTerminal?.onResizeEvent?.();
                });
            }
        },

        /**
         * Resolved image of a service after env substitution.
         * @param {string} service service name
         * @returns {string} image reference
         */
        imageOf(service) {
            return this.envsubstJSONConfig?.services?.[service]?.image ?? "";
        },

        /**
         * Start to drag the divider between the two panels.
         * @param {MouseEvent} e the mousedown on the divider
         * @returns {void}
         */
        startSplitDrag(e) {
            e.preventDefault();
            document.addEventListener("mousemove", this.onSplitDrag);
            document.addEventListener("mouseup", this.endSplitDrag);
            document.body.classList.add("split-dragging");
        },

        /**
         * Move the divider with the pointer. The limits keep a part of each
         * panel on screen, because the buttons are the way to hide one.
         * @param {MouseEvent} e the mousemove
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
         * Stop the drag and fit the terminal to its new width.
         * @returns {void}
         */
        endSplitDrag() {
            document.removeEventListener("mousemove", this.onSplitDrag);
            document.removeEventListener("mouseup", this.endSplitDrag);
            document.body.classList.remove("split-dragging");
            this.refitCombinedTerminal();
        },

        /**
         * Put the divider at a set position. 0 hides the logs panel, 100
         * hides the compose file panel, and 50 gives both the same width.
         * @param {number} percent width of the logs panel
         * @returns {void}
         */
        setSplit(percent) {
            this.splitLeft = percent;
            this.$nextTick(this.refitCombinedTerminal);
        },

        /**
         * Fit the logs terminal after its panel changes width.
         * @returns {void}
         */
        refitCombinedTerminal() {
            this.$refs.combinedTerminal?.updateTerminalSize();
        },

        /**
         * Change between the table and the cards when the window changes.
         * @param {MediaQueryListEvent} e the media query change
         * @returns {void}
         */
        onWideLayoutChange(e) {
            this.wideLayout = e.matches;
        },

        /**
         * Full memory usage for the cell tooltip. The cell has no room for
         * the limit, but the limit is what makes the percentage meaningful.
         * @param {object|null} stat docker stats entry
         * @returns {string} usage and limit, for example "2.77MiB / 3.822GiB"
         */
        memoryTitleOf(stat) {
            return stat?.MemUsage ?? "";
        },

        /**
         * Divide a docker "in / out" value into its two parts, so the cell
         * can show them on two lines and stay narrow.
         * @param {string|undefined} value for example "2.4kB / 126B"
         * @returns {object|null} the in and out parts, or null when no value
         */
        splitIO(value) {
            if (!value) {
                return null;
            }
            const parts = value.split("/").map((part) => part.trim());
            return {
                in: parts[0] || "—",
                out: parts[1] || "—",
            };
        },

        /**
         * Make the ports column into links. The Primary Hostname setting
         * says which name to open. A port with its own bind address keeps
         * that address, because the user set it on purpose.
         * @param {string} ports formatted ports column
         * @returns {object[]} text and url for each port
         */
        portLinks(ports) {
            if (!ports) {
                return [];
            }

            const hostname = this.stack.endpoint
                ? this.stack.primaryHostname
                : (this.$root.info.primaryHostname || location.hostname);

            return ports.split(", ").map((port) => ({
                text: port,
                url: parseDockerPort(port, hostname).url,
            }));
        },

        /**
         * Status dot colour for a container state.
         * @param {string} status container state
         * @returns {string} success | danger | secondary
         */
        rowColor(status) {
            if (status === "running" || status === "healthy") {
                return "success";
            }
            if (status === "unhealthy" || status === "exited" || (status ?? "").startsWith("restarting")) {
                return "danger";
            }
            return "secondary";
        },

        /**
         * Theme-adaptive badge classes for a container state.
         * @param {string} status container state
         * @returns {string} badge classes
         */
        stateBadgeClass(status) {
            const color = this.rowColor(status);
            return `bg-${color}-subtle text-${color}-emphasis`;
        },

        /**
         * Route of the Bash terminal for a service.
         * @param {string} service service name
         * @returns {object} router location
         */
        bashLink(service) {
            if (this.endpoint) {
                return {
                    name: "containerTerminalEndpoint",
                    params: {
                        endpoint: this.endpoint,
                        stackName: this.stack.name,
                        serviceName: service,
                        type: "bash",
                    },
                };
            }
            return {
                name: "containerTerminal",
                params: {
                    stackName: this.stack.name,
                    serviceName: service,
                    type: "bash",
                },
            };
        },

        startServiceStatusTimeout() {
            clearTimeout(serviceStatusTimeout);
            serviceStatusTimeout = setTimeout(async () => {
                this.requestServiceStatus();
            }, 5000);
        },

        startDockerStatsTimeout() {
            clearTimeout(dockerStatsTimeout);
            dockerStatsTimeout = setTimeout(async () => {
                this.requestDockerStats();
            }, 5000);
        },

        requestServiceStatus() {
            // Do not request if it is add mode
            if (this.isAdd) {
                return;
            }

            this.$root.emitAgent(this.endpoint, "serviceStatusList", this.stack.name, (res) => {
                if (res.ok) {
                    this.serviceStatusList = res.serviceStatusList;
                }
                if (!this.stopServiceStatusTimeout) {
                    this.startServiceStatusTimeout();
                }
            });
        },

        requestDockerStats() {
            this.$root.emitAgent(this.endpoint, "dockerStats", (res) => {
                if (res.ok) {
                    this.dockerStats = res.dockerStats;
                }
                if (!this.stopDockerStatsTimeout) {
                    this.startDockerStatsTimeout();
                }
            });
        },

        async exitConfirm(next) {
            // Ask only when there is work to lose. A clean editor leaves.
            if (!this.isEditMode || !this.isDirty) {
                this.exitAction();
                next();
                return;
            }

            // The dialog on screen owns this decision. Refuse a second
            // navigation, because only one of them can get an answer.
            if (this.leaving) {
                next(false);
                return;
            }

            this.leaving = true;
            try {
                const choice = await this.askLeave();

                if (choice === "stay") {
                    next(false);
                    return;
                }

                // "save": leave only after the server accepts the file. The
                // dialog stays on screen, with its buttons disabled, so the
                // user can see that the save runs.
                if (choice === "save") {
                    const saved = await this.saveStack();
                    if (!saved) {
                        next(false);
                        return;
                    }
                }

                this.exitAction();
                next();
            } finally {
                this.leaving = false;
                this.leaveResolve = null;
                this.$refs.confirmLeave?.hide();
            }
        },

        /**
         * Show the unsaved-changes dialog and wait for the user.
         * @returns {Promise<string>} "save", "discard" or "stay"
         */
        askLeave() {
            return new Promise((resolve) => {
                this.leaveResolve = resolve;
                this.$refs.confirmLeave.show();
            });
        },

        /**
         * Give the waiting navigation the user's choice. The promise accepts
         * the first answer only, so a later answer cannot answer twice.
         * @param {string} choice "stay", "discard" or "save"
         * @returns {void}
         */
        resolveLeave(choice) {
            const resolve = this.leaveResolve;
            this.leaveResolve = null;
            resolve?.(choice);
        },

        exitAction() {
            console.log("exitAction");
            this.stopServiceStatusTimeout = true;
            this.stopDockerStatsTimeout = true;
            clearTimeout(serviceStatusTimeout);
            clearTimeout(dockerStatsTimeout);

            // Leave Combined Terminal
            console.debug("leaveCombinedTerminal", this.endpoint, this.stack.name);
            this.$root.emitAgent(this.endpoint, "leaveCombinedTerminal", this.stack.name, () => {});
        },

        bindTerminal() {
            this.$refs.progressTerminal?.bind(this.endpoint, this.terminalName);
        },

        loadStack() {
            this.processing = true;
            this.$root.emitAgent(this.endpoint, "getStack", this.stack.name, (res) => {
                if (res.ok) {
                    this.stack = res.stack;
                    this.yamlCodeChange();
                    this.processing = false;
                    this.bindTerminal();
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        deployStack() {
            this.processing = true;

            if (!this.jsonConfig.services) {
                this.$root.toastError("No services found in compose.yaml");
                this.processing = false;
                return;
            }

            // Check if services is object
            if (typeof this.jsonConfig.services !== "object") {
                this.$root.toastError("Services must be an object");
                this.processing = false;
                return;
            }

            let serviceNameList = Object.keys(this.jsonConfig.services);

            // Set the stack name if empty, use the first container name
            if (!this.stack.name && serviceNameList.length > 0) {
                let serviceName = serviceNameList[0];
                let service = this.jsonConfig.services[serviceName];

                if (service && service.container_name) {
                    this.stack.name = service.container_name;
                } else {
                    this.stack.name = serviceName;
                }
            }

            this.bindTerminal();

            this.$root.emitAgent(this.stack.endpoint, "deployStack", this.stack.name, this.stack.composeYAML, this.stack.composeENV, this.isAdd, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.isEditMode = false;
                    this.$router.push(this.url);
                }
            });
        },

        /**
         * Send the editor contents to the server.
         * @returns {Promise<boolean>} true when the server accepts the file
         */
        saveStack() {
            this.processing = true;

            // Hold the values that go to the server. The editors stay usable
            // while the reply travels, so the buffer can change. A snapshot
            // of the buffer would then mark unsent text as saved.
            const sent = this.currentEditState();

            return new Promise((resolve) => {
                let settled = false;

                // An agent that is offline never answers, and the dialog and
                // the buttons would stay disabled for ever.
                const timer = setTimeout(() => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.processing = false;
                    this.$root.toastError(this.$t("saveTimeout"));
                    resolve(false);
                }, 30000);

                this.$root.emitAgent(this.stack.endpoint, "saveStack", this.stack.name, sent.yaml, sent.env, this.isAdd, (res) => {
                    clearTimeout(timer);
                    this.processing = false;
                    this.$root.toastRes(res);

                    if (res.ok) {
                        // The baseline is what the server has, not the
                        // buffer. A reply that comes after the timeout must
                        // still clear the dirty mark, or the editor asks to
                        // save a file that the server already has.
                        this.editSnapshot = sent;
                    }

                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve(res.ok);
                });
            });
        },

        /**
         * Save from the toolbar, then leave edit mode.
         * @returns {Promise<void>}
         */
        async saveStackAndExit() {
            if (await this.saveStack()) {
                this.isEditMode = false;
                this.$router.push(this.url);
            }
        },

        startStack() {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "startStack", this.stack.name, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
            });
        },

        stopStack() {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "stopStack", this.stack.name, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
            });
        },

        downStack() {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "downStack", this.stack.name, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
            });
        },

        restartStack() {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "restartStack", this.stack.name, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
            });
        },

        updateStack() {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "updateStack", this.stack.name, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
            });
        },

        deleteDialog() {
            this.$root.emitAgent(this.endpoint, "deleteStack", this.stack.name, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.$router.push("/");
                }
            });
        },

        discardStack() {
            this.loadStack();
            this.isEditMode = false;
        },

        yamlToJSON(yaml) {
            let doc = parseDocument(yaml);
            if (doc.errors.length > 0) {
                throw doc.errors[0];
            }

            const config = doc.toJS() ?? {};

            // Check data types
            // "services" must be an object
            if (!config.services) {
                config.services = {};
            }

            if (Array.isArray(config.services) || typeof config.services !== "object") {
                throw new Error("Services must be an object");
            }

            return {
                config,
                doc,
            };
        },

        yamlCodeChange() {
            try {
                let { config, doc } = this.yamlToJSON(this.stack.composeYAML);

                this.yamlDoc = doc;
                this.jsonConfig = config;

                let env = dotenv.parse(this.stack.composeENV);
                let envYAML = envsubstYAML(this.stack.composeYAML, env);
                this.envsubstJSONConfig = this.yamlToJSON(envYAML).config;

                clearTimeout(yamlErrorTimeout);
                this.yamlError = "";
            } catch (e) {
                clearTimeout(yamlErrorTimeout);

                if (this.yamlError) {
                    this.yamlError = e.message;

                } else {
                    yamlErrorTimeout = setTimeout(() => {
                        this.yamlError = e.message;
                    }, 3000);
                }
            }
        },

        enableEditMode() {
            // The expanded overlay lives in view mode; leaving it set would
            // strand a full-viewport backdrop over the edit form.
            this.expandedPanel = null;
            this.isEditMode = true;
            this.takeEditSnapshot();
        },

        /**
         * Record the current file contents. isDirty compares against this.
         *
         * The config cards write the parsed object back to YAML when edit
         * mode opens. This changes the format of the text. It is not a user
         * change. Thus this method waits for that write, then records the
         * result.
         * @returns {void}
         */
        async takeEditSnapshot() {
            this.editSnapshot = this.currentEditState();
            await this.$nextTick();
            await this.$nextTick();
            this.editSnapshot = this.currentEditState();
        },

        /**
         * The values that isDirty compares.
         * @returns {object} a copy of the editable state
         */
        currentEditState() {
            return {
                yaml: this.stack.composeYAML,
                env: this.stack.composeENV,
                name: this.stack.name ?? "",
                endpoint: this.stack.endpoint ?? "",
            };
        },

        checkYAML() {

        },

        addContainer() {
            this.checkYAML();

            if (this.jsonConfig.services[this.newContainerName]) {
                this.$root.toastError("Container name already exists");
                return;
            }

            if (!this.newContainerName) {
                this.$root.toastError("Container name cannot be empty");
                return;
            }

            this.jsonConfig.services[this.newContainerName] = {
                restart: "unless-stopped",
            };
            this.newContainerName = "";
            let element = this.$refs.containerList.lastElementChild;
            element.scrollIntoView({
                block: "start",
                behavior: "smooth"
            });
        },

        stackNameToLowercase() {
            this.stack.name = this.stack?.name?.toLowerCase();
        },

        startService(serviceName) {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "startService", this.stack.name, serviceName, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.requestServiceStatus(); // Refresh service status
                }
            });
        },

        stopService(serviceName) {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "stopService", this.stack.name, serviceName, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.requestServiceStatus(); // Refresh service status
                }
            });
        },

        restartService(serviceName) {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "restartService", this.stack.name, serviceName, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.requestServiceStatus(); // Refresh service status
                }
            });
        },
    }
};
</script>

<style scoped lang="scss">
.terminal {
    height: 200px;
}

.agent-name {
    font-size: 13px;
    color: var(--bs-secondary-color);
}

/* ---------- compact title + toolbar row ---------- */
.title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.title-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;

    .btn {
        padding: 0.15rem 0.5rem;
        font-size: 12px;
    }
}

/* Edit-mode editors inside panels: give them room to work in */
.panel .editor-box {
    min-height: 300px;
    border-radius: 0 0 4px 4px;
}

/* ---------- view mode: flex column that fills the viewport ---------- */
.view-col {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 210px);
}

/* .panel family and .status-dot/.mono are global (main.scss) */
/* .mini-btn (global) supplies the look; this adds the placement */
.expand-btn {
    margin-left: auto;
}

/* Logs + yaml split: fills the remaining viewport height */
.panel-split {
    flex: 1 1 auto;
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
    min-height: 380px;
    margin-bottom: 0.5rem;

    .panel {
        min-width: 0;
        margin-bottom: 0;
    }

    // The divider sets the width of the first panel. The second takes what
    // is left, so the two always fill the row.
    .split-a {
        flex: 0 0 var(--split-left, 50%);
    }

    .split-b {
        flex: 1 1 0;
    }

    .split-gone {
        display: none;
    }

    @media (max-width: 991.98px) {
        flex-direction: column;

        // The panels are one above the other, so the divider does not apply
        .panel,
        .split-a,
        .split-b {
            flex: 1 1 auto;
            min-height: 300px;
        }

        .split-gone {
            display: flex;
        }

        .split-bar {
            display: none;
        }
    }
}

.split-bar {
    flex: 0 0 10px;
    position: relative;
    cursor: col-resize;
    border-radius: 3px;

    &:hover {
        background-color: var(--bs-tertiary-bg);
    }
}

.split-actions {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.split-btn {
    width: 16px;
    height: 18px;
    padding: 0;
    line-height: 1;
    font-size: 11px;
    cursor: pointer;
    color: var(--bs-secondary-color);
    background-color: var(--bs-body-bg);
    border: 1px solid var(--bs-border-color);
    border-radius: 2px;

    &:hover {
        color: var(--bs-body-color);
        background-color: var(--bs-secondary-bg);
    }
}

.panel-fill {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;

    // Terminal.vue renders its own shadow-box; flatten it inside a panel.
    :deep(.shadow-box) {
        border: 0;
        border-radius: 0 0 4px 4px;
        height: 100%;
        flex: 1 1 auto;
        padding: 0.25rem;
    }

    .terminal {
        height: 100%;
    }
}

.editor-fill {
    overflow: auto;
    border-radius: 0 0 4px 4px;
    // Dracula editor background, so the gutter area matches while scrolling.
    background-color: #282a36;

    :deep(.cm-editor) {
        height: 100%;
    }

    :deep(.vue-codemirror) {
        height: 100%;
    }
}

/* Expanded overlay */
.panel.pop {
    position: fixed;
    inset: 1rem;
    z-index: 1055;
    margin: 0;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgba(0, 0, 0, 0.55);
}

/* ---------- unsaved changes ---------- */
.dirty-dot {
    color: var(--bs-warning);
    font-size: 0.7rem;
    line-height: 1;
    flex: 0 0 auto;
}

/* ---------- containers table ----------
   .state-badge is global (main.scss); .actions-btn lives in ContainerActions. */
.cell-muted {
    color: var(--bs-secondary-color);
}

.cell-sub {
    font-size: 11px;
    color: var(--bs-secondary-color);
}

// A very long service name must not widen the nowrap column past the panel;
// the full name is in the cell tooltip.
.svc-name {
    display: inline-block;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: bottom;

    @media (max-width: 1400px) {
        max-width: 140px;
    }
}

.ctable {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;

    th {
        text-align: left;
        font-size: 10.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--bs-secondary-color);
        padding: 0.28rem 0.5rem;
        border-bottom: 1px solid var(--bs-border-color);
        white-space: nowrap;
    }

    td {
        padding: 0.28rem 0.5rem;
        border-bottom: 1px solid var(--bs-border-color);
        vertical-align: middle;
    }

    tbody tr:last-child td {
        border-bottom: 0;
    }

    tbody tr:nth-child(even) {
        background-color: var(--bs-tertiary-bg);
    }

    tbody tr:hover {
        background-color: var(--bs-secondary-bg);
    }

    th.c-num,
    td.c-num {
        text-align: right;
    }

    // Cells that must never wrap
    .c-svc,
    .c-up,
    .c-addr,
    .c-act {
        white-space: nowrap;
    }

    // Stacked cells: two short lines are narrower than one long line
    .c-num div,
    .c-addr div {
        line-height: 1.25;
    }
}

// Marks the in line and the out line of a two line I/O cell
.io-k {
    display: inline-block;
    min-width: 1.1em;
    margin-right: 0.15rem;
    color: var(--bs-secondary-color);
    font-size: 0.85em;
}

// A narrow window scrolls the table sideways. To hide the columns instead
// puts them out of reach, because the cards start below 768px only.
.ctable-scroll {
    overflow-x: auto;
}

.port-link {
    color: inherit;
    text-decoration: none;

    &:hover {
        color: var(--bs-link-color);
        text-decoration: underline;
    }
}

/* ---------- mobile cards ---------- */
.mcard {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid var(--bs-border-color);

    &:last-child {
        border-bottom: 0;
    }
}

.mcard-top {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
}

.mcard-img {
    font-size: 11px;
    margin: 0.1rem 0 0.25rem 1.05rem;
}

.mcard-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.1rem 0.7rem;
    font-size: 11.5px;
    margin-left: 1.05rem;
    overflow-wrap: anywhere;

    .k {
        color: var(--bs-secondary-color);
    }
}
</style>
