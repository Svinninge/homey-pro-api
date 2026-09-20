// File version: v0.01
// Description: Tests for the MCP shaping helpers — pagination, zone paths, filters, value parsing
// Author: Per Norrfors
// Created: 2026-09-20
// Modified: 2026-09-20 - Initial implementation (Claude)

import { describe, expect, it } from "vitest";

import type { HomeyDevice, HomeyZone } from "./homey-client.js";
import {
  MAX_LIMIT,
  capabilityValues,
  deviceSummary,
  matchesFilter,
  paged,
  parseCapabilityValue,
  zonePaths,
  zoneSummaries,
} from "./mcp-format.js";

const ZONES: Record<string, HomeyZone> = {
  house: { id: "house", name: "Svinninge", parent: null },
  ground: { id: "ground", name: "Bottenvåning", parent: "house" },
  upper: { id: "upper", name: "Övervåning", parent: "house" },
  officeDown: { id: "officeDown", name: "Kontor", parent: "ground" },
  officeUp: { id: "officeUp", name: "Kontor", parent: "upper" },
};

function device(overrides: Partial<HomeyDevice> = {}): HomeyDevice {
  return {
    id: "d1",
    name: "Takdimmer Kontor",
    class: "light",
    zone: "officeDown",
    available: true,
    capabilities: ["onoff", "dim"],
    capabilitiesObj: {
      onoff: { value: true, lastUpdated: "", type: "boolean", title: "Turned on" },
      dim: { value: 0.2, lastUpdated: "", type: "number", title: "Dim level" },
    },
    ...overrides,
  };
}

describe("paged", () => {
  it("reports the total and where the next page starts", () => {
    const page = paged([1, 2, 3, 4, 5], 2, 0);
    expect(page).toMatchObject({ total: 5, count: 2, has_more: true, next_offset: 2 });
    expect(page.items).toEqual([1, 2]);
  });

  it("ends the walk on the last page", () => {
    expect(paged([1, 2, 3], 2, 2)).toMatchObject({ count: 1, has_more: false, next_offset: null });
  });

  it("hides the total when the rows were cut short", () => {
    // 12 is what we happened to fetch, not what exists
    expect(paged([...Array(12).keys()], 5, 0, {}, false)).toMatchObject({
      total: null,
      has_more: true,
    });
  });

  it("clamps an absurd limit and a negative offset", () => {
    expect(paged([...Array(500).keys()], 10_000, -5).limit).toBe(MAX_LIMIT);
    expect(paged([1, 2, 3], 2, -1).offset).toBe(0);
  });
});

describe("zonePaths", () => {
  it("builds the full path down from the root zone", () => {
    const paths = zonePaths(ZONES);
    expect(paths.get("officeUp")).toBe("Svinninge > Övervåning > Kontor");
    expect(paths.get("house")).toBe("Svinninge");
  });

  it("keeps two rooms with the same name apart", () => {
    const paths = zonePaths(ZONES);
    expect(paths.get("officeDown")).not.toBe(paths.get("officeUp"));
  });

  it("survives a parent chain that loops", () => {
    const looped: Record<string, HomeyZone> = {
      a: { id: "a", name: "A", parent: "b" },
      b: { id: "b", name: "B", parent: "a" },
    };
    expect(zonePaths(looped).get("a")).toBe("B > A");
  });
});

describe("zoneSummaries", () => {
  it("counts the devices in each zone and sorts by path", () => {
    const rows = zoneSummaries(ZONES, {
      d1: device(),
      d2: device({ id: "d2", zone: "officeUp" }),
      d3: device({ id: "d3", zone: "officeUp" }),
    });
    const byPath = Object.fromEntries(rows.map((z) => [z.path, z.devices]));
    expect(byPath["Svinninge > Bottenvåning > Kontor"]).toBe(1);
    expect(byPath["Svinninge > Övervåning > Kontor"]).toBe(2);
    expect(byPath["Svinninge"]).toBe(0);
    expect(rows.map((z) => z.path)).toEqual([...rows.map((z) => z.path)].sort((a, b) => a.localeCompare(b, "sv")));
  });
});

describe("deviceSummary", () => {
  it("reports what a device is, not every value it holds", () => {
    const summary = deviceSummary(device(), "Svinninge > Bottenvåning > Kontor");
    expect(summary).toEqual({
      id: "d1",
      name: "Takdimmer Kontor",
      class: "light",
      zone: "Svinninge > Bottenvåning > Kontor",
      available: true,
      capabilities: ["onoff", "dim"],
    });
    expect(summary).not.toHaveProperty("values");
  });

  it("falls back to the zone id when the path is unknown", () => {
    expect(deviceSummary(device()).zone).toBe("officeDown");
  });
});

describe("capabilityValues", () => {
  it("flattens Homey's capability objects to plain values", () => {
    expect(capabilityValues(device())).toEqual({ onoff: true, dim: 0.2 });
  });

  it("copes with a device that has none", () => {
    expect(capabilityValues(device({ capabilitiesObj: {} }))).toEqual({});
  });
});

describe("matchesFilter", () => {
  const summary = deviceSummary(device(), "Svinninge > Bottenvåning > Kontor");

  it("matches on a zone path substring, case-insensitively", () => {
    expect(matchesFilter(summary, { zone: "bottenvåning" })).toBe(true);
    expect(matchesFilter(summary, { zone: "Övervåning" })).toBe(false);
  });

  it("matches on class, name and capability", () => {
    expect(matchesFilter(summary, { deviceClass: "light", name: "takdimmer" })).toBe(true);
    expect(matchesFilter(summary, { capability: "dim" })).toBe(true);
    expect(matchesFilter(summary, { capability: "target_temperature" })).toBe(false);
  });

  it("can skip devices Homey cannot reach", () => {
    const gone = deviceSummary(device({ available: false }));
    expect(matchesFilter(gone, { onlyAvailable: true })).toBe(false);
    expect(matchesFilter(gone, {})).toBe(true);
  });
});

describe("parseCapabilityValue", () => {
  it("passes booleans and numbers through", () => {
    expect(parseCapabilityValue(true)).toBe(true);
    expect(parseCapabilityValue(0.2)).toBe(0.2);
  });

  it("reads the strings a model is likely to send", () => {
    expect(parseCapabilityValue("true")).toBe(true);
    expect(parseCapabilityValue("off")).toBe(false);
    expect(parseCapabilityValue("0.2")).toBe(0.2);
    expect(parseCapabilityValue("21.5")).toBe(21.5);
  });

  it("leaves a real string alone", () => {
    expect(parseCapabilityValue("heating")).toBe("heating");
  });
});
