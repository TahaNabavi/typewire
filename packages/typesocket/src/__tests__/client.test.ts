import { SocketService } from "../client";
import { io as mockIo, Socket } from "socket.io-client";
import z from "zod";
import { jest } from "@jest/globals";

jest.mock("socket.io-client");

const mockSocket: Partial<Socket> = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn() as unknown as <T = any>(
    event: string,
    data: any,
    callback?: (response: T) => void
  ) => void,
  connected: true,
  id: "mock-socket-id",
  once: jest.fn(),
  disconnect: jest.fn(),
} as unknown as jest.Mocked<Socket>;

(mockIo as jest.Mock).mockReturnValue(mockSocket);

describe("SocketService", () => {
  type OnEvents = {
    message: { response: z.ZodObject<{ text: z.ZodString }> };
  };

  type EmitEvents = {
    sendMessage: {
      request: z.ZodObject<{ text: z.ZodString }>;
      callback: z.ZodObject<{ success: z.ZodBoolean }>;
    };
  };

  let socketService: SocketService<OnEvents, EmitEvents>;

  beforeEach(() => {
    jest.clearAllMocks();

    socketService = new SocketService(
      { url: "http://localhost:3000" },
      {
        message: { response: z.object({ text: z.string() }) },
      },
      {
        sendMessage: {
          request: z.object({ text: z.string() }),
          callback: z.object({ success: z.boolean() }),
        },
      },
      {
        onConnect: jest.fn(),
        onDisconnect: jest.fn(),
        onConnectError: jest.fn(),
      }
    ).init(); 
  });

  it("should initialize and call io with correct URL", () => {
    expect(mockIo).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.any(Object)
    );
  });

  it("should emit events correctly with valid data", () => {
    socketService.emit("sendMessage", { text: "Hello" });
    expect(mockSocket.emit).toHaveBeenCalledWith("sendMessage", {
      text: "Hello",
    });
  });

  it("should reject invalid emit data", () => {
    console.error = jest.fn();
    // @ts-ignore: pass invalid data
    socketService.emit("sendMessage", { invalid: true });
    expect(console.error).toHaveBeenCalled();
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it("should call emitAsync and resolve with callback", async () => {
    (mockSocket.emit as jest.Mock).mockImplementation(
      (event: string, data: any, callback?: (resp: any) => void) => {
        callback?.({ success: true });
      }
    );

    const result = await socketService.emitAsync("sendMessage", { text: "Hi" });
    expect(result).toEqual({ success: true });
  });

  it("should queue emits if socket not connected", () => {
    (mockSocket as any).connected = false;
    socketService.emitQueued("sendMessage", { text: "Queued" });
    expect(socketService["queue"].length).toBe(1);
  });

  it("should flush queued events on connect", () => {
    socketService["queue"].push({
      event: "sendMessage",
      data: [{ text: "Queued" }],
    });
    socketService["socket"] = mockSocket as Socket;
    socketService["flushQueue"]();
    expect(mockSocket.emit).toHaveBeenCalledWith("sendMessage", {
      text: "Queued",
    });
    expect(socketService["queue"].length).toBe(0);
  });

  it("should handle on events and validate data", () => {
    const handler = jest.fn();
    socketService.on("message", handler);
    const listener = socketService["listeners"]
      .get("message")!
      .values()
      .next().value;
    listener({ text: "Hello World" });
    expect(handler).toHaveBeenCalledWith({ text: "Hello World" });
  });

  it("should reject invalid on event data", () => {
    console.error = jest.fn();
    const handler = jest.fn();
    socketService.on("message", handler);
    const listener = socketService["listeners"]
      .get("message")!
      .values()
      .next().value;
    listener({ invalid: "bad" });
    expect(console.error).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("should run middleware before handlers", () => {
    const middleware = jest.fn();
    socketService.use(middleware);

    const handler = jest.fn();
    socketService.on("message", handler);

    const listener = socketService["listeners"]
      .get("message")!
      .values()
      .next().value;
    listener({ text: "Hi" });
    expect(middleware).toHaveBeenCalledWith("message", { text: "Hi" });
    expect(handler).toHaveBeenCalledWith({ text: "Hi" });
  });

  it("should disconnect socket", () => {
    socketService.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(socketService.raw).toBeNull();
  });

  it("should return socket id", () => {
    expect(socketService.getSocketId()).toBe("mock-socket-id");
  });
});
