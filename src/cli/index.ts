import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline'
import { writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { loadConfig, defaultConfigPath } from '../config/load'
import { registerBuiltins, runNotify, runTest, runInit, runDoctor } from './commands'
import { runSetup, type SetupIO } from './setup'
import { renderConfigToml } from './setup-core'
import { detectOpenIsland, realProbe } from '../channels/desktop/detect'
import { join } from 'node:path'
import { homedir } from 'node:os'

const VERSION = '0.2.0' // keep in sync with package.json

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
  setup                    interactive wizard: edit config, install hook, test
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

  if (cmd === 'setup') {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const io: SetupIO = {
      ask: (q, def) =>
        new Promise((res) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => res(a.trim() || def || ''))),
      print: (s) => console.log(s),
    }
    const configPath = defaultConfigPath()
    const existing = existsSync(configPath) ? loadConfig(configPath) : undefined
    const detect = () => detectOpenIsland({ probe: realProbe, exists: existsSync, home: homedir() })
    const answers = await runSetup(io, { configPath, existing, detect })

    if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.beepify-bak.${Date.now()}`)
    writeFileSync(configPath, renderConfigToml(answers))
    console.log(`Wrote ${configPath}`)

    if (/^y/i.test(await io.ask('Install the Claude Code hook now? (y/n)', 'y'))) {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      const r = runInit({ settingsPath, configPath, uninstall: false })
      console.log(r.hook.changed ? 'Installed Beepify hook.' : 'Hook already installed.')
    }
    if (/^y/i.test(await io.ask('Send a test notification now? (y/n)', 'y'))) {
      for (const res of await runTest(loadConfig(configPath))) {
        console.log(`${res.channel}: ${res.skipped ? 'skipped' : res.ok ? 'ok' : 'FAIL ' + (res.error ?? '')}`)
      }
    }
    rl.close()
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
