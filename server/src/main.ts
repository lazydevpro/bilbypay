/**
 * BilbyPay API server.  pnpm --filter @bilbypay/server dev   (reads server/.env)
 */
import { serve } from "@hono/node-server";
import { formatEther } from "viem";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createServices } from "./services";

const config = loadConfig();
const services = createServices(config);
await services.chain.verifyDomains();

const relayerMon = await services.chain.client.getBalance({ address: services.relayer.address });
console.log(`chain ${config.chainId} via ${config.rpcUrl}`);
console.log(`relayer ${services.relayer.address} (${formatEther(relayerMon)} MON), verifier ${services.verifier.address}`);
console.log(`treasury ${services.treasury.address}, keeper ${services.keeperSender.address}, gifts: ${services.gifts.provider.name}, otp: ${services.otp.name}`);
if (config.chainId === 143 && relayerMon < 10n * 10n ** 18n) console.warn("! relayer holds < 10 MON: Monad caps in-flight gas at the balance");

if (config.keeper.enabled) services.keeper.start();
let stopping = false;
let directoryTimer: ReturnType<typeof setTimeout> | undefined;
const reconcileDirectory = async () => {
  try { await services.directoryCache.runOnce(); }
  catch (e) { console.error("directory reconciliation failed", e instanceof Error ? e.message : e); }
  if (!stopping) directoryTimer = setTimeout(reconcileDirectory, 5_000);
};
void reconcileDirectory();
const server = serve({ fetch: createApp(services).fetch, port: config.port }, (info) => console.log(`listening on :${info.port}`));

const shutdown = () => {
  stopping = true;
  if (directoryTimer) clearTimeout(directoryTimer);
  services.keeper.stop();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
