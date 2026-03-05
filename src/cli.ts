import { loadConfig } from "./config.js";
import { HomeyClient } from "./homey-client.js";
import { HomeyAgent } from "./agent.js";
import { authorize, getValidSession } from "./auth.js";

/**
 * Simple CLI to test the Homey Pro connection and optionally
 * run the Claude agent in interactive mode.
 */
async function main() {
  const command = process.argv[2];

  if (!command || command === "help" || command === "--help") {
    console.log(`Usage: npm start -- <command>

Commands:
  auth      Authorize with Homey Pro (OAuth2 — run this first!)
  ping      Check connection to Homey Pro
  devices   List all devices
  zones     List all zones
  flows     List all flows
  ask <q>   Ask Claude to control Homey (requires ANTHROPIC_API_KEY)

Setup:
  1. Copy .env.example to .env.local and fill in your credentials
  2. Add http://localhost:3456/callback to your Homey Web API Client callback URLs
  3. Run: npm start -- auth`);
    return;
  }

  const config = loadConfig();

  // Auth command doesn't need a session
  if (command === "auth") {
    await authorize(config.oauth2, config.homeyAddress);
    console.log("🎉 Authorization complete! You can now use other commands.");
    return;
  }

  // All other commands need a valid session
  const tokenFn = () => getValidSession(config.oauth2, config.homeyAddress);
  const client = new HomeyClient(config.homeyAddress, tokenFn);

  switch (command) {
    case "ping": {
      const ok = await client.ping();
      console.log(ok ? "✅ Homey Pro is reachable!" : "❌ Cannot reach Homey Pro.");
      break;
    }

    case "devices": {
      const devices = await client.getDevices();
      for (const device of Object.values(devices)) {
        console.log(`  ${device.name} (${device.class}) - ${device.id}`);
      }
      console.log(`\n  Total: ${Object.keys(devices).length} devices`);
      break;
    }

    case "zones": {
      const zones = await client.getZones();
      for (const zone of Object.values(zones)) {
        console.log(`  ${zone.name} - ${zone.id}`);
      }
      break;
    }

    case "flows": {
      const flows = await client.getFlows();
      for (const flow of Object.values(flows)) {
        const status = flow.enabled ? "✅" : "⛔";
        console.log(`  ${status} ${flow.name} - ${flow.id}`);
      }
      console.log(`\n  Total: ${Object.keys(flows).length} flows`);
      break;
    }

    case "ask": {
      const question = process.argv.slice(3).join(" ");
      if (!question) {
        console.error("Usage: npm start -- ask <your question>");
        process.exit(1);
      }
      if (!config.anthropicApiKey) {
        console.error("ANTHROPIC_API_KEY is required in .env.local for agent mode.");
        process.exit(1);
      }
      const agent = new HomeyAgent(client, config.anthropicApiKey);
      const answer = await agent.run(question);
      console.log(answer);
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run without arguments for help.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
