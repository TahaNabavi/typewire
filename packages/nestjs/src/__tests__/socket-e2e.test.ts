import 'reflect-metadata'
import { INestApplication, UseGuards } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets'
import { SocketClient, defineSocketContracts } from '@tahanabavi/typesocket'
import type { AddressInfo } from 'net'
import { z } from 'zod'
import {
  SocketEvent,
  SocketPayload,
  bindSocketContracts,
  createSocketEmitter,
  createSocketPermissionGuard,
  emitSocketEvent,
  type InferSocketRequest,
} from '../socket'

const wsContracts = defineSocketContracts({
  chat: {
    sendMessage: {
      direction: 'client->server',
      request: z.object({ text: z.string().min(1) }),
      ack: z.object({ id: z.string() }),
    },
    ban: {
      direction: 'client->server',
      permission: { require: ['chat.MANAGE'], reason: 'Moderators only' },
      request: z.object({ userId: z.string() }),
      ack: z.object({ banned: z.boolean() }),
    },
    drifted: {
      direction: 'client->server',
      request: z.object({ text: z.string() }),
      ack: z.object({ id: z.string() }),
    },
    message: {
      direction: 'server->client',
      payload: z.object({ id: z.string(), text: z.string() }),
    },
  },
})

const events = bindSocketContracts(wsContracts)

const DenyGuard = createSocketPermissionGuard({
  getPermissions: () => 0n,
  authorize: () => ({ granted: false, missing: ['chat.MANAGE'] }),
})

@WebSocketGateway({ cors: true })
class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server!: {
    emit(event: string, ...args: unknown[]): unknown
  }

  private readonly emit = createSocketEmitter(() => this.server)

  handleConnection(): void {
    /* nothing — the client drives every assertion below */
  }

  @SocketEvent(events.chat.sendMessage)
  send(
    @SocketPayload() input: InferSocketRequest<typeof events.chat.sendMessage>
  ) {
    // Pushed to everyone, validated against the contract's `payload`.
    this.emit(events.chat.message, { id: 'm1', text: input.text })
    return { id: 'm1' }
  }

  @SocketEvent(events.chat.ban)
  @UseGuards(DenyGuard)
  ban() {
    return { banned: true }
  }

  @SocketEvent(events.chat.drifted)
  drifted() {
    return { wrong: true } as never // no `id` — the ack contract is violated
  }
}

describe('typesocket gateways', () => {
  let app: INestApplication
  let client: SocketClient<typeof wsContracts>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ChatGateway],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useLogger(false)
    await app.listen(0)

    const { port } = app.getHttpServer().address() as AddressInfo

    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('the gateway never accepted a connection')),
        10000
      )

      client = new SocketClient(
        {
          url: `http://127.0.0.1:${port}`,
          ackTimeoutMs: 1500,
          reconnection: false,
          onValidationError: () => undefined,
        },
        wsContracts,
        {
          onConnect: () => {
            clearTimeout(timer)
            resolve()
          },
        }
      )
    })

    client!.connect()
    await connected
  }, 20000)

  afterAll(async () => {
    client?.disconnect()
    await app?.close()
  })

  // The event name is never written out on either side: both ends resolve it
  // from the contract, so it cannot drift.
  it("binds the handler to the contract's wire event name", () => {
    expect(events.chat.sendMessage.event).toBe('chat.sendMessage')
    expect(events.chat.sendMessage.eventId).toBe('chat.sendMessage')
  })

  it('round-trips an emit and its acknowledgement', async () => {
    await expect(
      client.modules.chat.sendMessage({ text: 'hello' })
    ).resolves.toEqual({ id: 'm1' })
  }, 10000)

  it('delivers a server push the client validates against `payload`', async () => {
    const received = client.modules.chat.message.wait({ timeoutMs: 5000 })
    await client.modules.chat.sendMessage({ text: 'broadcast me' })

    await expect(received).resolves.toEqual({
      id: 'm1',
      text: 'broadcast me',
    })
  }, 10000)

  // typesocket says of its client-side permission middleware that the check is
  // UX only and a gateway guard is the real enforcement point. This is it.
  it("enforces a client->server event's contract permission server-side", async () => {
    const seen = new Promise<Record<string, unknown>>((resolve) => {
      // `WsException` reaches the wire as socket.io's standard `exception`
      // event; the ack is never called, which is why the contract is where a
      // handled failure belongs.
      ;(
        client as unknown as {
          socket: { on(e: string, cb: (p: never) => void): void }
        }
      ).socket.on('exception', resolve)
    })

    const emit = client.modules.chat.ban({ userId: '1' }).catch(() => undefined)

    await expect(seen).resolves.toMatchObject({
      event: 'chat.ban',
      code: 'FORBIDDEN',
      message: 'Moderators only',
    })
    await emit
  }, 10000)

  it('rejects an inbound frame that fails the contract', async () => {
    const seen = new Promise<Record<string, unknown>>((resolve) => {
      ;(
        client as unknown as {
          socket: { on(e: string, cb: (p: never) => void): void }
        }
      ).socket.on('exception', resolve)
    })

    // The client validates outbound too, so the bad frame is sent raw.
    ;(
      client as unknown as { socket: { emit(e: string, p: unknown): void } }
    ).socket.emit('chat.sendMessage', { text: '' })

    await expect(seen).resolves.toMatchObject({
      event: 'chat.sendMessage',
      code: 'VALIDATION_ERROR',
    })
  }, 10000)

  // typesocket *validates* the ack on arrival, so an ack that does not match
  // the contract does not merely surprise the caller — it rejects, far from
  // the server that produced it.
  it('catches an acknowledgement that violates the contract', async () => {
    const seen = new Promise<Record<string, unknown>>((resolve) => {
      ;(
        client as unknown as {
          socket: { on(e: string, cb: (p: never) => void): void }
        }
      ).socket.on('exception', resolve)
    })

    const emit = client.modules.chat
      .drifted({ text: 'hi' })
      .catch(() => undefined)

    await expect(seen).resolves.toMatchObject({
      event: 'chat.drifted',
      code: 'ACK_CONTRACT_VIOLATION',
    })
    await emit
  }, 10000)
})

