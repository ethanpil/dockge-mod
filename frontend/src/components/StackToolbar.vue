<template>
    <div class="toolbar">
        <template v-if="isEditMode">
            <button class="btn btn-primary" :disabled="processing" @click="$emit('deploy')">
                <font-awesome-icon icon="rocket" class="me-1" />
                {{ $t("deployStack") }}
            </button>

            <button
                class="btn"
                :class="isDirty ? 'btn-success' : 'btn-normal'"
                :disabled="processing || (!isDirty && !isAdd)"
                @click="$emit('save')"
            >
                <font-awesome-icon icon="save" class="me-1" />
                {{ $t("saveStackDraft") }}<template v-if="isDirty"> &#9679;</template>
            </button>

            <!-- Examine the editor content with docker, before a
                 save writes it. The guard is approximate: it
                 tests override support. An agent without the
                 event does not answer, and the timer of the
                 overlay then ends the wait. -->
            <button v-if="isAdd || overrideSupported" class="btn btn-normal" :disabled="processing || mergedConfigLoading" :title="$t('validateConfigNote')" @click="$emit('validate')">
                <font-awesome-icon icon="check-double" class="me-1" />
                {{ $t("validateConfig") }}
            </button>

            <button v-if="!isAdd" class="btn btn-normal ms-auto" :disabled="processing" @click="$emit('discard')">{{ $t("discardStack") }}</button>
        </template>

        <template v-else>
            <!-- The main action: start a stack that is down, edit one that runs -->
            <button class="btn" :class="active ? 'btn-primary' : 'btn-normal'" :disabled="processing" @click="$emit('edit')">
                <font-awesome-icon icon="pen" class="me-1" />
                {{ $t("editStack") }}
            </button>

            <div class="btn-group" role="group">
                <button v-if="!active" class="btn btn-primary" :disabled="processing" @click="$emit('start')">
                    <font-awesome-icon icon="play" class="me-1" />
                    {{ $t("startStack") }}
                </button>

                <button v-if="active" class="btn btn-normal" :disabled="processing" @click="$emit('restart')">
                    <font-awesome-icon icon="rotate" class="me-1" />
                    {{ $t("restartStack") }}
                </button>

                <button v-if="active" class="btn btn-normal" :disabled="processing" @click="$emit('stop')">
                    <font-awesome-icon icon="stop" class="me-1" />
                    {{ $t("stopStack") }}
                </button>

                <button class="btn btn-normal" :disabled="processing" :title="$t('downStackNote')" @click="$emit('down')">
                    {{ $t("downStack") }}
                </button>
            </div>

            <div class="btn-group" role="group">
                <button class="btn btn-normal" :disabled="processing" :title="$t('updateStackNote')" @click="$emit('update')">
                    <font-awesome-icon icon="cloud-arrow-down" class="me-1" />
                    {{ $t("updateStack") }}
                    <!-- The update check found an image with a new version -->
                    <span v-if="imageUpdates > 0" class="update-count" :title="$t('updateAvailableCount', { n: imageUpdates })">{{ imageUpdates }}</span>
                </button>

                <!-- Only an agent of dockge-mod checks the images of one
                     stack. The button stays quiet while a check runs. -->
                <button
                    v-if="!isAdd && showBackups"
                    class="btn btn-normal"
                    :disabled="checkRunning"
                    :title="$t('checkUpdatesForStack')"
                    @click="$emit('check-updates')"
                >
                    <font-awesome-icon :icon="checkRunning ? 'spinner' : 'arrows-rotate'" :spin="checkRunning" class="me-1" />
                    {{ $t("checkUpdates") }}
                </button>
            </div>

            <!-- A detached HEAD cannot pull, thus no button for it -->
            <button v-if="gitInfo && !gitInfo.isDetached" class="btn btn-normal" :disabled="processing" @click="$emit('git-pull')">
                <font-awesome-icon icon="code-branch" class="me-1" />
                {{ $t("gitPullRedeploy") }}
            </button>

            <!-- Only an agent of dockge-mod keeps backups -->
            <button v-if="!isAdd && showBackups" class="btn btn-normal" :disabled="processing" @click="$emit('backups')">
                <font-awesome-icon icon="box-archive" class="me-1" />
                {{ $t("backups") }}
            </button>

            <button class="btn btn-outline-danger ms-auto" :disabled="processing" @click="$emit('delete')">
                <font-awesome-icon icon="trash" class="me-1" />
                {{ $t("deleteStack") }}
            </button>
        </template>
    </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

/**
 * The action buttons of the compose page. The page keeps the handlers
 * and gets one event for each button.
 */
export default {
    components: {
        FontAwesomeIcon,
    },
    props: {
        processing: {
            type: Boolean,
            default: false,
        },
        isEditMode: {
            type: Boolean,
            default: false,
        },
        isAdd: {
            type: Boolean,
            default: false,
        },
        /** True when the stack runs */
        active: {
            type: Boolean,
            default: false,
        },
        /** True when edit mode holds changes that are not saved */
        isDirty: {
            type: Boolean,
            default: false,
        },
        /** True when the agent knows the override file */
        overrideSupported: {
            type: Boolean,
            default: false,
        },
        /** True while the merged configuration overlay waits for an answer */
        mergedConfigLoading: {
            type: Boolean,
            default: false,
        },
        /** The git state of the stack directory, or null */
        gitInfo: {
            type: Object,
            default: null,
        },
        /** The count of images with a new version */
        imageUpdates: {
            type: Number,
            default: 0,
        },
        /** True while a check of the images of this host runs */
        checkRunning: {
            type: Boolean,
            default: false,
        },
        /** True when the agent has the backup events */
        showBackups: {
            type: Boolean,
            default: false,
        },
    },
    emits: [
        "deploy",
        "validate",
        "save",
        "edit",
        "start",
        "restart",
        "update",
        "check-updates",
        "git-pull",
        "stop",
        "backups",
        "down",
        "discard",
        "delete",
    ],
};
</script>

<style scoped lang="scss">
.toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;

    .btn {
        padding: 0.3rem 0.75rem;
        font-size: 13px;
        white-space: nowrap;
    }
}

// The count of images with a new version, inside the Update button
.update-count {
    display: inline-block;
    min-width: 1.4em;
    margin-left: 0.3rem;
    padding: 0 0.4em;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    color: var(--bs-warning-text-emphasis);
    background-color: var(--bs-warning-bg-subtle);
}
</style>
