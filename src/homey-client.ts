// File version: v0.02
// Description: Lightweight REST client for the Homey Pro local API
// Author: Per Norrfors
// Created: 2026-03-14
// Modified: 2026-09-20 - Zone parents, advanced flows and a flow kind, for the MCP surface (Claude)

/** Generic Homey API response wrapper */
export interface HomeyDevice {
  id: string;
  name: string;
  class: string;
  zone: string;
  available: boolean;
  capabilities: string[];
  capabilitiesObj: Record<string, CapabilityValue>;
}

/** A zone (room), as the local API reports it: `parent` is null for the root zone. */
export interface HomeyZone {
  id: string;
  name: string;
  parent?: string | null;
}

/** A flow, standard or advanced. `kind` is ours — the API answers per endpoint. */
export interface HomeyFlow {
  id: string;
  name: string;
  enabled?: boolean;
  broken?: boolean;
}

export interface CapabilityValue {
  value: unknown;
  lastUpdated: string;
  type: string;
  title: string;
}

/**
 * Lightweight Homey Pro REST API client.
 *
 * Uses the local HTTP API with a session token from the OAuth2 flow.
 * Docs: https://api.developer.homey.app
 */
export class HomeyClient {
  private baseUrl: string;
  private getToken: () => Promise<string>;

  /**
   * @param address  Homey local URL (e.g. http://192.168.1.66)
   * @param tokenFn  Function that returns a valid session token (handles refresh)
   */
  constructor(address: string, tokenFn: () => Promise<string>) {
    this.baseUrl = address.replace(/\/+$/, "");
    this.getToken = tokenFn;
  }

  // ── HTTP helpers ──────────────────────────────────────────────

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getToken();
    const url = `${this.baseUrl}/api/${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Homey API ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  private get<T>(path: string) {
    return this.request<T>(path);
  }

  private post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private put<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  // ── Devices ───────────────────────────────────────────────────

  /** Get all devices */
  async getDevices(): Promise<Record<string, HomeyDevice>> {
    return this.get("manager/devices/device/");
  }

  /** Get a single device by ID */
  async getDevice(id: string): Promise<HomeyDevice> {
    return this.get(`manager/devices/device/${id}`);
  }

  /** Set a capability value on a device */
  async setCapability(
    deviceId: string,
    capabilityId: string,
    value: unknown
  ): Promise<void> {
    await this.put(
      `manager/devices/device/${deviceId}/capability/${capabilityId}`,
      { value }
    );
  }

  // ── Zones ─────────────────────────────────────────────────────

  /** Get all zones. `parent` is what makes a zone path ("Svinninge > Övervåning > Kontor"). */
  async getZones(): Promise<Record<string, HomeyZone>> {
    return this.get("manager/zones/zone/");
  }

  // ── Flows ─────────────────────────────────────────────────────

  /** Get all standard flows. Advanced flows live behind their own endpoint. */
  async getFlows(): Promise<Record<string, HomeyFlow>> {
    return this.get("manager/flow/flow/");
  }

  /**
   * Get all advanced flows (the canvas ones).
   *
   * Half of this house's flows are advanced, and `manager/flow/flow/` does not
   * list a single one of them — asking only that endpoint makes "Belysning Ute"
   * look like it does not exist.
   */
  async getAdvancedFlows(): Promise<Record<string, HomeyFlow>> {
    return this.get("manager/flow/advancedflow/");
  }

  /** Trigger a standard flow by ID */
  async triggerFlow(id: string): Promise<void> {
    await this.post(`manager/flow/flow/${id}/trigger`);
  }

  /** Trigger an advanced flow by ID */
  async triggerAdvancedFlow(id: string): Promise<void> {
    await this.post(`manager/flow/advancedflow/${id}/trigger`);
  }

  // ── System ────────────────────────────────────────────────────

  /** Get system info */
  async getSystemInfo(): Promise<Record<string, unknown>> {
    return this.get("manager/system/");
  }

  /** Ping the Homey to check connectivity (uses zones — requires zone.readonly scope) */
  async ping(): Promise<boolean> {
    try {
      await this.getZones();
      return true;
    } catch {
      return false;
    }
  }
}
