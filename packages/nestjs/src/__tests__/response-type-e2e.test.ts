import 'reflect-metadata'
import { Controller, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Contracts } from '@tahanabavi/typefetch'
import { zBlob, zFile, zStream } from '@tahanabavi/typefetch'
import { Readable } from 'stream'
import request from 'supertest'
import { z } from 'zod'
import { TypeFetchEndpoint, contractFile } from '../index'

const PDF = Buffer.from('%PDF-1.4 pretend', 'utf8')

const contracts = {
  report: {
    download: {
      method: 'GET',
      path: '/reports/download',
      responseType: 'file',
      request: z.object({}),
      response: zFile(),
    },
    bytes: {
      method: 'GET',
      path: '/reports/bytes',
      responseType: 'blob',
      request: z.object({}),
      response: zBlob(),
    },
    stream: {
      method: 'GET',
      path: '/reports/stream',
      responseType: 'stream',
      request: z.object({}),
      response: zStream(),
    },
    csv: {
      method: 'GET',
      path: '/reports/csv',
      responseType: 'text',
      request: z.object({}),
      response: z.string(),
    },
    broken: {
      method: 'GET',
      path: '/reports/broken',
      responseType: 'blob',
      request: z.object({}),
      response: zBlob(),
    },
    json: {
      method: 'GET',
      path: '/reports/json',
      request: z.object({}),
      response: z.object({ ok: z.boolean() }),
    },
  },
} as const satisfies Contracts

@Controller()
class ReportController {
  @TypeFetchEndpoint(contracts.report.download)
  download() {
    return contractFile(PDF, {
      filename: 'Q3 résumé.pdf',
      contentType: 'application/pdf',
    })
  }

  @TypeFetchEndpoint(contracts.report.bytes)
  bytes() {
    return PDF
  }

  @TypeFetchEndpoint(contracts.report.stream)
  stream() {
    return Readable.from([Buffer.from('chunk-1'), Buffer.from('chunk-2')])
  }

  @TypeFetchEndpoint(contracts.report.csv)
  csv() {
    return 'id,name\n1,Taha'
  }

  @TypeFetchEndpoint(contracts.report.broken)
  broken() {
    // A plain object for a `responseType: "blob"` endpoint — the mistake this
    // release turns into a legible error instead of `{"type":"Buffer",…}`.
    return { oops: true } as never
  }

  @TypeFetchEndpoint(contracts.report.json)
  json() {
    return { ok: true }
  }
}

describe('responseType on the server', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportController],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  // Before this release the handler's Buffer was JSON-serialised into
  // `{"type":"Buffer","data":[37,80,…]}`, which the client then tried to read
  // as a Blob.
  it('sends a file as bytes, not as a serialised Buffer', async () => {
    const res = await request(app.getHttpServer()).get('/reports/download')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(Buffer.from(res.body).toString('utf8')).toBe(PDF.toString('utf8'))
  })

  it('sends both Content-Disposition spellings so a non-ASCII name survives', async () => {
    const res = await request(app.getHttpServer()).get('/reports/download')
    const disposition = res.headers['content-disposition']

    // The extended form carries the real name; the quoted one is the ASCII
    // fallback typefetch only reads when `filename*` is absent.
    expect(disposition).toContain("filename*=UTF-8''Q3%20r%C3%A9sum%C3%A9.pdf")
    expect(disposition).toContain('filename="Q3 rsum.pdf"')
    expect(disposition).toMatch(/^attachment;/)
  })

  it('exposes the headers a cross-origin client cannot otherwise read', async () => {
    const res = await request(app.getHttpServer()).get('/reports/download')
    const exposed = res.headers['access-control-expose-headers']

    // Without these the download has no filename and the progress bar has no
    // total — both silently, which is the whole reason they are set here.
    expect(exposed).toContain('Content-Disposition')
    expect(exposed).toContain('Content-Length')
  })

  it('sends Content-Length for a buffer, so download progress is computable', async () => {
    const res = await request(app.getHttpServer()).get('/reports/bytes')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(Number(res.headers['content-length'])).toBe(PDF.length)
  })

  it('streams a Readable instead of trying to serialise it', async () => {
    const res = await request(app.getHttpServer()).get('/reports/stream')

    expect(res.status).toBe(200)
    expect(Buffer.from(res.body).toString('utf8')).toBe('chunk-1chunk-2')
  })

  // Express answers a bare string with `text/html`, which is both wrong for a
  // CSV and a stored-XSS foot-gun when the string came from user input.
  it('sends text/plain for a responseType: text endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/reports/csv')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.text).toBe('id,name\n1,Taha')
  })

  it('still validates a text response against the contract', async () => {
    // `response: z.string()` held, so the value came back untouched.
    const res = await request(app.getHttpServer()).get('/reports/csv')
    expect(res.text).toBe('id,name\n1,Taha')
  })

  it('names the mistake when a binary endpoint returns an object', async () => {
    const res = await request(app.getHttpServer()).get('/reports/broken')

    expect(res.status).toBe(500)
    expect(res.body.code).toBe('RESPONSE_TYPE_MISMATCH')
    expect(res.body.message).toMatch(/contractFile\(body, \{ filename/)
  })

  it('leaves a plain JSON endpoint exactly as it was', async () => {
    const res = await request(app.getHttpServer()).get('/reports/json')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual({ ok: true })
  })
})
