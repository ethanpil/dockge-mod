<template>
    <div class="stats-container">
        <div class="stats-title">
            {{ name }}
        </div>

        <div class="d-flex justify-content-between stats gap-2 mt-1">
            <div class="stat">
                <div class="stat-label">
                    {{ $t('uptime') }}
                </div>
                <div>
                    {{ info.uptime || "-" }}
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('ipAddress') }}
                </div>
                <div>
                    {{ info.ip || "-" }}
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $tc('port', 2) }}
                </div>
                <div>
                    {{ info.ports || "-" }}
                </div>
            </div>
        </div>

        <!-- Only running containers are reported by `docker stats`. -->
        <div v-if="stat" class="d-flex justify-content-between stats gap-2 mt-1">
            <div class="stat">
                <div class="stat-label">
                    {{ $t('CPU') }}
                </div>
                <div>
                    {{ stat.CPUPerc }}
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('memory') }}
                </div>
                <div>
                    {{ stat.MemUsage }} ({{ stat.MemPerc }})
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('networkIO') }}
                </div>
                <div>
                    {{ stat.NetIO }}
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('blockIO') }}
                </div>
                <div>
                    {{ stat.BlockIO }}
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        name: {
            type: String,
            required: true
        },
        stat: {
            type: Object,
            default: null
        },
        info: {
            type: Object,
            default: () => ({})
        }
    },
};
</script>

<style lang="scss" scoped>
.stats-container {
    container-type: inline-size;

    .stats {
        container-type: inline-size;

        .stat {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
            overflow-wrap: anywhere;
        }

        @container (width < 420px) {
            flex-direction: column;

            .stat {
                flex-direction: row;
                gap: 6px;
            }

            .stat-label::after {
                content: ':'
            }
        }
    }
}

.stats {
    font-size: 0.8rem;
    color: var(--bs-secondary-color);
}

.stat-label {
    font-weight: bold;
}

.stats-title {
    font-size: 0.9rem;
    color: var(--bs-heading-color);
}
</style>
