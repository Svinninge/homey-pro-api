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

  /** Get all zones */
  async getZones(): Promise<Record<string, { id: string; name: string }>> {
    return this.get("manager/zones/zone/");
  }

  // ── Flows ─────────────────────────────────────────────────────

  /** Get all flows */
  async getFlows(): Promise<Record<string, { id: string; name: string; enabled: boolean }>> {
    return this.get("manager/flow/flow/");
  }

  /** Trigger a flow by ID */
  async triggerFlow(id: string): Promise<void> {
    await this.post(`manager/flow/flow/${id}/trigger`);
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
