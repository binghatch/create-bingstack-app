#!/usr/bin/env node

import * as p from '@clack/prompts'
import { execa } from 'execa'
import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

const TEMPLATE_REPO = 'binghatch/bingstack-template'

const args = process.argv.slice(2)
const argProjectName = args.find((a) => !a.startsWith('--'))
const argTemplate = args.find((a) => a.startsWith('--template='))?.split('=')[1]

async function main() {
  console.log()
  p.intro('create-bingstack-app')

  let projectName = argProjectName

  if (!projectName) {
    projectName = await p.text({
      message: 'Project name',
      placeholder: 'my-app',
      validate: validateSlug,
    })
    if (p.isCancel(projectName)) return cancel()
  }

  const protectedRoute = await p.text({
    message: 'Main protected page name (shown after sign-in)',
    placeholder: 'dashboard',
    initialValue: 'dashboard',
    validate: validateSlug,
  })
  if (p.isCancel(protectedRoute)) return cancel()

  const pkgManager = await p.select({
    message: 'Package manager',
    options: [
      { value: 'npm', label: 'npm' },
      { value: 'bun', label: 'bun' },
      { value: 'pnpm', label: 'pnpm' },
    ],
    initialValue: 'npm',
  })
  if (p.isCancel(pkgManager)) return cancel()

  const targetDir = path.resolve(process.cwd(), projectName)

  if (existsSync(targetDir)) {
    const overwrite = await p.confirm({
      message: `"${projectName}" already exists. Overwrite?`,
      initialValue: false,
    })
    if (p.isCancel(overwrite) || !overwrite) return cancel()
    const s = p.spinner()
    s.start('Removing existing directory...')
    await fs.rm(targetDir, { recursive: true })
    s.stop('Removed')
  }

  {
    const s = p.spinner()
    s.start('Cloning template...')
    try {
      const { downloadTemplate } = await import('giget')
      const templateSource = argTemplate ?? `gh:${TEMPLATE_REPO}`
      await downloadTemplate(templateSource, { dir: targetDir, force: true })
      s.stop('Template cloned')
    } catch (err) {
      s.stop('Failed to clone template')
      p.log.error(String(err.message ?? err))
      process.exit(1)
    }
  }

  {
    const s = p.spinner()
    s.start('Configuring project...')
    await applyReplacements(targetDir, projectName, protectedRoute)
    s.stop('Project configured')
  }

  {
    const s = p.spinner()
    s.start(`Installing dependencies with ${pkgManager}...`)
    await execa(pkgManager, ['install'], { cwd: targetDir })
    s.stop('Dependencies installed')
  }

  p.outro(
    `Done! Next steps:\n\n` +
      `  cd ${projectName}\n` +
      `  cp .env.example .env   # fill in your secrets\n` +
      `  ${pkgManager} run dev`,
  )
}

async function applyReplacements(dir, appName, protectedRoute) {
  const oldRoute = 'workspace'

  if (protectedRoute !== oldRoute) {
    const oldFile = path.join(dir, `src/routes/_protected/${oldRoute}.tsx`)
    const newFile = path.join(dir, `src/routes/_protected/${protectedRoute}.tsx`)
    if (existsSync(oldFile)) {
      await fs.rename(oldFile, newFile)
    }
  }

  const files = await walkFiles(dir, ['node_modules', '.git', 'dist', '.cache', '.turbo'])

  for (const file of files) {
    if (!isTextFile(file)) continue

    let content = await fs.readFile(file, 'utf-8').catch(() => null)
    if (content === null) continue

    const original = content

    if (file.endsWith('package.json')) {
      content = content.replace(/"name":\s*"app"/, `"name": "${appName}"`)
    }

    content = content.replaceAll('TanStack Start Starter', toTitleCase(appName))

    if (protectedRoute !== oldRoute) {
      content = content
        .replaceAll(`/_protected/${oldRoute}`, `/_protected/${protectedRoute}`)
        .replaceAll(`/${oldRoute}`, `/${protectedRoute}`)
        .replaceAll(`"${oldRoute}"`, `"${protectedRoute}"`)
        .replaceAll(`'${oldRoute}'`, `'${protectedRoute}'`)
        .replaceAll(toTitleCase(oldRoute), toTitleCase(protectedRoute))
    }

    if (content !== original) {
      await fs.writeFile(file, content, 'utf-8')
    }
  }
}

async function walkFiles(dir, ignore = []) {
  const results = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (ignore.includes(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath, ignore)))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx',
  '.json', '.md', '.txt', '.html', '.css', '.env',
  '.example', '.gitignore', '.prettierignore', '.eslintignore',
  '.sql', '.toml', '.yaml', '.yml',
])

function isTextFile(filePath) {
  const ext = path.extname(filePath)
  const base = path.basename(filePath)
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(base)
}

function toTitleCase(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function validateSlug(value) {
  if (!value || value.trim() === '') return 'This field is required'
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    return 'Use lowercase letters, numbers, and hyphens only (e.g. my-app)'
}

function cancel() {
  p.cancel('Cancelled')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