describe('bindSocketContracts', () => {
  it('resolves the wire name the same way both ends do', () => {
    const bound = bindSocketContracts(
      defineSocketContracts({
        chat: {
          ping: { direction: 'client->server', request: z.object({}) },
          pong: {
            direction: 'server->client',
            event: 'custom-name',
            payload: z.object({}),
          },
        },
      })
    )

    expect(bound.chat.ping.event).toBe('chat.ping')
    expect(bound.chat.pong.event).toBe('custom-name')
  })

  // One frame would reach both handlers, and both would try to acknowledge it.
  it('refuses two events that collide on one wire name', () => {
    expect(() =>
      bindSocketContracts(
        defineSocketContracts({
          a: {
            one: {
              direction: 'client->server',
              event: 'shared',
              request: z.object({}),
            },
          },
          b: {
            two: {
              direction: 'client->server',
              event: 'shared',
              request: z.object({}),
            },
          },
        })
      )
    ).toThrow(/both map to the wire event "shared"/)
  })
})

describe('emitSocketEvent', () => {
  const bound = bindSocketContracts(
    defineSocketContracts({
      chat: {
        message: {
          direction: 'server->client',
          payload: z.object({ id: z.string(), text: z.string() }),
        },
        sendMessage: {
          direction: 'client->server',
          request: z.object({ text: z.string() }),
        },
      },
    })
  )

  it('emits the wire name with the validated payload', () => {
    const emitted: unknown[][] = []
    const target = { emit: (...args: unknown[]) => emitted.push(args) }

    emitSocketEvent(target, bound.chat.message, { id: '1', text: 'hi' })

    expect(emitted).toEqual([['chat.message', { id: '1', text: 'hi' }]])
  })

  // The direction that actually breaks clients: typesocket *drops* an inbound
  // payload that fails its schema, so a field renamed on the server turns into
  // a listener that silently stops firing.
  it('refuses a payload the contract does not describe', () => {
    const target = { emit: () => undefined }

    expect(() =>
      emitSocketEvent(target, bound.chat.message, { id: '1' } as never)
    ).toThrow(/Outbound payload contract violation/)
  })

  it('refuses to emit an event the client is supposed to send', () => {
    const target = { emit: () => undefined }

    expect(() =>
      emitSocketEvent(target, bound.chat.sendMessage as never, {} as never)
    ).toThrow(/a server does not emit it/)
  })
})
