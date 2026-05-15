import { describe, it, expect } from 'vitest'
import app from '../src/app.js'

describe('GET /health', () => {
  it('返回 200 和 status ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
