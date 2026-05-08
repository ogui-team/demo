import fs from 'fs/promises'
import path from 'path'

interface AuditReportSummary {
  file: string
  exists: boolean
  parseError?: string
  keys?: string[]
  sizeBytes?: number
}

async function loadReportSummaries(reportsDir: string): Promise<AuditReportSummary[]> {
  const entries = await fs.readdir(reportsDir, { withFileTypes: true })
  const reportFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()

  const summaries: AuditReportSummary[] = []
  for (const fileName of reportFiles) {
    const filePath = path.join(reportsDir, fileName)
    try {
      const contents = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(contents)
      summaries.push({
        file: fileName,
        exists: true,
        keys: Object.keys(parsed),
        sizeBytes: Buffer.byteLength(contents, 'utf8'),
      })
    } catch (error) {
      summaries.push({
        file: fileName,
        exists: false,
        parseError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return summaries
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KiB`
  return `${(kb / 1024).toFixed(1)} MiB`
}

async function main(): Promise<void> {
  const reportsDir = path.resolve(__dirname, '../reports')

  try {
    const summaries = await loadReportSummaries(reportsDir)
    if (summaries.length === 0) {
      console.warn('[EngineAudit] No JSON reports found in', reportsDir)
      process.exitCode = 1
      return
    }

    console.log('=== Engine Audit Report Summary ===')
    console.log(`Reports directory: ${reportsDir}`)
    console.log(`Found ${summaries.length} JSON report(s)`)
    console.log('')

    const content = summaries
      .map((report) => {
        if (!report.exists) {
          return `- ${report.file}: parse error (${report.parseError})`
        }
        return `- ${report.file}: ${report.keys?.join(', ') ?? 'no keys'} (${formatBytes(report.sizeBytes ?? 0)})`
      })
      .join('\n')

    console.log(content)

    const latestReport = {
      generatedAt: new Date().toISOString(),
      reports: summaries,
    }

    const latestPath = path.join(reportsDir, 'ENGINE_CAPABILITY_LATEST.json')
    await fs.writeFile(latestPath, JSON.stringify(latestReport, null, 2), 'utf8')

    console.log('')
    console.log(`[EngineAudit] Generated latest audit snapshot: ${latestPath}`)
    process.exitCode = summaries.every((report) => report.exists) ? 0 : 2
  } catch (error) {
    console.error('[EngineAudit] Failed to generate audit summary:', error)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('[EngineAudit] Unexpected error:', error)
  process.exitCode = 1
})
