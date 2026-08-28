import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { SshHelperClient } from "./helper/client.js";
import { Repository } from "./repository.js";
import { buildServer } from "./server.js";
import { PollingWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config.databasePath, config.migrationsPath);
  const repository = new Repository(database);
  const helper = new SshHelperClient(config.masterKey);
  const server = await buildServer(config, repository, helper);
  const worker = new PollingWorker(repository, helper);
  if (config.pollingEnabled) worker.start();

  const shutdown = async (): Promise<void> => {
    worker.stop();
    await server.close();
    database.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await server.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  process.stderr.write(`AWG Control failed to start: ${message}\n`);
  process.exitCode = 1;
});

