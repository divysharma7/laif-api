import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
  .split('\0')
  .filter(Boolean)

const allowedEnvironmentTemplates = [
  /^\.env\.example$/,
  /^\.env\..+\.example$/,
]

const forbiddenEnvironmentFile = /(^|\/)\.env(?:$|\.)/

const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
]

const sensitiveAssignment = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_URL|JWT_SECRET|GOOGLE_CLIENT_SECRET|GOOGLE_TOKEN_ENCRYPTION_KEY|OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|STRIPE_SECRET_KEY)\s*=\s*(.+?)\s*$/i

function isAllowedTemplate(file) {
  return allowedEnvironmentTemplates.some(pattern => pattern.test(file))
}

function isPlaceholder(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
  return normalized === ''
    || normalized.includes('example')
    || normalized.includes('placeholder')
    || normalized.includes('replace-me')
    || normalized.includes('replace_with')
    || normalized.includes('changeme')
    || normalized.includes('your-')
    || normalized.includes('your_')
    || normalized.includes('<')
    || normalized.includes('${')
    || normalized.includes('localhost')
    || normalized.includes('127.0.0.1')
}

const findings = []

for (const file of trackedFiles) {
  const normalizedFile = file.replaceAll('\\', '/')

  if (forbiddenEnvironmentFile.test(normalizedFile) && !isAllowedTemplate(normalizedFile)) {
    findings.push({ file: normalizedFile, rule: 'tracked-environment-file' })
    continue
  }

  let content
  try {
    content = readFileSync(path.resolve(file), 'utf8')
  } catch {
    continue
  }

  if (credentialPatterns.some(pattern => pattern.test(content))) {
    findings.push({ file: normalizedFile, rule: 'credential-pattern' })
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(sensitiveAssignment)
    if (match && !isPlaceholder(match[2])) {
      findings.push({ file: normalizedFile, rule: `sensitive-assignment:${match[1]}` })
      break
    }
  }
}

if (findings.length) {
  process.stderr.write('Secret scan failed. Potential credentials were found in tracked files.\n')
  for (const finding of findings) {
    process.stderr.write(`- ${finding.file} (${finding.rule})\n`)
  }
  process.stderr.write('No matched values were printed. Remove the file/value from tracking and rotate any exposed credential.\n')
  process.exit(1)
}

process.stdout.write(`Secret scan passed for ${trackedFiles.length} tracked files.\n`)
