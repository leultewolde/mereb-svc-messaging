import { buildServer } from './server.js'
import { getNumberEnv, loadEnv } from '@mereb/shared-packages'

loadEnv()

const PORT = getNumberEnv('PORT', 4004)
const HOST = process.env.HOST ?? '0.0.0.0'

try {
  const app = await buildServer()
  await app.listen({ port: PORT, host: HOST })
  console.log(`Messaging service listening on ${HOST}:${PORT}`)
} catch (err) {
  console.error('Failed to start messaging service', err)
  process.exit(1)
}
