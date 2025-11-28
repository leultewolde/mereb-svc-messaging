import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLogger } from '@mereb/shared-packages'

const logger = createLogger('svc-messaging-migrate')
const execFileAsync = promisify(execFile)

export async function runMigrations() {
  const prismaCli = path.join(process.cwd(), 'node_modules', '.bin', 'prisma')

  logger.info('Running prisma migrate deploy')

  try {
    const { stdout, stderr } = await execFileAsync(prismaCli, ['migrate', 'deploy'], {
      env: process.env
    })

    if (stdout?.trim()) {
      logger.info({ stdout }, 'Prisma migrate output')
    }
    if (stderr?.trim()) {
      logger.warn({ stderr }, 'Prisma migrate warnings')
    }

    logger.info('Prisma migrations applied')
  } catch (err) {
    logger.error({ err }, 'Failed to run prisma migrate deploy')
    throw err
  }
}
