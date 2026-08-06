<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 v-if="isAdd" class="fs-3 mb-3">{{ $t("compose") }}</h1>
            <h1 v-else class="fs-3 mb-3">
                <Uptime :stack="globalStack" :pill="true" /> {{ stack.name }}
                <span v-if="$root.agentCount > 1 && endpoint !== ''" class="agent-name">
                    ({{ endpointDisplay }})
                </span>
            </h1>

            <div v-if="stack.isManagedByDockge" class="mb-3">
                <div class="btn-group btn-group-sm me-2" role="group">
                    <button v-if="isEditMode" class="btn btn-primary" :disabled="processing" @click="deployStack">
                        <font-awesome-icon icon="rocket" class="me-1" />
                        {{ $t("deployStack") }}
                    </button>

                    <button v-if="isEditMode" class="btn btn-normal" :disabled="processing" @click="saveStack">
                        <font-awesome-icon icon="save" class="me-1" />
                        {{ $t("saveStackDraft") }}
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
                    <div v-if="isAdd">
                        <h4 class="fs-5 mb-2">{{ $t("general") }}</h4>
                        <div class="shadow-box big-padding mb-3">
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
                    <h4 v-if="isEditMode" class="fs-5 mb-2">{{ $tc("container", 2) }}</h4>

                    <div v-if="isEditMode" class="input-group mb-3">
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

                    <div v-if="isEditMode" ref="containerList">
                        <Container
                            v-for="(service, name) in jsonConfig.services"
                            :key="name"
                            :name="name"
                            :is-edit-mode="isEditMode"
                            :first="name === Object.keys(jsonConfig.services)[0]"
                            :serviceStatus="serviceStatusList[name]"
                            :dockerStats="dockerStats"
                            @start-service="startService"
                            @stop-service="stopService"
                            @restart-service="restartService"
                        />
                    </div>

                    <!-- Containers (view mode): dense table, stacked cards on mobile -->
                    <div v-if="!isEditMode && hasContainers" class="panel containers-panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ $tc("container", 2) }}</span>
                            <span class="panel-note">{{ containerRows.length }}</span>
                        </div>

                        <table class="ctable d-none d-md-table">
                            <thead>
                                <tr>
                                    <th class="c-svc">{{ $t("service") }}</th>
                                    <th class="c-img">{{ $t("dockerImage") }}</th>
                                    <th class="c-state">{{ $t("state") }}</th>
                                    <th class="c-up">{{ $t("uptime") }}</th>
                                    <th class="c-ip">{{ $t("ip") }}</th>
                                    <th class="c-ports">{{ $tc("port", 2) }}</th>
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
                                        <span class="status-dot me-2" :class="'dot-' + row.color"></span><strong>{{ row.service }}</strong>
                                        <div v-if="row.showInstanceName" class="cell-sub">{{ row.instanceName }}</div>
                                    </td>
                                    <td class="c-img cell-muted">{{ imageOf(row.service) }}</td>
                                    <td class="c-state"><span class="badge state-badge" :class="stateBadgeClass(row.status)">{{ row.status }}</span></td>
                                    <td class="c-up mono">{{ row.uptime ?? "—" }}</td>
                                    <td class="c-ip mono">{{ row.ip || "—" }}</td>
                                    <td class="c-ports mono cell-muted">{{ row.ports || "—" }}</td>
                                    <td class="c-num mono">{{ row.stat?.CPUPerc ?? "—" }}</td>
                                    <td class="c-num mono">{{ memoryOf(row.stat) }}</td>
                                    <td class="c-num c-net mono cell-muted">{{ row.stat?.NetIO ?? "—" }}</td>
                                    <td class="c-num c-blk mono cell-muted">{{ row.stat?.BlockIO ?? "—" }}</td>
                                    <td class="c-act">
                                        <div v-if="hasActions(row)" class="dropdown">
                                            <button class="btn btn-secondary btn-sm dropdown-toggle actions-btn" data-bs-toggle="dropdown" aria-expanded="false">
                                                {{ $t("actions") }}
                                            </button>
                                            <ul class="dropdown-menu dropdown-menu-end">
                                                <li v-if="isRowRunning(row)">
                                                    <router-link class="dropdown-item" :to="bashLink(row.service)">
                                                        <font-awesome-icon icon="terminal" class="me-1" /> Bash
                                                    </router-link>
                                                </li>
                                                <li v-if="isRowRunning(row) && serviceCount > 1"><hr class="dropdown-divider"></li>
                                                <li v-if="!isRowRunning(row) && serviceCount > 1">
                                                    <button class="dropdown-item" :disabled="processing" @click="startService(row.service)">
                                                        <font-awesome-icon icon="play" class="me-1" /> {{ $t("startStack") }}
                                                    </button>
                                                </li>
                                                <li v-if="isRowRunning(row) && serviceCount > 1">
                                                    <button class="dropdown-item" :disabled="processing" @click="restartService(row.service)">
                                                        <font-awesome-icon icon="rotate" class="me-1" /> {{ $t("restartStack") }}
                                                    </button>
                                                </li>
                                                <li v-if="isRowRunning(row) && serviceCount > 1">
                                                    <button class="dropdown-item" :disabled="processing" @click="stopService(row.service)">
                                                        <font-awesome-icon icon="stop" class="me-1" /> {{ $t("stopStack") }}
                                                    </button>
                                                </li>
                                            </ul>
                                        </div>
                                        <span v-else class="cell-muted">—</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>

                        <!-- Mobile: stacked cards -->
                        <div class="d-md-none">
                            <div v-for="row in containerRows" :key="row.key" class="mcard">
                                <div class="mcard-top">
                                    <span class="status-dot" :class="'dot-' + row.color"></span>
                                    <strong class="text-truncate">{{ row.service }}</strong>
                                    <span class="badge state-badge" :class="stateBadgeClass(row.status)">{{ row.status }}</span>
                                    <div v-if="hasActions(row)" class="dropdown ms-auto">
                                        <button class="btn btn-secondary btn-sm dropdown-toggle actions-btn" data-bs-toggle="dropdown" aria-expanded="false">
                                            {{ $t("actions") }}
                                        </button>
                                        <ul class="dropdown-menu dropdown-menu-end">
                                            <li v-if="isRowRunning(row)">
                                                <router-link class="dropdown-item" :to="bashLink(row.service)">
                                                    <font-awesome-icon icon="terminal" class="me-1" /> Bash
                                                </router-link>
                                            </li>
                                            <li v-if="isRowRunning(row) && serviceCount > 1"><hr class="dropdown-divider"></li>
                                            <li v-if="!isRowRunning(row) && serviceCount > 1">
                                                <button class="dropdown-item" :disabled="processing" @click="startService(row.service)">
                                                    <font-awesome-icon icon="play" class="me-1" /> {{ $t("startStack") }}
                                                </button>
                                            </li>
                                            <li v-if="isRowRunning(row) && serviceCount > 1">
                                                <button class="dropdown-item" :disabled="processing" @click="restartService(row.service)">
                                                    <font-awesome-icon icon="rotate" class="me-1" /> {{ $t("restartStack") }}
                                                </button>
                                            </li>
                                            <li v-if="isRowRunning(row) && serviceCount > 1">
                                                <button class="dropdown-item" :disabled="processing" @click="stopService(row.service)">
                                                    <font-awesome-icon icon="stop" class="me-1" /> {{ $t("stopStack") }}
                                                </button>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="mcard-img cell-muted">{{ imageOf(row.service) }}</div>
                                <div class="mcard-grid">
                                    <span class="k">{{ $t("uptime") }}</span><span class="mono">{{ row.uptime ?? "—" }}</span>
                                    <span class="k">{{ $t("ip") }}</span><span class="mono">{{ row.ip || "—" }}</span>
                                    <span class="k">{{ $tc("port", 2) }}</span><span class="mono">{{ row.ports || "—" }}</span>
                                    <span class="k">{{ $t("CPU") }}</span><span class="mono">{{ row.stat?.CPUPerc ?? "—" }}</span>
                                    <span class="k">{{ $t("memory") }}</span><span class="mono">{{ memoryOf(row.stat) }}</span>
                                    <span class="k">{{ $t("networkIO") }}</span><span class="mono">{{ row.stat?.NetIO ?? "—" }}</span>
                                    <span class="k">{{ $t("blockIO") }}</span><span class="mono">{{ row.stat?.BlockIO ?? "—" }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button v-if="false && isEditMode && jsonConfig.services && Object.keys(jsonConfig.services).length > 0" class="btn btn-normal mb-3" @click="addContainer">{{ $t("addContainer") }}</button>

                    <!-- General -->
                    <div v-if="isEditMode">
                        <h4 class="fs-5 mb-2">{{ $t("extra") }}</h4>
                        <div class="shadow-box big-padding mb-3">
                            <!-- URLs -->
                            <div class="mb-4">
                                <label class="form-label">
                                    {{ $tc("url", 2) }}
                                </label>
                                <ArrayInput name="urls" :display-name="$t('url')" placeholder="https://" object-type="x-dockge" />
                            </div>
                        </div>
                    </div>

                    <!-- Logs + compose.yaml, side by side, filling the rest of the viewport -->
                    <div v-show="!isEditMode" class="panel-split">
                        <div class="panel fill-panel" :class="{ pop: expandedPanel === 'logs' }">
                            <div class="panel-head">
                                <span class="panel-title">{{ $t("logs") }}</span>
                                <span class="panel-note">{{ stack.name }}</span>
                                <button class="expand-btn" :title="expandedPanel === 'logs' ? $t('cancel') : $t('expand')" @click="toggleExpand('logs')">
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

                        <div class="panel fill-panel" :class="{ pop: expandedPanel === 'yaml' }">
                            <div class="panel-head">
                                <span class="panel-title">{{ stack.composeFileName }}</span>
                                <button class="expand-btn" :title="expandedPanel === 'yaml' ? $t('cancel') : $t('expand')" @click="toggleExpand('yaml')">
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
                    <h4 class="fs-5 mb-2">{{ stack.composeFileName }}</h4>

                    <!-- YAML editor -->
                    <div class="shadow-box mb-3 editor-box edit-mode">
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
                    <div class="mb-3">
                        {{ yamlError }}
                    </div>

                    <!-- ENV editor -->
                    <div v-if="isEditMode">
                        <h4 class="fs-5 mb-2">.env</h4>
                        <div class="shadow-box mb-3 editor-box" :class="{'edit-mode' : isEditMode}">
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

                    <div v-if="isEditMode">
                        <!-- Volumes -->
                        <div v-if="false">
                            <h4 class="fs-5 mb-2">{{ $tc("volume", 2) }}</h4>
                            <div class="shadow-box big-padding mb-3">
                            </div>
                        </div>

                        <!-- Networks -->
                        <h4 class="fs-5 mb-2">{{ $tc("network", 2) }}</h4>
                        <div class="shadow-box big-padding mb-3">
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
        </div>
    </transition>
</template>

<script>
import CodeMirror from "vue-codemirror6";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { dracula as editorTheme } from "thememirror";
import { lineNumbers, EditorView } from "@codemirror/view";
import { parseDocument, Document } from "yaml";

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import {
    COMBINED_TERMINAL_COLS,
    COMBINED_TERMINAL_ROWS,
    copyYAMLComments, envsubstYAML,
    getCombinedTerminalName,
    getComposeTerminalName,
    PROGRESS_TERMINAL_ROWS,
    RUNNING
} from "../../../common/util-common";
import { formatPorts, formatUptime } from "../util-frontend";
import NetworkInput from "../components/NetworkInput.vue";
import Confirm from "../components/Confirm.vue";
import Container from "../components/Container.vue";
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

        const extensions = [
            editorTheme,
            yaml(),
            lineNumbers(),
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
                        rows.push({
                            key: `${service}#${i}`,
                            service,
                            instanceName: instance.name,
                            showInstanceName: instances.length > 1,
                            status: instance.status ?? "N/A",
                            color: this.rowColor(instance.status),
                            uptime: formatUptime(instance.uptime),
                            ip: instance.ip ?? "",
                            ports: formatPorts(instance.ports),
                            stat: this.dockerStats?.[instance.name] ?? null,
                        });
                    }
                } else {
                    rows.push({
                        key: `${service}#none`,
                        service,
                        instanceName: "",
                        showInstanceName: false,
                        status: "N/A",
                        color: "secondary",
                        uptime: null,
                        ip: "",
                        ports: "",
                        stat: null,
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

        } else {
            this.stack.name = this.$route.params.stackName;
            this.loadStack();
        }

        this.requestServiceStatus();
        this.requestDockerStats();

        window.addEventListener("keydown", this.onComposeKeydown);
    },
    unmounted() {
        window.removeEventListener("keydown", this.onComposeKeydown);
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
         * Expand a panel into a full screen overlay, or collapse it back.
         * The terminal must refit after the size change, and it only listens
         * for window resize, so dispatch one.
         * @param {string} which "logs" or "yaml"
         * @returns {void}
         */
        toggleExpand(which) {
            this.expandedPanel = (this.expandedPanel === which) ? null : which;
            this.$nextTick(() => {
                window.dispatchEvent(new Event("resize"));
            });
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
         * Memory cell: usage plus percentage, e.g. "2.77MiB (0.07%)".
         * @param {object|null} stat docker stats entry
         * @returns {string} formatted memory usage
         */
        memoryOf(stat) {
            if (!stat?.MemUsage) {
                return "—";
            }
            const used = stat.MemUsage.split(" /")[0];
            return stat.MemPerc ? `${used} (${stat.MemPerc})` : used;
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
         * Whether the row's container is running or healthy.
         * @param {object} row container row
         * @returns {boolean} true when running
         */
        isRowRunning(row) {
            return row.status === "running" || row.status === "healthy";
        },

        /**
         * Whether the Actions dropdown has at least one entry for this row.
         * Mirrors the per-service button rules of the old card layout.
         * @param {object} row container row
         * @returns {boolean} true when the dropdown should render
         */
        hasActions(row) {
            return this.isRowRunning(row) || this.serviceCount > 1;
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

        exitConfirm(next) {
            if (this.isEditMode) {
                if (confirm(this.$t("confirmLeaveStack"))) {
                    this.exitAction();
                    next();
                } else {
                    next(false);
                }
            } else {
                this.exitAction();
                next();
            }
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

        saveStack() {
            this.processing = true;

            this.$root.emitAgent(this.stack.endpoint, "saveStack", this.stack.name, this.stack.composeYAML, this.stack.composeENV, this.isAdd, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.isEditMode = false;
                    this.$router.push(this.url);
                }
            });
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
            this.isEditMode = true;
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

/* ---------- view mode: flex column that fills the viewport ---------- */
.view-col {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 210px);
}

/* ---------- panels ---------- */
.panel {
    background-color: var(--bs-body-bg);
    border: 1px solid var(--bs-border-color);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    margin-bottom: 0.5rem;
}

.panel-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    background-color: var(--bs-tertiary-bg);
    border-bottom: 1px solid var(--bs-border-color);
    border-radius: 4px 4px 0 0;
}

.panel-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--bs-secondary-color);
}

.panel-note {
    font-size: 11px;
    color: var(--bs-secondary-color);
}

.expand-btn {
    margin-left: auto;
    border: 1px solid var(--bs-border-color);
    background: transparent;
    color: var(--bs-secondary-color);
    border-radius: 2px;
    font-size: 11px;
    line-height: 1;
    padding: 0.2rem 0.35rem;
    cursor: pointer;

    &:hover {
        color: var(--bs-body-color);
    }
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
        flex: 1 1 50%;
        min-width: 0;
        margin-bottom: 0;
    }

    @media (max-width: 991.98px) {
        flex-direction: column;

        .panel {
            flex: 1 1 auto;
            min-height: 300px;
        }
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

/* ---------- containers table ---------- */
.mono {
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.92em;
}

.cell-muted {
    color: var(--bs-secondary-color);
}

.cell-sub {
    font-size: 11px;
    color: var(--bs-secondary-color);
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex: 0 0 8px;
}

.dot-success {
    background-color: var(--bs-success);
}

.dot-danger {
    background-color: var(--bs-danger);
}

.dot-secondary {
    background-color: var(--bs-secondary-color);
}

.state-badge {
    font-size: 10.5px;
    font-weight: 600;
    border-radius: 2px;
}

.actions-btn {
    padding: 0.05rem 0.4rem;
    font-size: 11.5px;
    border-radius: 2px;
    white-space: nowrap;
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
    .c-act {
        white-space: nowrap;
    }

    // Tablet: drop the low-value columns so the rest keeps breathing room
    @media (max-width: 1199.98px) {
        .c-img,
        .c-ports,
        .c-net,
        .c-blk {
            display: none;
        }
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
