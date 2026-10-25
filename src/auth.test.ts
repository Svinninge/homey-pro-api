// File version: v0.01
// Description: Tests for binding the delegation token to one Homey (homeyId)
// Author: Per Norrfors
// Created: 2026-10-25
// Modified: 2026-10-25 - Initial implementation (Claude)

/**
 * fetch is stubbed, so these run without a Homey, a cloud account or tokens.
 * They check where the homeyId comes from and that it reaches /delegation/token.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDelegationToken, getHomeyId } from "./auth.js";

const HOMEY = "http://192.168.1.66/";
const ID = "66f15a671f2c243410e7344d";

type Route = (url: URL) => Response;

function stubFetch(route: Route): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(input.toString());
    calls.push(url.toString());
    return route(url);
  });
  return calls;
}

function ping(id?: string): Response {
  return new Response("true", { headers: id ? { "X-Homey-ID": id } : {} });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHomeyId", () => {
  it("takes the id from the local ping without asking the cloud", async () => {
    const calls = stubFetch(() => ping(ID));

    await expect(getHomeyId(HOMEY, "cloud-token")).resolves.toBe(ID);
    expect(calls).toEqual(["http://192.168.1.66/api/manager/system/ping"]);
  });

  it("falls back to /user/me when the account has one Homey", async () => {
    stubFetch((url) =>
      url.pathname === "/user/me"
        ? Response.json({ homeys: [{ _id: ID, name: "Svinninge" }] })
        : ping()
    );

    await expect(getHomeyId(HOMEY, "cloud-token")).resolves.toBe(ID);
  });

  it("refuses to guess between several Homeys", async () => {
    stubFetch((url) =>
      url.pathname === "/user/me"
        ? Response.json({ homeys: [{ _id: "a", name: "Hemma" }, { _id: "b", name: "Stugan" }] })
        : ping()
    );

    await expect(getHomeyId(HOMEY, "cloud-token")).rejects.toThrow(/2 Homeys: Hemma \(a\), Stugan \(b\)/);
  });
});

describe("getDelegationToken", () => {
  it("asks for a token bound to the Homey", async () => {
    const calls = stubFetch((url) =>
      url.pathname === "/delegation/token" ? Response.json("eyJ.jwt") : ping(ID)
    );

    await expect(getDelegationToken("cloud-token", HOMEY)).resolves.toBe("eyJ.jwt");
    expect(calls).toContain(`https://api.athom.com/delegation/token?audience=homey&homeyId=${ID}`);
  });
});
