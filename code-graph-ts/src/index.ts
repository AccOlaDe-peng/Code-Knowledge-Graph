import { serve } from '@hono/node-server'
import app from './app.js'

const port = Number(process.env.PORT ?? 8848)
const host = process.env.HOST ?? '0.0.0.0'

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Server running at http://${info.address}:${info.port}`)
})
