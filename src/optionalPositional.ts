import { type Type } from "cmd-ts";
import {
  type ArgParser,
  type ParseContext,
  type ParsingResult,
} from "cmd-ts/dist/cjs/argparser.js";
import { type OutputOf } from "cmd-ts/dist/cjs/from.js";
import { type Descriptive, type Displayed, type ProvidesHelp } from "cmd-ts/dist/cjs/helpdoc.js";
import { type PositionalArgument } from "cmd-ts/dist/cjs/newparser/parser.js";
import * as Result from "cmd-ts/dist/cjs/Result.js";
import { type HasType } from "cmd-ts/dist/cjs/type.js";

export type OptionalPositionalsConfig<Decoder extends Type<string, any>> = HasType<Decoder> &
  Partial<Displayed & Descriptive> & {
    default: OutputOf<Decoder>;
  };

function optionalPositionalImpl<Decoder extends Type<string, any>>(
  config: OptionalPositionalsConfig<Decoder>,
): ArgParser<OutputOf<Decoder>> & ProvidesHelp {
  return {
    helpTopics() {
      const displayName = config.displayName ?? config.type.displayName ?? "arg";
      return [
        {
          usage: `[${displayName}]`,
          category: "arguments",
          defaults: [],
          description: config.description ?? config.type.description ?? "",
        },
      ];
    },
    register(_opts) {},
    async parse({ nodes, visitedNodes }: ParseContext): Promise<ParsingResult<OutputOf<Decoder>>> {
      const positionals = nodes.filter(
        (node): node is PositionalArgument =>
          node.type === "positionalArgument" && !visitedNodes.has(node),
      );

      if (positionals.length === 0) {
        return Result.ok(config.default);
      }

      visitedNodes.add(positionals[0]);
      const decoded = await Result.safeAsync(config.type.from(positionals[0].raw));
      if (Result.isOk(decoded)) {
        return Result.ok(decoded.value);
      } else {
        return Result.err({
          errors: [
            {
              nodes: [positionals[0]],
              message: decoded.error.message,
            },
          ],
        });
      }
    },
  };
}

type OptionalPositionalsParser<Decoder extends Type<string, any>> = ArgParser<OutputOf<Decoder>> &
  ProvidesHelp;

export function optionalPositional<Decoder extends Type<string, any>>(
  config: OptionalPositionalsConfig<Decoder>,
): OptionalPositionalsParser<Decoder> {
  return optionalPositionalImpl(config);
}
