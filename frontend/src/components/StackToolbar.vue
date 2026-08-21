<template>
    <div class="toolbar ms-auto">
        <div class="btn-group btn-group-sm me-2" role="group">
            <button v-if="isEditMode" class="btn btn-primary" :disabled="processing" @click="$emit('deploy')">
                <font-awesome-icon icon="rocket" class="me-1" />
                {{ $t("deployStack") }}
            </button>

            <!-- Examine the editor content with docker, before a
                 save writes it. The guard is approximate: it
                 tests override support. An agent without the
                 event does not answer, and the timer of the
                 overlay then ends the wait. -->
            <button v-if="isEditMode && (isAdd || overrideSupported)" class="btn btn-normal" :disabled="processing || mergedConfigLoading" :title="$t('validateConfigNote')" @click="$emit('validate')">
                <font-awesome-icon icon="check-double" class="me-1" />
                {{ $t("validateConfig") }}
            </button>

            <button
                v-if="isEditMode"
                class="btn"
                :class="isDirty ? 'btn-success' : 'btn-normal'"
                :disabled="processing || (!isDirty && !isAdd)"
                @click="$emit('save')"
            >
                <font-awesome-icon icon="save" class="me-1" />
                {{ $t("saveStackDraft") }}<template v-if="isDirty"> &#9679;</template>
            </button>

            <button v-if="!isEditMode" class="btn btn-secondary" :disabled="processing" @click="$emit('edit')">
                <font-awesome-icon icon="pen" class="me-1" />
                {{ $t("editStack") }}
            </button>

            <button v-if="!isEditMode && !active" class="btn btn-primary" :disabled="processing" @click="$emit('start')">
                <font-awesome-icon icon="play" class="me-1" />
                {{ $t("startStack") }}
            </button>

            <button v-if="!isEditMode && active" class="btn btn-normal" :disabled="processing" @click="$emit('restart')">
                <font-awesome-icon icon="rotate" class="me-1" />
                {{ $t("restartStack") }}
            </button>

            <button v-if="!isEditMode" class="btn btn-normal" :disabled="processing" @click="$emit('update')">
                <font-awesome-icon icon="cloud-arrow-down" class="me-1" />
                {{ $t("updateStack") }}
            </button>

            <!-- Not a button. The update check found an image with a new
                 version. -->
            <span v-if="!isEditMode && imageUpdates > 0" class="btn btn-normal update-pill" :title="$t('updateAvailableCount', { n: imageUpdates })">
                <font-awesome-icon icon="arrow-up" class="me-1" />
                {{ $t("updateAvailable") }}
            </span>

            <!-- A detached HEAD cannot pull, thus no button for it -->
            <button v-if="!isEditMode && gitInfo && !gitInfo.isDetached" class="btn btn-normal" :disabled="processing" @click="$emit('git-pull')">
                <font-awesome-icon icon="code-branch" class="me-1" />
                {{ $t("gitPullRedeploy") }}
            </button>

            <button v-if="!isEditMode && active" class="btn btn-normal" :disabled="processing" @click="$emit('stop')">
                <font-awesome-icon icon="stop" class="me-1" />
                {{ $t("stopStack") }}
            </button>

            <!-- Only an agent of dockge-mod keeps backups -->
            <button v-if="!isEditMode && !isAdd && showBackups" class="btn btn-normal" :disabled="processing" @click="$emit('backups')">
                <font-awesome-icon icon="box-archive" class="me-1" />
                {{ $t("backups") }}
            </button>

            <!-- The down menu is a view mode action, the same as the
                 other stack actions -->
            <button v-if="!isEditMode" type="button" class="btn btn-normal dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false">
                <span class="visually-hidden">{{ $t("downStack") }}</span>
            </button>
            <ul v-if="!isEditMode" class="dropdown-menu dropdown-menu-end">
                <li>
                    <button type="button" class="dropdown-item" @click="$emit('down')">
                        <font-awesome-icon icon="stop" class="me-1" />
                        {{ $t("downStack") }}
                    </button>
                </li>
            </ul>
        </div>

        <button v-if="isEditMode && !isAdd" class="btn btn-sm btn-normal" :disabled="processing" @click="$emit('discard')">{{ $t("discardStack") }}</button>
        <button v-if="!isEditMode" class="btn btn-sm btn-outline-danger" :disabled="processing" @click="$emit('delete')">
            <font-awesome-icon icon="trash" class="me-1" />
            {{ $t("deleteStack") }}
        </button>
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
    gap: 0.25rem;
    flex-wrap: wrap;

    .btn {
        padding: 0.15rem 0.5rem;
        font-size: 12px;
    }

    // A pill in the button group. It is not a button.
    .update-pill {
        cursor: default;
        color: var(--bs-info);
        pointer-events: auto;
    }
}
</style>
