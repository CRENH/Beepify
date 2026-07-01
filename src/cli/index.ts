import { parseArgs } from 'node:util'
import { loadConfig, defaultConfigPath } from '../config/load'
import { registerBuiltins, runNotify, runTest, runInit, runDoctor } from './commands'
import { join } from 'node:path'
import { homedir } from 'node:os'

const VERSION = '0.1.1' // keep in sync with package.json

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) return resolve('')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

const HELP = `beepify <command>

  notify --source <name>   read a hook event on stdin and push (used by hooks)
  init [--uninstall]       scaffold config + install the Claude Code hook
  test                     send a sample notification to verify channels
  doctor                   print config / channel / hook diagnostics
  --version                print version`

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  registerBuiltins()
  const cmd = argv[0]

  if (cmd === 'notify') {
    try {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { source: { type: 'string', default: 'claude-code' } },
        allowPositionals: true,
      })
      const raw = await readStdin()
      const config = loadConfig()
      await runNotify(raw, values.source as string, config)
    } catch {
      // never surface errors to the agent
    }
    return 0
  }

  if (cmd === 'init') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { uninstall: { type: 'boolean', default: false } },
      allowPositionals: true,
    })
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    const r = runInit({ settingsPath, configPath: defaultConfigPath(), uninstall: values.uninstall as boolean })
    if (values.uninstall) {
      console.log(r.hook.changed ? 'Removed Beepify hook from settings.json' : 'No Beepify hook found')
    } else {
      console.log(r.configCreated ? `Created ${defaultConfigPath()}` : `Config already exists at ${defaultConfigPath()}`)
      console.log(r.hook.changed ? 'Installed Beepify hook into settings.json' : 'Hook already installed')
      console.log('Next: edit your config.toml, then run `beepify test`.')
    }
    return 0
  }

  if (cmd === 'test') {
    const results = await runTest(loadConfig())
    for (const r of results) console.log(`${r.channel}: ${r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAIL ' + (r.error ?? '')}`)
    return 0
  }

  if (cmd === 'doctor') {
    for (const line of runDoctor(loadConfig(), join(homedir(), '.claude', 'settings.json'))) console.log(line)
    return 0
  }

  if (cmd === '--version' || cmd === '-v') {
    console.log(VERSION)
    return 0
  }

  console.log(HELP)
  return cmd ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(`beepify: ${e instanceof Error ? e.message : e}`); process.exit(1) })
