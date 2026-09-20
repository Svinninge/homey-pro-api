// File version: v0.01
// Description: Tests for the Homey MCP server — tool contract, annotations, calls against a fake Homey
// Author: Per Norrfors
// Created: 2026-09-20
// Modified: 2026-09-20 - Initial implementation (Claude)

/**
 * The server is driven through a real in-memory MCP client, so the tools are
 * exercised across the protocol: schemas, annotations, results and errors.
 * The Homey behind it is a fake — no tokens, no network, no house that reacts.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { HomeyClient, HomeyDevice, HomeyFlow, HomeyZone } from "./homey-client.js";
import { TOOL_NAMES, createHomeyMcpServer } from "./mcp.js";

const ZONES: Record<string, HomeyZone> = {
  house: { id: "house", name: "Svinninge", parent: null },
  ground: { id: "ground", name: "Bottenvåning", parent: "house" },
  upper: { id: "upper", name: "Övervåning", parent: "house" },
  living: { id: "living", name: "Vardagsrum", parent: "ground" },
  officeUp: { id: "officeUp", name: "Kontor", parent: "upper" },
  outside: { id: "outside", name: "Utomhus", parent: "house" },
};

function makeDevice(
  id: string,
  name: string,
  deviceClass: string,
  zone: string,
  values: Record<string, unknown>,
  available = true
): HomeyDevice {
  return {
    id,
    name,
    class: deviceClass,
    zone,
    available,
    capabilities: Object.keys(values),
    capabilitiesObj: Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, { value: v, lastUpdated: "", type: typeof v, title: k }])
    ),
  };
}

/** A Homey that answers from memory and records what was set. */
class FakeHomey {
  devices: Record<string, HomeyDevice>;
  zones = ZONES;
  standardFlows: Record<string, HomeyFlow> = {
    f1: { id: "f1", name: "Knapp Soffa Kort", enabled: true },
    f2: { id: "f2", name: "Takdimmer GR På", enabled: true },
  };
  advancedFlows: Record<string, HomeyFlow> = {
    a1: { id: "a1", name: "Belysning Ute", enabled: true },
    a2: { id: "a2", name: "Golvvärme", enabled: false },
  };
  written: Array<{ deviceId: string; capability: string; value: unknown }> = [];
  triggered: Array<{ id: string; kind: string }> = [];

  constructor() {
    this.devices = {
      d1: makeDevice("d1", "Takdimmer VR", "light", "living", { onoff: false, dim: 0.19 }),
      d2: makeDevice("d2", "Läsljus Soffhörn", "light", "living", { onoff: false, dim: 0 }),
      d3: makeDevice("d3", "Korglampa", "light", "officeUp", { onoff: true, dim: 0.2 }),
      d4: makeDevice("d4", "Dörrlås Entre", "lock", "outside", { locked: true, measure_battery: 83 }),
      d5: makeDevice("d5", "Golvvärme Hall", "thermostat", "ground", {
        onoff: false,
        target_temperature: 22,
        measure_temperature: 22,
      }),
      d6: makeDevice("d6", "Julgran", "light", "outside", { onoff: true }, false),
    };
  }

  async getDevices() {
    return this.devices;
  }

  async getDevice(id: string) {
    const device = this.devices[id];
    if (!device) throw new Error(`Homey API 404: no device ${id}`);
    return device;
  }

  async getZones() {
    return this.zones;
  }

  async getFlows() {
    return this.standardFlows;
  }

  async getAdvancedFlows() {
    return this.advancedFlows;
  }

  async setCapability(deviceId: string, capability: string, value: unknown) {
    const device = await this.getDevice(deviceId);
    this.written.push({ deviceId, capability, value });
    device.capabilitiesObj[capability] = { value, lastUpdated: "", type: typeof value, title: capability };
  }

  async triggerFlow(id: string) {
    if (!this.standardFlows[id]) throw new Error(`Homey API 404: no flow ${id}`);
    this.triggered.push({ id, kind: "standard" });
  }

  async triggerAdvancedFlow(id: string) {
    if (!this.advancedFlows[id]) throw new Error(`Homey API 404: no advanced flow ${id}`);
    this.triggered.push({ id, kind: "advanced" });
  }

  async getSystemInfo() {
    return { homeyVersion: "12.4.1", uptime: 864_000 };
  }
}

let homey: FakeHomey;
let client: Client;

