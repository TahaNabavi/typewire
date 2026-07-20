import { Middleware } from "@/types";


export type RetryOptions = {
  maxRetries?: number;
  delay?: number; // ms
};

export const retryMiddleware = (options?: RetryOptions): Middleware => {
  const { maxRetries = 3, delay = 500 } = options || {};

  const middleware: Middleware = async (ctx, next) => {
    let attempt = 0;
    while (true) {
      try {
        return await next();
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        attempt++;
        await new Promise((r) => setTimeout(r, delay * 2 ** attempt));
      }
    }
  };

  return middleware;
};
