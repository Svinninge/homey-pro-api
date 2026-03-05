import type Anthropic from "@anthropic-ai/sdk";
import type { HomeyClient } from "./homey-client.js";

/**
 * Tool definitions for Claude API tool use.
 * These let Claude autonomously interact with Homey Pro.
 */
export const homeyTools: Anthropic.Tool[] = [
  {
    name: "list_devices",
    description:
      "List all devices connected to Homey Pro. Returns device names, classes, zones, and capabilities.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_device",
    description: "Get detailed info about a specific Homey device by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "The device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "control_device",
    description:
      "Set a capability value on a Homey device (e.g., turn on/off, set brightness, temperature).",
    input_schema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "The device ID",
        },
        capability: {
          type: "string",
          description:
            'The capability to set (e.g., "onoff", "dim", "target_temperature")',
        },
        value: {
          description:
            "The value to set (boolean for onoff, number for dim/temperature, string for others)",
        },
      },
      required: ["device_id", "capability", "value"],
    },
  },
  {
    name: "list_zones",
    description: "List all zones (rooms) in Homey.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_flows",
    description: "List all automation flows in Homey.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "trigger_flow",
    description: "Trigger (run) a Homey flow by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        flow_id: {
          type: "string",
          description: "The flow ID to trigger",
        },
      },
      required: ["flow_id"],
    },
  },
];

/**
 * Execute a tool call from Claude against the Homey client.
 */
export async function executeHomeyTool(
  client: HomeyClient,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "list_devices": {
      const devices = await client.getDevices();
      const summary = Object.values(devices).map((d) => ({
        id: d.id,
        name: d.name,
        class: d.class,
        zone: d.zone,
        available: d.available,
        capabilities: d.capabilities,
      }));
      return JSON.stringify(summary, null, 2);
    }

    case "get_device": {
      const device = await client.getDevice(toolInput.device_id as string);
      return JSON.stringify(device, null, 2);
    }

    case "control_device": {
      await client.setCapability(
        toolInput.device_id as string,
        toolInput.capability as string,
        toolInput.value
      );
      return `Set ${toolInput.capability} = ${toolInput.value} on device ${toolInput.device_id}`;
    }

    case "list_zones": {
      const zones = await client.getZones();
      return JSON.stringify(Object.values(zones), null, 2);
    }

    case "list_flows": {
      const flows = await client.getFlows();
      const summary = Object.values(flows).map((f) => ({
        id: f.id,
        name: f.name,
        enabled: f.enabled,
      }));
      return JSON.stringify(summary, null, 2);
    }

    case "trigger_flow": {
      await client.triggerFlow(toolInput.flow_id as string);
      return `Flow ${toolInput.flow_id} triggered successfully.`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
