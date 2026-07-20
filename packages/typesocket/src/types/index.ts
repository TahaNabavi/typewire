import z from "zod";

export type OnEvent<TReq extends z.ZodTypeAny> = {
  response: TReq;
};
export type EmitEvent<
  TRes extends z.ZodTypeAny,
  CBData extends z.ZodTypeAny
> = {
  request: TRes;
  callback: CBData;
};
export type OnEvents = Record<string, OnEvent<z.ZodTypeAny>>;
export type EmitEvents = Record<string, EmitEvent<z.ZodTypeAny, z.ZodTypeAny>>;

export type SocketConfig = {
  url: string;
  autoConnect: boolean;
  reconnection: boolean;
  reconnectionAttempts: number;
  reconnectionDelay: number;
  transports?: string[];
  auth?: Record<string, unknown>;
  query?: Record<string, string>;
  [key: string]: unknown;
};
