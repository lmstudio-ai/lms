import { Command } from "@commander-js/extra-typings";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";

export const ls = addCreateClientOptions(
  addLogLevelOptions(new Command().name("ls").description("List runtime engines")),
).action(async options => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);

  logger.info("LS WAS CALLED");
  const result = await client.runtime.engine.list();
  logger.info("Found " + result.length + " runtime engines.");
});
