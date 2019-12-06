import * as cli from "./cli"
import * as Path from "./path"
import { Config } from "./config"
import { build } from "./builder"
import { fmtduration, monotime } from "./util"

const options :cli.FlagSpec[] = [
  ["o",       `Write output to directory. Defaults to \"_build\".`, "<dir>"],
  ["C",       `Sets working directory`, "<dir>"],
  [["g", "dev"], `Enable development mode`],
  ["quiet",   "Only print errors"],
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

  let c = new Config()
  c.srcdir = opt.C || c.srcdir
  c.outdir = opt.o || c.outdir
  c.quiet  = opt.quiet
  c.debug  = !!(opt.g || opt.dev)
  c.baseUrl = "/"  // must end in "/"
  c.name = c.srcdir == "." ? Path.base(Path.resolve(c.srcdir)) : c.srcdir

  let timeStart = monotime()
  c.log(`Building ${c.name}`)

  await build(c)

  c.log(`Built ${c.name} in ${fmtduration(monotime() - timeStart)}`)

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
