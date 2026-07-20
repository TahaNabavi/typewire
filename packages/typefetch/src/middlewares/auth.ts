import { Middleware } from "@/types";
import z from "zod";

/**
 * TokenManagementOptions
 * ======================
 * Configuration structure for supplying credentials to the authentication layer.
 *
 * @property refreshToken A required asynchronous function responsible for
 *                        obtaining a current, valid access token string. This allows
 *                        for token fetching from storage or re-issuance upon expiry.
 */
export type AuthOptions = {
  refreshToken?: () => Promise<string>;
};

/**
 * AuthenticationInjectorMiddleware
 * ==================================
 * This middleware operates early in the request pipeline to ensure every
 * outgoing request is properly authorized by prepending an Authorization header.
 *
 * Core Logic:
 * -----------
 * 1. It checks if an explicit `refreshToken` supplier was configured in its options.
 * 2. If present, it synchronously calls this supplier to obtain the latest token.
 * 3. The resulting token is formatted as a standard 'Bearer' token and merged
 *    into the request's `init.headers`.
 * 4. The request context (`ctx`) is then passed downstream.
 *
 * Note on Error Handling:
 * -----------------------
 * Any failure during the token retrieval process (e.g., if `refreshToken` throws)
 * results in the error being caught, and the request proceeds **without** an
 * Authorization header. This design defers failure response handling to
 * subsequent middleware or the final network fetcher.
 *
 * @param ctx The current request context object, including mutable `init` properties.
 * @param next The function to execute the rest of the middleware chain.
 * @param options The specific configuration passed to this middleware instance.
 *
 * @returns The final `Response` object after the network call completes.
 *
 * @example
 * // Assuming token retrieval logic is defined elsewhere
 * const tokenSupplier = () => fetchTokenFromSecureStorage();
 *
 * client.addInterceptor(
 *   authMiddleware({ refreshToken: tokenSupplier })
 * );
 */
export const authMiddleware: Middleware<
  z.ZodTypeAny,
  z.ZodTypeAny,
  AuthOptions
> = async (ctx, next, options) => {
  // Step 1 & 2: Check for and execute the token provider
  if (options?.refreshToken) {
    try {
      const newToken = await options.refreshToken();

      // Step 3: Mutate the context's request initialization object
      ctx.init.headers = {
        ...ctx.init.headers, // Preserve any headers set by prior middleware
        Authorization: `Bearer ${newToken}`,
      };
    } catch (error) {
      // Step 4: Fail silently for header injection purposes
      // The request will proceed unauthenticated if the token failed to load
      console.warn(
        "Authentication token refresh failed, proceeding without authorization header.",
        error,
      );
    }
  }

  // Step 5: Pass control to the next step in the request pipeline
  return next();
};
