import { io, Socket } from "socket.io-client";
import { EmitEvents, OnEvents, SocketConfig } from "./types";
import z from "zod";
import { getSocketConfig } from "./utils";

export class SocketService<OE extends OnEvents, EE extends EmitEvents> {
  private socket: Socket | null = null;
  private _config!: SocketConfig;
  private retryCount = 0;
  private debug = false;

  private queue: { event: string; data: unknown[] }[] = [];
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private middlewares: Array<(event: string, data: unknown) => void> = [];

  constructor(
    private config: Partial<SocketConfig>,
    private onEvents: OE,
    private emitEvents: EE,
    private opt: {
      onConnect: () => void;
      onDisconnect: (reason: unknown) => void;
      onConnectError: (error: { message: string }) => void;
    }
  ) {}

  public init() {
    if (!this._config) {
      const defaultConfig = getSocketConfig();
      this._config = { ...defaultConfig, ...this.config };
    }

    this.socket = io(this._config.url, this._config);

    // Default lifecycle listeners
    this.socket.on("connect", () => {
      this.flushQueue();
      this.rebindListeners();
      this.opt.onConnect();
    });
    this.socket.on("disconnect", this.opt.onDisconnect);
    this.socket.on("connect_error", this.opt.onConnectError);

    return this;
  }

  /** =========================
   * EMIT METHODS
   * ========================= */

  public emit<Ev extends keyof EE>(
    event: Ev,
    data: z.infer<EE[Ev]["request"]>,
    callback?: (cbData: z.infer<EE[Ev]["callback"]>) => void
  ) {
    const schema = this.emitEvents[event].request;
    const parsed = schema.safeParse(data);

    if (!parsed.success) {
      console.error(
        `[socket:emit] Validation failed for ${String(event)}`,
        parsed.error
      );
      return;
    }

    if (this.debug) console.log("🔵 emit:", event, parsed.data);

    if (callback) {
      this.socket?.emit(event as string, parsed.data, callback);
    } else {
      this.socket?.emit(event as string, parsed.data);
    }
  }

  public emitAsync<Ev extends keyof EE>(
    event: Ev,
    data: z.infer<EE[Ev]["request"]>
  ): Promise<z.infer<EE[Ev]["callback"]>> {
    const schema = this.emitEvents[event].request;
    const parsed = schema.safeParse(data);

    return new Promise((resolve, reject) => {
      if (!parsed.success) {
        return reject(
          new Error(`[socket:emitAsync] Validation failed for ${String(event)}`)
        );
      }

      if (!this.socket?.connected) {
        return reject(
          new Error(`Socket not connected, cannot emit event: ${String(event)}`)
        );
      }

      if (this.debug) console.log("🔵 emitAsync:", event, parsed.data);

      this.socket.emit(
        event as string,
        parsed.data,
        (response: z.infer<EE[Ev]["callback"]>) => resolve(response)
      );
    });
  }

  /** Queue emit if socket not connected */
  public emitQueued<Ev extends keyof EE>(
    event: Ev,
    data: z.infer<EE[Ev]["request"]>
  ) {
    if (this.socket?.connected) {
      this.emit(event, data);
    } else {
      if (this.debug) console.log("🟡 queued emit:", event, data);
      this.queue.push({ event: event as string, data: [data] });
    }
  }

  private flushQueue() {
    while (this.queue.length > 0) {
      const { event, data } = this.queue.shift()!;
      if (this.debug) console.log("🟢 flushing queued emit:", event, data);
      this.socket?.emit(event, ...data);
    }
  }

  /** =========================
   * LISTENERS
   * ========================= */

  public on<Ev extends keyof OE>(
    event: Ev,
    handler: (data: z.infer<OE[Ev]["response"]>) => void
  ) {
    const schema = this.onEvents[event].response;

    const wrapped = (raw: unknown) => {
      this.runMiddlewares(event as string, raw);
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        if (this.debug) console.log("🟣 on:", event, parsed.data);
        handler(parsed.data as z.infer<OE[Ev]["response"]>);
      } else {
        console.error(
          `[socket:on] Validation failed for ${String(event)}`,
          parsed.error
        );
      }
    };

    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }

    this.listeners.get(event as string)!.add(wrapped);

    this.socket?.on(event as string, wrapped);
  }

  public once<Ev extends keyof OE>(
    event: Ev,
    handler: (data: z.infer<OE[Ev]["response"]>) => void
  ) {
    const schema = this.onEvents[event].response;
    this.socket?.once(event as string, (raw: unknown) => {
      this.runMiddlewares(event as string, raw);
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        if (this.debug) console.log("🟣 once:", event, parsed.data);
        handler(parsed.data as z.infer<OE[Ev]["response"]>);
      } else {
        console.error(
          `[socket:once] Validation failed for ${String(event)}`,
          parsed.error
        );
      }
    });
  }

  public off<Ev extends keyof OE>(
    event: Ev,
    callback: (data: z.infer<OE[Ev]["response"]>) => void
  ) {
    this.socket?.off(event as string, callback);
  }

  public waitFor<Ev extends keyof OE>(
    event: Ev,
    timeoutMs = 5000
  ): Promise<z.infer<OE[Ev]["response"]>> {
    return new Promise((resolve, reject) => {
      const schema = this.onEvents[event].response;

      const timer = setTimeout(() => {
        this.off(event, handler as any);
        reject(new Error(`Timeout waiting for event: ${String(event)}`));
      }, timeoutMs);

      const handler = (raw: unknown) => {
        this.runMiddlewares(event as string, raw);
        const parsed = schema.safeParse(raw);
        if (parsed.success) {
          clearTimeout(timer);
          this.off(event, handler as any);
          resolve(parsed.data as z.infer<OE[Ev]["response"]>);
        } else {
          reject(parsed.error);
        }
      };

      this.on(event, handler as any);
    });
  }

  private rebindListeners() {
    for (const [event, handlers] of this.listeners.entries()) {
      handlers.forEach((h) => this.socket?.on(event, h));
    }
  }

  /** =========================
   * CONNECTION MGMT
   * ========================= */

  public disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  public reconnect() {
    if (this._config?.url) {
      this.disconnect();
      this.init();
    }
  }

  public reconnectWithBackoff() {
    if (!this._config?.url) return;
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000); // cap at 30s
    setTimeout(() => {
      console.log(`🔄 Reconnecting attempt #${this.retryCount + 1}`);
      this.init();
      this.retryCount++;
    }, delay);
  }

  public isConnected() {
    return this.socket?.connected || false;
  }

  public getSocketId() {
    return this.socket?.id;
  }

  get raw(): Socket | null {
    return this.socket;
  }

  /** =========================
   * MIDDLEWARE & DEBUG
   * ========================= */

  public use(middleware: (event: string, data: unknown) => void) {
    this.middlewares.push(middleware);
  }

  private runMiddlewares(event: string, data: unknown) {
    for (const mw of this.middlewares) {
      try {
        mw(event, data);
      } catch (err) {
        console.error(`[socket:middleware] Failed on ${event}`, err);
      }
    }
  }

  public enableDebug() {
    this.debug = true;
  }

  public disableDebug() {
    this.debug = false;
  }
}
