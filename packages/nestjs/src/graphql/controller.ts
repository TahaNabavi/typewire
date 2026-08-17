import {
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  type Type,
} from "@nestjs/common";
import { SkipEnvelope } from "../envelope/skip-envelope.decorator";
import { ContractGraphQLDispatcher } from "./dispatcher";

/**
 * The one route every operation arrives at.
 *
 * Built by a factory rather than declared, because the path is configuration —
 * and a decorator evaluates when its class does, so the class has to be created
 * after the option is known.
 *
 * `passthrough: true` keeps the response inside NestJS's pipeline (so the app's
 * own interceptors still see it) while letting the dispatcher set the status
 * and the media type, both of which the GraphQL-over-HTTP spec makes part of
 * the answer rather than decoration around it.
 */
export function createGraphQLController(
  path: string,
  allowGet: boolean,
): Type<unknown> {
  @Controller()
  @SkipEnvelope()
  class ContractGraphQLController {
    constructor(
      @Inject(ContractGraphQLDispatcher)
      private readonly dispatcher: ContractGraphQLDispatcher,
    ) {}

    @Post(path)
    post(@Req() request: unknown, @Res({ passthrough: true }) response: any) {
      return this.dispatch(request, response, "POST");
    }

    @Get(path)
    get(@Req() request: unknown, @Res({ passthrough: true }) response: any) {
      if (!allowGet) {
        response.status(405);
        return {
          errors: [
            {
              message: "GraphQL over GET is disabled on this server",
              extensions: { code: "BAD_REQUEST", http: { status: 405 } },
            },
          ],
        };
      }
      return this.dispatch(request, response, "GET");
    }

    private async dispatch(
      request: unknown,
      response: any,
      method: "POST" | "GET",
    ) {
      const result = await this.dispatcher.execute(request, response, method);
      response.status(result.status);
      response.setHeader?.("Content-Type", `${result.contentType}; charset=utf-8`);
      return result.body;
    }
  }

  return ContractGraphQLController;
}
