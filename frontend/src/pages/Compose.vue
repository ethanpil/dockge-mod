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
                    <!-- Git state of the stack directory. Only a stack from
                         an agent with git support carries this data. -->
                    <span v-if="gitInfo" class="git-badge" :title="gitInfo.isDirty ? $t('gitDirtyMsg') : ''">
                        <font-awesome-icon icon="code-branch" class="me-1" />{{ gitInfo.branch }}<template v-if="gitInfo.isDirty"> &#9679;</template>
                    </span>
                    <span v-if="!isEditMode && serviceCount > 0" class="panel-note d-none d-sm-inline">{{ serviceCount }} {{ $tc("container", serviceCount).toLowerCase() }}</span>
                </template>

                <div v-if="stack.isManagedByDockge" class="toolbar ms-auto">
                    <div class="btn-group btn-group-sm me-2" role="group">
                        <button v-if="isEditMode" class="btn btn-primary" :disabled="processing" @click="deployStack">
                            <font-awesome-icon icon="rocket" class="me-1" />
                            {{ $t("deployStack") }}
                        </button>

                        <!-- Examine the editor content with docker, before a
                             save writes it. The guard is approximate: it
                             tests override support. An agent without the
                             event does not answer, and the timer of the
                             overlay then ends the wait. -->
                        <button v-if="isEditMode && (isAdd || overrideSupported)" class="btn btn-normal" :disabled="processing || mergedConfigLoading" :title="$t('validateConfigNote')" @click="validateCompose">
                            <font-awesome-icon icon="check-double" class="me-1" />
                            {{ $t("validateConfig") }}
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

                        <!-- A detached HEAD cannot pull, thus no button for it -->
                        <button v-if="!isEditMode && gitInfo && !gitInfo.isDetached" class="btn btn-normal" :disabled="processing" @click="gitPullStack">
                            <font-awesome-icon icon="code-branch" class="me-1" />
                            {{ $t("gitPullRedeploy") }}
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

                    <!-- Compose file + override file, side by side. Without an
                         override file the compose file takes the full row. -->
                    <div v-show="!isEditMode" ref="split" class="panel-split" :class="{ 'h-fixed': panelHeights.files }" :style="[{ '--split-left': splitLeft + '%' }, panelVar('files')]">
                        <div class="panel split-a" :class="{ pop: expandedPanel === 'yaml', 'split-solo': !hasOverride, 'split-gone': hasOverride && splitLeft === 0 }">
                            <div class="panel-head head-grow">
                                <span class="panel-title">{{ stack.composeFileName }}</span>
                                <!-- An upstream dockge agent does not have the
                                     getComposeConfig event, and it also does
                                     not send the override field. The timer in
                                     showMergedConfig covers an agent of an
                                     older dockge-mod build. -->
                                <button v-if="overrideSupported" class="mini-btn" :disabled="mergedConfigLoading" :title="$t('mergedConfigNote')" @click="showMergedConfig">
                                    <font-awesome-icon icon="layer-group" class="me-1" />{{ $t("mergedConfig") }}
                                </button>
                                <button class="mini-btn" :title="expandedPanel === 'yaml' ? $t('cancel') : $t('expand')" @click="toggleExpand('yaml')">
                                    <font-awesome-icon :icon="expandedPanel === 'yaml' ? 'compress' : 'expand'" />
                                </button>
                            </div>
                            <div class="panel-fill editor-fill">
                                <code-mirror
                                    v-if="!isEditMode"
                                    v-model="stack.composeYAML"
                                    v-bind="editorProps"
                                    :extensions="extensions"
                                    :disabled="true"
                                />
                            </div>
                        </div>

                        <!-- Drag to change the width. The buttons hide one
                             side or put the divider back in the middle. -->
                        <div v-if="hasOverride" class="split-bar" @mousedown="startSplitDrag">
                            <span class="split-grip"><font-awesome-icon icon="grip-lines-vertical" /></span>
                            <div class="split-actions">
                                <button type="button" class="split-btn" :title="$t('hideLeftPanel')" @mousedown.stop @click="setSplit(0)">
                                    <font-awesome-icon icon="chevron-left" />
                                </button>
                                <button type="button" class="split-btn" :title="$t('equalPanels')" @mousedown.stop @click="setSplit(50)">
                                    <font-awesome-icon icon="table-columns" />
                                </button>
                                <button type="button" class="split-btn" :title="$t('hideRightPanel')" @mousedown.stop @click="setSplit(100)">
                                    <font-awesome-icon icon="chevron-right" />
                                </button>
                            </div>
                        </div>

                        <div v-if="hasOverride" class="panel split-b" :class="{ pop: expandedPanel === 'override', 'split-gone': splitLeft === 100 }">
                            <div class="panel-head">
                                <span class="panel-title">{{ overrideFileName }}</span>
                                <button class="mini-btn expand-btn" :title="expandedPanel === 'override' ? $t('cancel') : $t('expand')" @click="toggleExpand('override')">
                                    <font-awesome-icon :icon="expandedPanel === 'override' ? 'compress' : 'expand'" />
                                </button>
                            </div>
                            <div class="panel-fill editor-fill">
                                <code-mirror
                                    v-if="!isEditMode"
                                    v-model="stack.composeOverrideYAML"
                                    v-bind="editorProps"
                                    :extensions="extensions"
                                    :disabled="true"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- Drag to change the height of the file row. The
                         handle is not on a narrow window, because the
                         panels there go one above the other. -->
                    <div v-show="!isEditMode" class="vresize vresize-files" :title="$t('dragResizeNote')" @pointerdown="startHeightDrag($event, 'files')" @dblclick="resetHeight('files')">
                        <font-awesome-icon icon="grip-lines" />
                    </div>

                    <!-- Logs, full width below the files -->
                    <div v-show="!isEditMode" class="panel logs-panel" :class="{ pop: expandedPanel === 'logs', 'h-fixed': panelHeights.logs }" :style="panelVar('logs')">
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
                    <!-- Drag to change the height of the logs -->
                    <div v-show="!isEditMode" class="vresize" :title="$t('dragResizeNote')" @pointerdown="startHeightDrag($event, 'logs')" @dblclick="resetHeight('logs')">
                        <font-awesome-icon icon="grip-lines" />
                    </div>

                    <!-- Merged configuration overlay: the output of
                         `docker compose config`, read only. This uses the
                         same overlay system as the expanded panels, thus
                         Escape and the backdrop close it. -->
                    <div v-if="expandedPanel === 'merged'" class="panel pop">
                        <div class="panel-head">
                            <span class="panel-title">{{ $t("mergedConfig") }}</span>
                            <span class="panel-note">{{ $t(mergedConfigNoteKey) }}</span>
                            <button class="mini-btn expand-btn" :title="$t('cancel')" @click="toggleExpand('merged')">
                                <font-awesome-icon icon="compress" />
                            </button>
                        </div>
                        <div class="panel-fill merged-body">
                            <div v-if="mergedConfigLoading" class="p-3">
                                <font-awesome-icon icon="spinner" spin />
                            </div>
                            <pre v-else-if="mergedConfigError" class="merged-error">{{ mergedConfigError }}</pre>
                            <div v-else class="editor-fill">
                                <code-mirror
                                    :model-value="mergedConfigYAML"
                                    v-bind="editorProps"
                                    :extensions="extensions"
                                    :disabled="true"
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
                        <div class="editor-box edit-mode" :class="{ 'h-fixed': panelHeights.editYaml }" :style="panelVar('editYaml')">
                            <code-mirror
                                ref="editor"
                                v-model="stack.composeYAML"
                                v-bind="editorProps"
                                :extensions="extensions"
                                @change="yamlCodeChange"
                            />
                        </div>
                        <div class="vresize" :title="$t('dragResizeNote')" @pointerdown="startHeightDrag($event, 'editYaml')" @dblclick="resetHeight('editYaml')">
                            <font-awesome-icon icon="grip-lines" />
                        </div>
                    </div>

                    <!-- Override editor. The file is optional, so the panel
                         shows an editor when the file exists and a create
                         button when it does not. A stack from an agent
                         without override support shows no panel. -->
                    <div v-if="hasOverride" class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ overrideFileName }}</span>
                            <button class="mini-btn expand-btn" @click="$refs.confirmDeleteOverride.show()">
                                {{ $t("deleteOverride") }}
                            </button>
                        </div>
                        <div class="editor-box edit-mode" :class="{ 'h-fixed': panelHeights.editOverride }" :style="panelVar('editOverride')">
                            <code-mirror
                                v-model="stack.composeOverrideYAML"
                                v-bind="editorProps"
                                :extensions="extensions"
                            />
                        </div>
                        <div class="vresize" :title="$t('dragResizeNote')" @pointerdown="startHeightDrag($event, 'editOverride')" @dblclick="resetHeight('editOverride')">
                            <font-awesome-icon icon="grip-lines" />
                        </div>
                    </div>
                    <div v-else-if="overrideSupported && !isAdd" class="panel">
                        <div class="panel-head">
                            <span class="panel-title">{{ overrideFileName }}</span>
                            <button class="mini-btn expand-btn" @click="createOverride">
                                {{ $t("createOverride") }}
                            </button>
                        </div>
                    </div>

                    <!-- ENV editor: rows with a key field and a value
                         field, or the plain text. The text view is for
                         comments and special lines. -->
                    <div class="panel">
                        <div class="panel-head head-grow">
                            <span class="panel-title">.env</span>
                            <button class="mini-btn" @click="envEditorText = !envEditorText">
                                {{ envEditorText ? $t("envRowsView") : $t("envTextView") }}
                            </button>
                        </div>
                        <div v-if="envEditorText" class="editor-box edit-mode">
                            <code-mirror
                                v-model="stack.composeENV"
                                v-bind="editorProps"
                                :extensions="extensionsEnv"
                                @change="yamlCodeChange"
                            />
                        </div>
                        <EnvEditor
                            v-else
                            v-model="stack.composeENV"
                            @change="envCodeChange"
                        />
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

            <!-- Delete Override Dialog -->
            <Confirm ref="confirmDeleteOverride" btn-style="btn-danger" :yes-text="$t('deleteOverride')" :no-text="$t('cancel')" @yes="deleteOverride">
                {{ $t("deleteOverrideMsg") }}
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
    RUNNING,
    defaultComposeOverrideTemplate,
    POLL_INTERVAL_DEFAULT,
} from "../../../common/util-common";
import { formatPorts, formatUptime } from "../util-frontend";
import NetworkInput from "../components/NetworkInput.vue";
import Confirm, { isDialogOpen } from "../components/Confirm.vue";
import Container from "../components/Container.vue";
import ContainerActions from "../components/ContainerActions.vue";
import EnvEditor from "../components/EnvEditor.vue";
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

