import type { EndpointTestContext } from "@/types";

export class TypeFetchTestContext implements EndpointTestContext {
  data: Record<string, unknown>;

  constructor(initialData: Record<string, unknown> = {}) {
    this.data = { ...initialData };
  }

  get<T = unknown>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.data[key] = value;
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }
}
