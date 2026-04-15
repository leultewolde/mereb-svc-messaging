import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(__dirname, '..')
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mereb-service-lockfile-'))

function cleanup() {
  rmSync(tempDir, { recursive: true, force: true })
}

try {
  const packageJsonPath = path.join(repoDir, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  cpSync(packageJsonPath, path.join(tempDir, 'package.json'))

  const optionalFiles = ['.npmrc', 'pnpm-workspace.yaml']
  for (const fileName of optionalFiles) {
    const sourcePath = path.join(repoDir, fileName)
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, path.join(tempDir, fileName))
    }
  }

  const installResult = spawnSync(
    'pnpm',
    ['install', '--lockfile-only', '--ignore-scripts'],
    {
      cwd: tempDir,
      stdio: 'inherit'
    }
  )

  if (installResult.status !== 0) {
    process.exit(installResult.status ?? 1)
  }

  copyFileSync(path.join(tempDir, 'pnpm-lock.yaml'), path.join(repoDir, 'pnpm-lock.yaml'))
  console.log(`Refreshed ${packageJson.name ?? path.basename(repoDir)} pnpm-lock.yaml`)
} finally {
  cleanup()
}
