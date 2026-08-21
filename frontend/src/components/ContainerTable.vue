<template>
    <div class="panel">
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
                            <div v-if="row.first" class="act-row">
                                <button type="button" class="mini-btn" :title="$t('serviceLogs')" :disabled="processing" @click="$emit('service-logs', row.service)">
                                    <font-awesome-icon icon="file-lines" />
                                </button>
                                <ContainerActions
                                    :status="row.status"
                                    :service-count="serviceCount"
                                    :processing="processing"
                                    :bash-to="bashLink(row.service)"
                                    @start="$emit('start-service', row.service)"
                                    @restart="$emit('restart-service', row.service)"
                                    @stop="$emit('stop-service', row.service)"
                                />
                            </div>
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
                    <button v-if="row.first" type="button" class="mini-btn ms-auto" :title="$t('serviceLogs')" :disabled="processing" @click="$emit('service-logs', row.service)">
                        <font-awesome-icon icon="file-lines" />
                    </button>
                    <ContainerActions
                        v-if="row.first"
                        :status="row.status"
                        :service-count="serviceCount"
                        :processing="processing"
                        :bash-to="bashLink(row.service)"
                        @start="$emit('start-service', row.service)"
                        @restart="$emit('restart-service', row.service)"
                        @stop="$emit('stop-service', row.service)"
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
</template>

<script>
import { parseDockerPort } from "../../../common/util-common";
import { formatPorts, formatUptime } from "../util-frontend";
import ContainerActions from "./ContainerActions.vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

/**
 * The containers of a stack in view mode: a dense table, or stacked
 * cards on a narrow window. The page keeps the service actions and gets
 * one event for each of them.
 */
export default {
    components: {
        ContainerActions,
        FontAwesomeIcon,
    },
    props: {
        /** The services of the compose file */
        services: {
            type: Object,
            default: () => ({}),
        },
        /** The services after env substitution. The image comes from here. */
        envsubstServices: {
            type: Object,
            default: () => ({}),
        },
        /** The container instances of each service */
        serviceStatusList: {
            type: Object,
            default: () => ({}),
        },
        /** The docker stats of each container, by container name */
        dockerStats: {
            type: Object,
            default: () => ({}),
        },
        stack: {
            type: Object,
            required: true,
        },
        endpoint: {
            type: String,
            default: "",
        },
        processing: {
            type: Boolean,
            default: false,
        },
    },
    emits: [
        "start-service",
        "stop-service",
        "restart-service",
        "service-logs",
    ],
    data() {
        return {
            // True when the container table fits. Below this the page shows
            // cards instead. Only one of the two renders at a time.
            wideLayout: true,
            wideLayoutQuery: null,
        };
    },
    computed: {
        serviceCount() {
            return Object.keys(this.services ?? {}).length;
        },

        /**
         * One row per container instance of every service, joined with the
         * docker stats when the container is running. Services that have no
         * container yet still get a placeholder row.
         * @return {object[]}
         */
        containerRows() {
            const rows = [];
            for (const service of Object.keys(this.services ?? {})) {
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
    },
    mounted() {
        // Same value as the bootstrap md breakpoint
        this.wideLayoutQuery = window.matchMedia("(min-width: 768px)");
        this.wideLayout = this.wideLayoutQuery.matches;
        this.wideLayoutQuery.addEventListener("change", this.onWideLayoutChange);
    },
    unmounted() {
        this.wideLayoutQuery?.removeEventListener("change", this.onWideLayoutChange);
    },
    methods: {
        /**
         * Change between the table and the cards when the window changes.
         * @param {MediaQueryListEvent} e the media query change
         * @returns {void}
         */
        onWideLayoutChange(e) {
            this.wideLayout = e.matches;
        },

        /**
         * Resolved image of a service after env substitution.
         * @param {string} service service name
         * @returns {string} image reference
         */
        imageOf(service) {
            return this.envsubstServices?.[service]?.image ?? "";
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
    },
};
</script>

<style scoped lang="scss">
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

// The logs button and the actions menu on one line
.act-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.3rem;
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