export default {
    components: {
        NetworkInput,
        FontAwesomeIcon,
        CodeMirror,
        Confirm,
        Container,
        ContainerActions,
        EnvEditor,
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
    /**
     * The container editor and its inputs get this page with inject. A
     * chain of $parent broke when a component moved to a different
     * depth.
     * @returns {object} the provided values
     */
    provide() {
        return {
            composePage: this,
        };
    },

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
            // Width of the compose panel, as a percent of the split. 0 hides
            // the compose panel and 100 hides the override panel.
            splitLeft: 50,
            editSnapshot: null,
            // Content of an override file that the user deleted. The save
            // removes the file, so a new create gives this content back.
            discardedOverride: null,
            // True when the container table fits. Below this the page shows
            // cards instead. Only one of the two renders at a time.
            wideLayout: true,
            wideLayoutQuery: null,
            // True while exitConfirm holds a navigation, from the moment the
            // dialog opens until the choice is complete
            leaving: false,
            // Resolves the open dialog with the user's choice
            leaveResolve: null,
            // State of the merged configuration overlay. The sequence
            // number makes the answer and the timer of an earlier request
            // stale, so they cannot write over a later request.
            mergedConfigLoading: false,
            mergedConfigError: "",
            mergedConfigYAML: "",
            mergedConfigSeq: 0,
            // The i18n key of the note in the overlay head. It names the
            // source of the content.
            mergedConfigNoteKey: "mergedConfigDiskNote",
            // True shows the .env text editor, false shows the rows
            envEditorText: false,
            // Heights that the user sets with the drag handles, in pixels.
            // A null gives the default layout. The values are not saved.
            panelHeights: {
                files: null,
                logs: null,
                editYaml: null,
                editOverride: null,
            },
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
         * True when the agent knows the override file. A stack from an old
         * agent has no composeOverrideYAML field, and the page then hides
         * the override panels and sends the old four-argument save.
         * @return {boolean}
         */
        overrideSupported() {
            return this.stack.composeOverrideYAML !== undefined;
        },

        /**
         * True when the override file exists, or when the editor holds new
         * override content that a save writes.
         * @return {boolean}
         */
        hasOverride() {
            return typeof this.stack.composeOverrideYAML === "string";
        },

        overrideFileName() {
            return this.stack.composeOverrideFileName;
        },

        /**
         * The git state of the stack directory, or null. A stack from an
         * agent without git support has no gitInfo field, thus the badge and
         * the pull button stay hidden for it.
         * @return {object|null}
         */
        gitInfo() {
            return this.stack.gitInfo ?? null;
        },

        /**
         * The properties that each editor has in common. The extensions and
         * the model stay with each editor, because they are not the same.
         * @returns {object}
         */
        editorProps() {
            return {
                minimal: true,
                wrap: "true",
                dark: "true",
                tab: "true",
                hasFocus: this.editorFocus,
            };
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
            // currentEditState lists the fields, so a new field gets a dirty
            // mark without a change here. The name and the endpoint exist
            // only in add mode, but they hold work that the user must not
            // lose without a question.
            const current = this.currentEditState();
            return Object.keys(current).some((key) => current[key] !== this.editSnapshot[key]);
        },

        serviceCount() {
            return Object.keys(this.jsonConfig.services ?? {}).length;
        },

        /**
         * Milliseconds between two status polls. The seconds come from the
         * settings, through the info event. A value outside the limits
         * gives the default of 5 seconds. This is the same value as
         * dockge uses.
         * @return {number}
         */
        pollIntervalMs() {
            return POLL_INTERVAL_DEFAULT * 1000;
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

        /**
         * The merged overlay is not on screen after each change away from
         * it, thus the request that fills it must end. One watcher covers
         * each writer of expandedPanel. Without this, the buttons that
         * watch mergedConfigLoading stay disabled until the timer fires.
         * @param {string|null} value the panel that is open now
         */
        expandedPanel(value) {
            if (value !== "merged") {
                this.cancelMergedConfig();
            }
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
            let composeENV = envDefault;

            if (this.$root.composeTemplate) {
                composeYAML = this.$root.composeTemplate;
                this.$root.composeTemplate = "";
            } else {
                composeYAML = template;
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
        // The flag makes the timers and the answers of this page quiet.
        // Without it, a late answer of a pull loads the stack for a page
        // that no longer exists, and its request puts this client back in
        // the log terminal on the server.
        this.pageGone = true;

        window.removeEventListener("keydown", this.onComposeKeydown);
        window.removeEventListener("beforeunload", this.onBeforeUnload);
        this.wideLayoutQuery?.removeEventListener("change", this.onWideLayoutChange);
        this.endSplitDrag();
        this.endHeightDrag();

        // The next sequence number makes a late merged configuration
        // answer stale, so it cannot show a toast on a different page
        this.cancelMergedConfig();
        clearTimeout(this.yamlErrorTimeout);

        // The page can be destroyed without a route change, for example
        // when a failed login hides the router view. The router guard does
        // not run then. The status polls arm each other and would
        // continue, and the server would keep this client in the log
        // terminal. A second call does no damage.
        this.exitAction();
    },
    methods: {
        /**
         * Close an expanded logs/yaml overlay with Escape.
         * @param {KeyboardEvent} e keydown event
         * @returns {void}
         */
        onComposeKeydown(e) {
            if (e.key !== "Escape" || !this.expandedPanel) {
                return;
            }

            // A dialog on top owns the Escape key. Without this, one press
            // closes the dialog and the overlay below it together. The
            // count comes from the dialog component, because bootstrap
            // removes its own class before this handler runs.
            if (isDialogOpen()) {
                return;
            }

            this.toggleExpand(this.expandedPanel);
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
         * The terminal watches its own box, thus it fits itself after the
         * size change.
         * @param {string} which "logs", "yaml", "override" or "merged"
         * @returns {void}
         */
        toggleExpand(which) {
            this.expandedPanel = (this.expandedPanel === which) ? null : which;
        },

        /**
         * End the wait for a merged configuration request. The next
         * sequence number makes a late answer and the timer stale.
         * @returns {void}
         */
        cancelMergedConfig() {
            this.mergedConfigSeq++;
            clearTimeout(this.mergedConfigTimer);
            this.mergedConfigLoading = false;
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
         * Stop the drag.
         * @returns {void}
         */
        endSplitDrag() {
            document.removeEventListener("mousemove", this.onSplitDrag);
            document.removeEventListener("mouseup", this.endSplitDrag);
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
         * Change between the table and the cards when the window changes.
         * @param {MediaQueryListEvent} e the media query change
         * @returns {void}
         */
        onWideLayoutChange(e) {
            this.wideLayout = e.matches;
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
            const height = drag.startHeight + drag.lastY - drag.startY;
            this.panelHeights[drag.key] = Math.min(window.innerHeight * 2, Math.max(150, Math.round(height)));
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
         * Give a panel its default height back.
         * @param {string} key name of the height
         * @returns {void}
         */
        resetHeight(key) {
            this.panelHeights[key] = null;
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
            clearTimeout(this.serviceStatusTimeout);
            this.serviceStatusTimeout = setTimeout(async () => {
                this.requestServiceStatus();
            }, this.pollIntervalMs);
        },

        startDockerStatsTimeout() {
            clearTimeout(this.dockerStatsTimeout);
            this.dockerStatsTimeout = setTimeout(async () => {
                this.requestDockerStats();
            }, this.pollIntervalMs);
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
            clearTimeout(this.serviceStatusTimeout);
            clearTimeout(this.dockerStatsTimeout);

            // Leave Combined Terminal
            console.debug("leaveCombinedTerminal", this.endpoint, this.stack.name);
            this.$root.emitAgent(this.endpoint, "leaveCombinedTerminal", this.stack.name, () => {});
        },

        bindTerminal() {
            this.$refs.progressTerminal?.bind(this.endpoint, this.terminalName);
        },

        /**
         * Get the stack from the server.
         * @param {Function} [callback] runs after the stack arrives
         * @returns {void}
         */
        loadStack(callback) {
            this.processing = true;
            this.$root.emitAgent(this.endpoint, "getStack", this.stack.name, (res) => {
                this.processing = false;
                if (res.ok) {
                    this.stack = res.stack;
                    this.discardedOverride = null;
                    this.yamlCodeChange();
                    this.bindTerminal();
                    callback?.();
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

            // Hold the values that go to the server, because the editors stay
            // usable while the reply travels
            const sent = this.currentEditState();

            this.$root.emitAgent(this.stack.endpoint, "deployStack", ...this.stackSaveArgs(sent), (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.applySavedState(sent);
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

                this.$root.emitAgent(this.stack.endpoint, "saveStack", ...this.stackSaveArgs(sent), (res) => {
                    clearTimeout(timer);
                    this.processing = false;
                    this.$root.toastRes(res);

                    if (res.ok) {
                        // A reply that comes after the timeout must still
                        // clear the dirty mark, or the editor asks to save a
                        // file that the server already has.
                        this.applySavedState(sent);
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

        /**
         * Open the merged configuration overlay and send a request for its
         * content. The overlay shows the error text of docker if the
         * configuration is not correct. A timer ends the wait if an agent
         * does not answer.
         * @param {string} noteKey i18n key of the note in the overlay head
         * @param {string} event name of the socket event
         * @param {...*} args arguments of the event
         * @returns {void}
         */
        openMergedConfig(noteKey, event, ...args) {
            this.expandedPanel = "merged";
            this.mergedConfigNoteKey = noteKey;
            this.mergedConfigLoading = true;
            this.mergedConfigError = "";
            this.mergedConfigYAML = "";

            const seq = ++this.mergedConfigSeq;
            clearTimeout(this.mergedConfigTimer);
            this.mergedConfigTimer = setTimeout(() => {
                if (seq !== this.mergedConfigSeq) {
                    return;
                }
                this.mergedConfigLoading = false;
                this.mergedConfigError = this.$t("requestTimeout");
            }, 30000);

            this.$root.emitAgent(this.endpoint, event, ...args, (res) => {
                if (seq !== this.mergedConfigSeq) {
                    return;
                }
                clearTimeout(this.mergedConfigTimer);
                this.mergedConfigLoading = false;

                if (res.ok) {
                    this.mergedConfigYAML = res.composeConfig;
                    this.mergedConfigError = res.configError || "";
                } else {
                    // A protocol error, for example an expired login. This
                    // is not an error of the configuration, thus it also
                    // goes to the usual toast.
                    this.$root.toastRes(res);
                    this.mergedConfigError = res.msgi18n ? this.$t(res.msg) : (res.msg ?? "");
                }
            });
        },

        /**
         * Show the merged configuration of the files on the disk.
         * @returns {void}
         */
        showMergedConfig() {
            this.openMergedConfig("mergedConfigDiskNote", "getComposeConfig", this.stack.name);
        },

        /**
         * Examine the editor content with docker, before a save writes it.
         * The agent puts the content in a temporary directory, thus the
         * files of the stack do not change.
         * @returns {void}
         */
        validateCompose() {
            this.openMergedConfig(
                "mergedConfigEditorNote",
                "validateCompose",
                this.stack.name ?? "",
                this.stack.composeYAML,
                this.stack.composeENV,
                this.hasOverride ? this.stack.composeOverrideYAML : null,
            );
        },

        /**
         * Pull the git checkout of the stack, then deploy it. The output
         * of git goes to the progress terminal. The page then loads the
         * stack again, also after a failure. A pull can change the files
         * on the disk although the deploy fails.
         * @returns {void}
         */
        gitPullStack() {
            this.processing = true;

            // A pull and a deploy is the longest action of the page. An
            // agent that disconnects during it never answers, and the
            // toolbar would stay disabled until a page reload. The timer
            // gives the buttons back. A pull can be slow, thus the time is
            // longer than the other timers. The handle stays in this
            // function, so a later action cannot stop the timer of an
            // earlier one. The pageGone flag makes the timer and the
            // answer quiet after the page goes away.
            let settled = false;
            const timer = setTimeout(() => {
                if (settled || this.pageGone) {
                    return;
                }
                settled = true;
                this.processing = false;
                this.$root.toastError(this.$t("requestTimeout"));
            }, 300000);

            this.$root.emitAgent(this.endpoint, "gitPullStack", this.stack.name, (res) => {
                clearTimeout(timer);

                if (this.pageGone) {
                    return;
                }

                if (!settled) {
                    settled = true;
                    this.$root.toastRes(res);

                    // loadStack keeps processing true until the new content
                    // arrives, thus the toolbar stays closed while the page
                    // shows the files from before the pull
                    this.loadStack();
                    return;
                }

                // A late answer, after the timeout. A pull can change the
                // files on the disk, so the page loads them — but never
                // over an open edit session or an action that runs.
                if (!this.processing && !this.isEditMode) {
                    this.loadStack();
                }
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
            // Leave edit mode only after the stack arrives, or view mode
            // shows the content that the user discarded
            this.loadStack(() => {
                this.isEditMode = false;
            });
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

                clearTimeout(this.yamlErrorTimeout);
                this.yamlError = "";
            } catch (e) {
                this.showYamlError(e);
            }
        },

        /**
         * Recompute the substituted view after an env change from the row
         * editor. This does not rebuild jsonConfig, because a rebuild
         * writes the compose YAML again and loses the formatting of the
         * user. The compose text did not change here.
         * @returns {void}
         */
        envCodeChange() {
            try {
                // envsubstYAML refuses a text with a parse error, thus an
                // error of the raw text surfaces here too
                const env = dotenv.parse(this.stack.composeENV);
                const envYAML = envsubstYAML(this.stack.composeYAML, env);
                this.envsubstJSONConfig = this.yamlToJSON(envYAML).config;

                clearTimeout(this.yamlErrorTimeout);
                this.yamlError = "";
            } catch (e) {
                this.showYamlError(e);
            }
        },

        /**
         * Show a YAML error message. The first error waits, so a message
         * does not flash during typing.
         * @param {Error} e the error
         * @returns {void}
         */
        showYamlError(e) {
            clearTimeout(this.yamlErrorTimeout);

            if (this.yamlError) {
                this.yamlError = e.message;
            } else {
                this.yamlErrorTimeout = setTimeout(() => {
                    this.yamlError = e.message;
                }, 3000);
            }
        },

        enableEditMode() {
            // The expanded overlay lives in view mode; leaving it set would
            // strand a full-viewport backdrop over the edit form. The
            // expandedPanel watcher then ends a merged configuration
            // request that still waits.
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
                override: this.stack.composeOverrideYAML ?? null,
                name: this.stack.name ?? "",
                endpoint: this.stack.endpoint ?? "",
            };
        },

        /**
         * True when the override of this state is different from the file on
         * the server. The snapshot always holds what the server has.
         * @param {object} state a state from currentEditState
         * @returns {boolean}
         */
        overrideChanged(state) {
            return this.overrideSupported && state.override !== (this.editSnapshot?.override ?? null);
        },

        /**
         * The arguments for a saveStack or a deployStack event.
         *
         * The override goes to the server only when the user changed it. A
         * save that always sent the override could remove a file that another
         * user made after this page loaded. An old agent also reads a fifth
         * argument as the acknowledge function, thus an agent without override
         * support always gets four arguments.
         * @param {object} sent the state that goes to the server
         * @returns {Array} the arguments for the event
         */
        stackSaveArgs(sent) {
            const args = [ sent.name, sent.yaml, sent.env, this.isAdd ];
            if (this.overrideChanged(sent)) {
                args.push(sent.override);
            }
            return args;
        },

        /**
         * Record the state that the server accepted. The baseline is what the
         * server has, not the buffer, because the user can edit while the
         * reply travels. An empty override tells the server to remove the
         * file, so the editor then shows no override.
         * @param {object} sent the state that went to the server
         * @returns {void}
         */
        applySavedState(sent) {
            let override = sent.override;

            if (this.overrideChanged(sent) && typeof override === "string" && override.trim() === "") {
                override = null;
            }

            // Change the editor only when the user did not edit it in the
            // interval, and only for an agent that supports the override
            if (this.overrideSupported && (this.stack.composeOverrideYAML ?? null) === sent.override) {
                this.stack.composeOverrideYAML = override;
            }

            this.discardedOverride = null;
            this.editSnapshot = {
                ...sent,
                override,
            };
        },

        /**
         * Put content in the override editor. A delete keeps the content
         * until the save, thus the user gets it back here. If there is no
         * such content, the template gives an empty services map, which is a
         * file that docker accepts.
         * @returns {void}
         */
        createOverride() {
            if (this.discardedOverride !== null) {
                this.stack.composeOverrideYAML = this.discardedOverride;
                this.discardedOverride = null;
                return;
            }

            // The settings page holds the template. A server that does not
            // send one, or an error, gives the default text.
            this.$root.getSocket().emit("getSettings", (res) => {
                const template = res?.ok ? res.data?.composeOverrideTemplate : null;
                this.stack.composeOverrideYAML = template || defaultComposeOverrideTemplate;
            });
        },

        /**
         * Mark the override file for removal. The save removes the file. The
         * content stays here until then, so a new create can give it back.
         * @returns {void}
         */
        deleteOverride() {
            this.discardedOverride = this.stack.composeOverrideYAML;
            this.stack.composeOverrideYAML = null;
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

/* Branch and dirty mark of a stack that is a git checkout */
.git-badge {
    font-size: 12px;
    color: var(--bs-secondary-color);
    border: 1px solid var(--bs-border-color);
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
    white-space: nowrap;
    flex: 0 0 auto;
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

/* Compose + override split: shares the remaining viewport height with the
   logs panel below it */
.panel-split {
    flex: 3 1 0;
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
    min-height: 300px;
    margin-bottom: 0.5rem;

    .panel {
        min-width: 0;
        margin-bottom: 0;
        // The editor must stay in its own box. Without this, a short window
        // lets the text of the editor go over the panel below.
        overflow: hidden;
    }

    // The divider sets the width of the first panel. The second takes what
    // is left, so the two always fill the row.
    .split-a {
        flex: 0 0 var(--split-left, 50%);
    }

    .split-b {
        flex: 1 1 0;
    }

    // Without an override file the compose panel is alone in the row
    .split-solo {
        flex: 1 1 auto;
    }

    .split-gone {
        display: none;
    }

    @media (max-width: 991.98px) {
        flex-direction: column;

        // The two panels are now one above the other, thus this row needs the
        // height of both. With a share of the height it becomes shorter than
        // its content, and the content goes over the panel below.
        flex: 0 0 auto;
        min-height: 0;

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

// A thin bar. The grip and the buttons are centred on it and may reach a
// little over each panel, which keeps the bar itself narrow.
.split-bar {
    flex: 0 0 6px;
    position: relative;
    cursor: col-resize;

    .split-grip {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 9px;
        line-height: 1;
        color: var(--bs-border-color);
        transition: color 0.15s;
    }

    &:hover .split-grip {
        color: var(--bs-secondary-color);
    }

    // The buttons appear on hover, so the bar stays quiet the rest of time
    &:hover .split-actions,
    .split-actions:focus-within {
        opacity: 1;
        pointer-events: auto;
    }
}

.split-actions {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 1px;
    border-radius: 4px;
    background-color: var(--bs-body-bg);
    border: 1px solid var(--bs-border-color);
    box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
}

.split-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    font-size: 8.5px;
    line-height: 1;
    cursor: pointer;
    color: var(--bs-secondary-color);
    background: transparent;
    border: 0;
    border-radius: 2px;

    &:hover {
        color: var(--bs-body-color);
        background-color: var(--bs-tertiary-bg);
    }
}

/* A thin bar below a panel. Drag it to change the height of the panel. */
.vresize {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 10px;
    margin-bottom: 0.4rem;
    cursor: row-resize;
    color: var(--bs-border-color);
    font-size: 10px;
    // The browser must give the pointer to the drag, not to the scroll
    touch-action: none;

    &:hover {
        color: var(--bs-secondary-color);
    }
}

/* Logs below the split, full width */
.logs-panel {
    flex: 2 1 0;
    min-height: 260px;
    overflow: hidden;

    // The panels above take their full height on a narrow window, thus this
    // panel keeps its own height and the page scrolls.
    @media (max-width: 991.98px) {
        flex: 0 0 auto;
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

/* A height from a drag handle. The variable comes from panelVar. This
   rule is after the panel rules, thus it wins over their flex values. */
.h-fixed {
    height: var(--panel-h);
    min-height: 150px;
    flex: 0 0 auto;
}

.editor-box.h-fixed {
    // Beats the `.panel .editor-box { min-height: 300px }` rule, so the
    // drag can go down to the same 150px floor as the other panels
    min-height: 150px;
    overflow: auto;
}

/* The stacked file panels of a narrow window need their full height,
   thus the fixed height and its handle do not apply there */
@media (max-width: 991.98px) {
    .panel-split.h-fixed {
        height: auto;
        min-height: 0;
        flex: 0 0 auto;
    }

    .vresize-files {
        display: none !important;
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

/* The expanded overlay fills the screen, also with a fixed height */
.panel.pop.h-fixed {
    height: auto;
    min-height: 0;
}

/* ---------- merged configuration overlay ---------- */
.merged-body {
    overflow: auto;
}

.merged-error {
    margin: 0;
    padding: 1rem;
    color: var(--bs-danger);
    white-space: pre-wrap;
}

/* The title takes the free space, so the buttons of this head need no
   margin of their own */
.head-grow .panel-title {
    margin-right: auto;
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
