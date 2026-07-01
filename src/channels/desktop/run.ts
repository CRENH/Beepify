import { execFile } from 'node:child_process'
import type { Runner } from './types'

export const defaultRun: Runner = (file, args, input) =>
  new Promise((resolve) => {
    const child = execFile(file, args, (err, _stdout, stderr) => {
      resolve({
        code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0,
        stderr: (stderr || (err ? err.message : '')).toString(),
      })
    })
    if (input !== undefined) child.stdin?.end(input)
  })
