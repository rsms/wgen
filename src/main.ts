import * as cli from "./cli"
import { Config } from "./config"
import { build } from "./builder"

const options :cli.FlagSpec[] = [
  ["o",       `Write output to directory. Defaults to \"_build\".`, "<dir>"],
  ["C",       `Sets working directory`, "<dir>"],
  [["g", "dev"], `Enable development mode`],
  ["verbose", "Print detailed information about what simple is doing"],
  ["version", "Print version information"],
]

if (DEBUG) {
  options.splice(options.length, 0, ...[
    ["debug-test",   "Run unit tests before calling main()"],
    ["debug-bench",  "Run all benchmarks before calling main()"],
    ["debug-bench",  "Run specific benchmark before calling main()", "<name>"],
    ["debug-nomain", "Do not call main(). Useful with -test and -debug-bench."],
  ] as cli.FlagSpec[])
}

async function main(argv :string[]) :Promise<int> {
  let [opt, /*args*/ ] = cli.parseopt(argv.slice(1),
    "Usage: $prog [options]",
    ...options
  )

  if (DEBUG && opt['debug-nomain']) {
    return 0
  }

  if (opt.version) {
    print(`simple ${VERSION + (VERSION_TAG ? "-" + VERSION_TAG : "")}`)
    return 0
  }

  let config = new Config()
  config.srcdir = opt.C || config.srcdir
  config.outdir = opt.o || config.outdir
  config.debug  = !!(opt.g || opt.dev)

  // dlog({opt, args, config})

  await build(config)

  return 0
}

// --------------------------------------------------------------------------------------------
// entry
if (DEBUG) {
  GlobalContext.runTests()
  .then(() => GlobalContext.runBenchmarks())
  .then(() => main(process.argv.slice(1)).catch(cli.die))
  .then(process.exit)
} else {
  main(process.argv.slice(1)).catch(cli.die).then(process.exit)
}
