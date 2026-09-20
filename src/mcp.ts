// File version: v0.01
// Description: MCP server for Homey Pro over stdio — devices, zones, flows, capability control
// Author: Per Norrfors
// Created: 2026-09-20
// Modified: 2026-09-20 - Initial implementation (Claude)

/**
 * Homey Pro as MCP tools, over stdio.
 *
 * This is a surface, not a second implementation: the OAuth2 chain (cloud token
 * → delegation JWT → Homey session, with refresh) lives in auth.ts and the REST
 * calls in homey-client.ts, exactly as the chat agent uses them. What this file
 * adds is the tool contract — names, schemas, annotations — and the shaping in
 * mcp-format.ts that keeps 84 devices from landing in a context window at once.
 *
 * The Homey is only reached on the first tool call that needs it, so a client
 * can list the tools without any tokens on disk.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getValidSession } from "./auth.js";
import { loadConfig } from "./config.js";
import { HomeyClient, type HomeyFlow } from "./homey-client.js";
import {
  DEFAULT_LIMIT,
  capabilityValues,
  deviceSummary,
  matchesFilter,
  paged,
  parseCapabilityValue,
  zonePaths,
  zoneSummaries,
} from "./mcp-format.js";

export const SERVER_NAME = "homey";

const INSTRUCTIONS = [
  "Controls Per's Homey Pro at home (Svinninge): lights, sockets, heating, locks, sensors and",
  "automation flows, over the Homey's local API.",
  "Start with homey_list_zones or homey_list_devices — device and flow ids are opaque UUIDs, so",
  "look them up by name or zone rather than guessing. Lists answer with one page plus",
  "total/has_more/next_offset; ask for the next page instead of raising the limit blindly.",
  "homey_list_devices reports what a device is and can do; homey_get_device reports its current",
  "values. Two zones can share a name (there is a Kontor on each floor), so use the full zone",
  "path when it matters. homey_set_capability changes the house for real and homey_run_flow",
  "starts an automation — say what you are about to do and let the user confirm before either.",
].join(" ");

/** The tool annotations, spelled out per tool rather than left at the SDK defaults. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const CONTROL = {
  // Not read-only, and destructive on purpose: this turns off freezers and unlocks doors.
  // Setting the same value twice leaves the same state, hence idempotent.
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const RUN_FLOW = {
  // A flow can do anything the house can do, and running it twice is not the same as once.
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** JSON in a text block — what MCP clients read. */
function reply(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/** An error the caller can act on, reported in the result rather than thrown at the protocol. */
function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/**
 * A Homey client, built once and reused.
 *
 * Lazily, because listing tools must work on a machine that has never run the
 * OAuth flow — and because a failure here has to reach the caller as a readable
 * message, not as a server that dies at startup.
 */
export function lazyClient(): () => Promise<HomeyClient> {
  let client: HomeyClient | undefined;
  return async () => {
    if (!client) {
      const config = loadConfig();
      client = new HomeyClient(config.homeyAddress, () =>
        getValidSession(config.oauth2, config.homeyAddress)
      );
    }
    return client;
  };
}

/**
 * Register every tool on a server.
 *
 * Takes the client factory so tests can hand in a fake Homey; the real one is
 * `lazyClient()`.
 */
export function createHomeyMcpServer(getClient: () => Promise<HomeyClient>): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: "0.01" },
    { instructions: INSTRUCTIONS }
  );

  const pageArgs = {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(DEFAULT_LIMIT)
      .describe("rows per page (max 100)"),
    offset: z.number().int().min(0).default(0).describe("rows to skip; use next_offset"),
  };

  // -- zones -------------------------------------------------------------

  server.registerTool(
    "homey_list_zones",
    {
      title: "List zones",
      description:
        "The zones (rooms) of the house as a tree: id, name, full path " +
        '("Svinninge > Övervåning > Kontor"), parent and how many devices are in each. ' +
        "Two zones can share a name, so the path is what identifies a room.",
      inputSchema: pageArgs,
      annotations: READ_ONLY,
    },
    async ({ limit, offset }) => {
      const client = await getClient();
      const [zones, devices] = await Promise.all([client.getZones(), client.getDevices()]);
      return reply(paged(zoneSummaries(zones, devices), limit, offset));
    }
  );

  // -- devices -----------------------------------------------------------

  server.registerTool(
    "homey_list_devices",
    {
      title: "List devices",
      description:
        "One page of devices: id, name, class, zone path, availability and which capabilities " +
        "each one has — what a device is and can do, not its current values (use homey_get_device " +
        "for those). Filter by zone path, class, name substring or a capability, all " +
        "case-insensitive: zone='Vardagsrum', class='light', capability='target_temperature'.",
      inputSchema: {
        ...pageArgs,
        zone: z.string().optional().describe('zone name or path substring, e.g. "Övervåning > Kontor"'),
        deviceClass: z
          .string()
          .optional()
          .describe('device class substring, e.g. "light", "socket", "thermostat", "lock"'),
        name: z.string().optional().describe('device name substring, e.g. "Takdimmer"'),
        capability: z
          .string()
          .optional()
          .describe('capability substring, e.g. "onoff", "dim", "measure_temperature"'),
        onlyAvailable: z
          .boolean()
          .default(false)
          .describe("skip devices Homey currently cannot reach"),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, offset, zone, deviceClass, name, capability, onlyAvailable }) => {
      const client = await getClient();
      const [devices, zones] = await Promise.all([client.getDevices(), client.getZones()]);
      const paths = zonePaths(zones);
      const rows = Object.values(devices)
        .map((device) => deviceSummary(device, paths.get(device.zone)))
        .filter((summary) => matchesFilter(summary, { zone, deviceClass, name, capability, onlyAvailable }))
        .sort((a, b) => a.zone.localeCompare(b.zone, "sv") || a.name.localeCompare(b.name, "sv"));
      return reply(paged(rows, limit, offset, { filtered_from: Object.keys(devices).length }));
    }
  );

  server.registerTool(
    "homey_get_device",
    {
      title: "Device details",
      description:
        "One device with its current capability values (onoff, dim, measure_temperature, " +
        "measure_power …), its class, zone path and whether Homey can reach it. Ids come from " +
        "homey_list_devices.",
      inputSchema: { deviceId: z.string().min(1).describe("device id (UUID) from homey_list_devices") },
      annotations: READ_ONLY,
    },
    async ({ deviceId }) => {
      const client = await getClient();
      const device = await client.getDevice(deviceId);
      const paths = zonePaths(await client.getZones());
      return reply({
        ...deviceSummary(device, paths.get(device.zone)),
        values: capabilityValues(device),
      });
    }
  );

  server.registerTool(
    "homey_set_capability",
    {
      title: "Set a device capability",
      description:
        "Set one capability on one device: onoff true/false, dim 0–1, target_temperature in " +
        "degrees, locked true/false. This changes the house for real — say what you are about to " +
        "do and let the user confirm first. The reply reports the value Homey holds afterwards.",
      inputSchema: {
        deviceId: z.string().min(1).describe("device id from homey_list_devices"),
        capability: z
          .string()
          .min(1)
          .describe('capability id, e.g. "onoff", "dim", "target_temperature", "locked"'),
        value: z
          .union([z.boolean(), z.number(), z.string()])
          .describe("the value: boolean for onoff/locked, number for dim (0–1) and temperatures"),
      },
      annotations: CONTROL,
    },
    async ({ deviceId, capability, value }) => {
      const client = await getClient();
      const device = await client.getDevice(deviceId);
      if (!(device.capabilities ?? []).includes(capability)) {
        return failure(
          `"${device.name}" has no capability "${capability}". It has: ` +
            `${(device.capabilities ?? []).join(", ") || "(none)"}.`
        );
      }
      const wanted = parseCapabilityValue(value);
      await client.setCapability(deviceId, capability, wanted);
      const after = await client.getDevice(deviceId);
      return reply({
        id: deviceId,
        name: device.name,
        capability,
        requested: wanted,
        value_now: capabilityValues(after)[capability],
      });
    }
  );

  // -- flows -------------------------------------------------------------

  server.registerTool(
    "homey_list_flows",
    {
      title: "List flows",
      description:
        "One page of automation flows, both kinds: `standard` (when-then) and `advanced` (the " +
        "canvas ones). Half of this house's flows are advanced and they live behind their own " +
        "endpoint, so both are listed here. Filter by name substring.",
      inputSchema: {
        ...pageArgs,
        name: z.string().optional().describe('name substring, e.g. "Belysning"'),
        kind: z
          .enum(["all", "standard", "advanced"])
          .default("all")
          .describe("which kind of flow to list"),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, offset, name, kind }) => {
      const client = await getClient();
      const rows: Array<{ id: string; name: string; kind: string; enabled: boolean }> = [];
      const collect = (flows: Record<string, HomeyFlow>, flowKind: string) => {
        for (const flow of Object.values(flows)) {
          rows.push({ id: flow.id, name: flow.name, kind: flowKind, enabled: flow.enabled !== false });
        }
      };
      if (kind === "all" || kind === "standard") collect(await client.getFlows(), "standard");
      if (kind === "all" || kind === "advanced") collect(await client.getAdvancedFlows(), "advanced");
      const filtered = name
        ? rows.filter((f) => f.name.toLowerCase().includes(name.toLowerCase()))
        : rows;
      filtered.sort((a, b) => a.name.localeCompare(b.name, "sv"));
      return reply(paged(filtered, limit, offset, { filtered_from: rows.length }));
    }
  );

  server.registerTool(
    "homey_run_flow",
    {
      title: "Run a flow",
      description:
        "Start an automation flow by id. `kind` must match what homey_list_flows reported for " +
        "it — a standard flow and an advanced flow are triggered through different endpoints. A " +
        "flow can do anything the house can do, so confirm with the user first.",
      inputSchema: {
        flowId: z.string().min(1).describe("flow id from homey_list_flows"),
        kind: z.enum(["standard", "advanced"]).describe("the kind homey_list_flows reported"),
      },
      annotations: RUN_FLOW,
    },
    async ({ flowId, kind }) => {
      const client = await getClient();
      if (kind === "advanced") await client.triggerAdvancedFlow(flowId);
      else await client.triggerFlow(flowId);
      return reply({ flow_id: flowId, kind, started: true });
    }
  );

  // -- system ------------------------------------------------------------

  server.registerTool(
    "homey_system_info",
    {
      title: "System info",
      description:
        "What Homey reports about itself: version, uptime, memory and load. Useful to check that " +
        "the session token still works and the Homey is reachable.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const client = await getClient();
      return reply(await client.getSystemInfo());
    }
  );

  return server;
}

/** Every tool name this server exposes, in registration order. */
export const TOOL_NAMES = [
  "homey_list_zones",
  "homey_list_devices",
  "homey_get_device",
  "homey_set_capability",
  "homey_list_flows",
  "homey_run_flow",
  "homey_system_info",
];

export async function main(): Promise<void> {
  const server = createHomeyMcpServer(lazyClient());
  await server.connect(new StdioServerTransport());
}

// Run when started directly (node dist/mcp.js), not when imported by a test.
if (process.argv[1] && /mcp\.(js|ts)$/.test(process.argv[1])) {
  main().catch((error) => {
    // stderr, never stdout: stdout is the protocol
    console.error(`homey MCP server failed to start: ${(error as Error).message}`);
    process.exit(1);
  });
}
