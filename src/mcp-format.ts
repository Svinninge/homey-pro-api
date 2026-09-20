// File version: v0.01
// Description: Pure shaping helpers for the MCP surface — pagination, zone paths, device summaries
// Author: Per Norrfors
// Created: 2026-09-20
// Modified: 2026-09-20 - Initial implementation (Claude)

/**
 * Everything the MCP tools do to Homey's answers before handing them on.
 *
 * Kept free of I/O on purpose: a Homey with 84 devices answers `getDevices()`
 * with every capability value of every device, which is far more than a tool
 * call should put in a caller's context window. The shaping is where that gets
 * decided, so it is also where it gets tested.
 */

import type { CapabilityValue, HomeyDevice, HomeyZone } from "./homey-client.js";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** One page of rows, plus what a caller needs to ask for the next one. */
export interface Page<T> {
  total: number | null;
  count: number;
  offset: number;
  limit: number;
  has_more: boolean;
  next_offset: number | null;
  items: T[];
  [extra: string]: unknown;
}

/**
 * One page of `rows`.
 *
 * `complete: false` means the rows were cut short before everything was read,
 * so the total is unknown — reporting what we happened to fetch as the total
 * would be worse than saying nothing.
 */
export function paged<T>(
  rows: T[],
  limit: number = DEFAULT_LIMIT,
  offset = 0,
  extra: Record<string, unknown> = {},
  complete = true
): Page<T> {
  const size = Math.max(1, Math.min(Math.trunc(limit) || DEFAULT_LIMIT, MAX_LIMIT));
  const from = Math.max(0, Math.trunc(offset) || 0);
  const items = rows.slice(from, from + size);
  const more = from + items.length < rows.length || !complete;
  return {
    total: complete ? rows.length : null,
    count: items.length,
    offset: from,
    limit: size,
    has_more: more,
    next_offset: more ? from + items.length : null,
    items,
    ...extra,
  };
}

/**
 * Full path per zone id, e.g. "Svinninge > Övervåning > Kontor".
 *
 * Two zones can share a name — this house has a "Kontor" on each floor — so a
 * bare name is not enough to tell a caller (or the user) which room is meant.
 * A cycle in the parent chain is survived rather than hung on.
 */
export function zonePaths(zones: Record<string, HomeyZone>): Map<string, string> {
  const paths = new Map<string, string>();
  for (const zone of Object.values(zones)) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: HomeyZone | undefined = zone;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parent ? zones[current.parent] : undefined;
    }
    paths.set(zone.id, parts.join(" > "));
  }
  return paths;
}

/** A zone as a tool reports it. */
export interface ZoneSummary {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  devices: number;
}

export function zoneSummaries(
  zones: Record<string, HomeyZone>,
  devices: Record<string, HomeyDevice> = {}
): ZoneSummary[] {
  const paths = zonePaths(zones);
  const counts = new Map<string, number>();
  for (const device of Object.values(devices)) {
    counts.set(device.zone, (counts.get(device.zone) ?? 0) + 1);
  }
  return Object.values(zones)
    .map((zone) => ({
      id: zone.id,
      name: zone.name,
      path: paths.get(zone.id) ?? zone.name,
      parent: zone.parent ?? null,
      devices: counts.get(zone.id) ?? 0,
    }))
    .sort((a, b) => a.path.localeCompare(b.path, "sv"));
}

/** A device as the list tool reports it: what it is and where, not every value it holds. */
export interface DeviceSummary {
  id: string;
  name: string;
  class: string;
  zone: string;
  available: boolean;
  capabilities: string[];
}

export function deviceSummary(device: HomeyDevice, zonePath = ""): DeviceSummary {
  return {
    id: device.id,
    name: device.name,
    class: device.class,
    zone: zonePath || device.zone,
    available: device.available !== false,
    capabilities: device.capabilities ?? [],
  };
}

/** The capability values of one device, flattened to `{ onoff: false, dim: 0.2 }`. */
export function capabilityValues(device: HomeyDevice): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, capability] of Object.entries(device.capabilitiesObj ?? {})) {
    out[id] = (capability as CapabilityValue)?.value;
  }
  return out;
}

export interface DeviceFilter {
  zone?: string;
  deviceClass?: string;
  name?: string;
  capability?: string;
  onlyAvailable?: boolean;
}

/** Substring match on zone path, class, name and capability — all case-insensitive. */
export function matchesFilter(summary: DeviceSummary, filter: DeviceFilter): boolean {
  const has = (haystack: string, needle?: string) =>
    !needle || haystack.toLowerCase().includes(needle.toLowerCase());
  if (!has(summary.zone, filter.zone)) return false;
  if (!has(summary.class, filter.deviceClass)) return false;
  if (!has(summary.name, filter.name)) return false;
  if (filter.capability) {
    const wanted = filter.capability.toLowerCase();
    if (!summary.capabilities.some((c) => c.toLowerCase().includes(wanted))) return false;
  }
  if (filter.onlyAvailable && !summary.available) return false;
  return true;
}

/**
 * The value a capability should be set to, parsed from what the caller sent.
 *
 * MCP arguments arrive as JSON, and a model that writes `"true"` or `"0.2"`
 * means the boolean and the number. Homey rejects the strings, and the error it
 * gives back says nothing useful, so the conversion happens here.
 */
export function parseCapabilityValue(raw: unknown): boolean | number | string {
  if (typeof raw === "boolean" || typeof raw === "number") return raw;
  const text = String(raw).trim();
  if (/^(true|on|yes)$/i.test(text)) return true;
  if (/^(false|off|no)$/i.test(text)) return false;
  if (text !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}