async function connect(): Promise<Client> {
  homey = new FakeHomey();
  const server = createHomeyMcpServer(async () => homey as unknown as HomeyClient);
  const mcpClient = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

/** The JSON a tool answered with. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  return { isError: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) };
}

beforeEach(async () => {
  client = await connect();
});

describe("the tool contract", () => {
  it("exposes exactly the tools it says it does, each with a service prefix", async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.every((t) => t.name.startsWith("homey_"))).toBe(true);
  });

  it("annotates every tool, and only the two that change the house are destructive", async () => {
    const tools = (await client.listTools()).tools;
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    expect(destructive.sort()).toEqual(["homey_run_flow", "homey_set_capability"]);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
      // the SDK puts `title` on the tool itself; annotations.title is the legacy spelling
      expect(tool.title ?? tool.annotations?.title, tool.name).toBeTruthy();
      expect(tool.annotations?.openWorldHint, tool.name).toBe(true);
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
    }
    // running a flow twice is not the same as running it once
    expect(tools.find((t) => t.name === "homey_run_flow")?.annotations?.idempotentHint).toBe(false);
  });

  it("tells the client how to get started", async () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("homey_list_zones");
    expect(instructions).toMatch(/confirm/i);
  });
});

describe("homey_list_zones", () => {
  it("answers with paths and device counts", async () => {
    const { data } = await call("homey_list_zones");
    const byPath = Object.fromEntries(data.items.map((z: { path: string; devices: number }) => [z.path, z.devices]));
    expect(byPath["Svinninge > Bottenvåning > Vardagsrum"]).toBe(2);
    expect(byPath["Svinninge > Övervåning > Kontor"]).toBe(1);
    expect(data.total).toBe(6);
  });
});

describe("homey_list_devices", () => {
  it("summarises without dumping every value", async () => {
    const { data } = await call("homey_list_devices");
    expect(data.total).toBe(6);
    expect(data.items[0]).not.toHaveProperty("values");
    expect(data.items[0]).toHaveProperty("capabilities");
  });

  it("resolves the zone path for every device", async () => {
    const { data } = await call("homey_list_devices", { name: "Korglampa" });
    expect(data.items[0].zone).toBe("Svinninge > Övervåning > Kontor");
  });

  it("filters by zone, class and capability", async () => {
    expect((await call("homey_list_devices", { zone: "Vardagsrum" })).data.total).toBe(2);
    expect((await call("homey_list_devices", { deviceClass: "lock" })).data.items[0].name).toBe("Dörrlås Entre");
    expect((await call("homey_list_devices", { capability: "target_temperature" })).data.total).toBe(1);
  });

  it("can skip what Homey cannot reach", async () => {
    const all = await call("homey_list_devices");
    const reachable = await call("homey_list_devices", { onlyAvailable: true });
    expect(all.data.total - reachable.data.total).toBe(1);
  });

  it("pages, and says where the next page starts", async () => {
    const page = await call("homey_list_devices", { limit: 2 });
    expect(page.data).toMatchObject({ count: 2, has_more: true, next_offset: 2, filtered_from: 6 });
    const next = await call("homey_list_devices", { limit: 2, offset: 2 });
    expect(next.data.items[0].id).not.toBe(page.data.items[0].id);
  });

  it("refuses a limit outside the schema instead of guessing", async () => {
    const result = await call("homey_list_devices", { limit: 500 });
    expect(result.isError).toBe(true);
  });
});

describe("homey_get_device", () => {
  it("reports the current values", async () => {
    const { data } = await call("homey_get_device", { deviceId: "d5" });
    expect(data.values).toEqual({ onoff: false, target_temperature: 22, measure_temperature: 22 });
    expect(data.zone).toBe("Svinninge > Bottenvåning");
  });

  it("passes Homey's 404 on as a readable error", async () => {
    const result = await call("homey_get_device", { deviceId: "nope" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("no device nope");
  });
});

describe("homey_set_capability", () => {
  it("sets the value and reports what Homey holds afterwards", async () => {
    const { data } = await call("homey_set_capability", { deviceId: "d1", capability: "dim", value: 0.5 });
    expect(homey.written).toEqual([{ deviceId: "d1", capability: "dim", value: 0.5 }]);
    expect(data).toMatchObject({ name: "Takdimmer VR", requested: 0.5, value_now: 0.5 });
  });

  it("reads the strings a model is likely to send", async () => {
    await call("homey_set_capability", { deviceId: "d1", capability: "onoff", value: "true" });
    expect(homey.written[0].value).toBe(true);
  });

  it("refuses a capability the device does not have, and names the ones it does", async () => {
    const result = await call("homey_set_capability", {
      deviceId: "d4",
      capability: "dim",
      value: 0.5,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("locked");
    expect(homey.written).toEqual([]); // nothing was written
  });
});

describe("homey_list_flows", () => {
  it("lists both kinds, because half the house's flows are advanced", async () => {
    const { data } = await call("homey_list_flows");
    const kinds = new Set(data.items.map((f: { kind: string }) => f.kind));
    expect(kinds).toEqual(new Set(["standard", "advanced"]));
    expect(data.total).toBe(4);
  });

  it("can list one kind only, and filter by name", async () => {
    expect((await call("homey_list_flows", { kind: "advanced" })).data.total).toBe(2);
    const { data } = await call("homey_list_flows", { name: "belysning" });
    expect(data.items.map((f: { name: string }) => f.name)).toEqual(["Belysning Ute"]);
  });

  it("reports a disabled flow as disabled", async () => {
    const { data } = await call("homey_list_flows", { name: "Golvvärme" });
    expect(data.items[0].enabled).toBe(false);
  });
});

describe("homey_run_flow", () => {
  it("triggers a standard flow through the standard endpoint", async () => {
    await call("homey_run_flow", { flowId: "f1", kind: "standard" });
    expect(homey.triggered).toEqual([{ id: "f1", kind: "standard" }]);
  });

  it("triggers an advanced flow through the advanced endpoint", async () => {
    await call("homey_run_flow", { flowId: "a1", kind: "advanced" });
    expect(homey.triggered).toEqual([{ id: "a1", kind: "advanced" }]);
  });

  it("does not silently succeed on the wrong kind", async () => {
    const result = await call("homey_run_flow", { flowId: "a1", kind: "standard" });
    expect(result.isError).toBe(true);
    expect(homey.triggered).toEqual([]);
  });
});

describe("homey_system_info", () => {
  it("answers with what Homey says about itself", async () => {
    expect((await call("homey_system_info")).data.homeyVersion).toBe("12.4.1");
  });
});
