import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('CORS preflight contract', () => {
  it('allows the timezone header used to complete a Focus session', async () => {
    const client = request(createApp())
    const options = (client as unknown as { options: typeof client.get }).options.bind(client)
    const response = await options('/api/focus/sessions/active/complete')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-timezone')
      .expect(204)

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-methods']).toContain('POST')
    const allowHeaders = response.headers['access-control-allow-headers']
    const headerValue = Array.isArray(allowHeaders) ? allowHeaders.join(',') : (allowHeaders ?? '')
    expect(headerValue.toLowerCase()).toContain('x-timezone')
  })
})
