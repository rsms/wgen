#!/usr/bin/env TSC_NONPOLLING_WATCHER=1 node

// Usage: build.js [-w [-clean]] [options]
//        build.js -O [-nominify] [options]
// options:
//  -O          Generate optimized product
//  -w          Watch sources for changes and rebuild incrementally
//  -o <file>   Write product to <file>
//  -target <target>
//              Sets the TARGET constant. Defaults to "generic".
//  -clean      Throw away cache. Implied with -O.
//  -pretty     Pretty-print optimized code (effective only with -O)
//  -nobuild    Do not build (i.e. only run the linter)
//  -nolint     Do not run the linter
//  -color      Style output even if stdout or stderr is not TTY
//  -no-warn-unused
//              Supress warnings about unused variables and parameters
//  -h, -help   Print this help message to stderr and exit
//

const rollup = require('rollup')
const typescriptPlugin = require('rollup-plugin-typescript2')
const fs = require('fs')
const Path = require('path')
const subprocess = require('child_process')
const vm = require('vm')
const tty = require('tty')
const { join: pjoin, relative: relpath, dirname } = Path
const promisify = require('util').promisify
const readfile = promisify(fs.readFile)
let worker_threads = null
try { worker_threads = require('worker_threads') } catch(_) {}
const isWorker = !!(worker_threads && !worker_threads.isMainThread)

// fundamental files
const rootdir = __dirname;
const pkg = require(pjoin(rootdir, 'package.json'))
const tsconfigfile = pjoin(rootdir, 'tsconfig.json')
const tsconfig = parseTSConfigFile(tsconfigfile)

// CLI args
const argv = (isWorker && worker_threads.workerData.__argv) || process.argv
const prog = relpath(".", argv[1])
const debug = !argv.includes('-O')
const watch = argv.includes('-w')
const clean = argv.includes('-clean')
const pretty = argv.includes('-pretty')
const noBuild = argv.includes("-nobuild")
const noLint = argv.includes("-nolint")
const productIsExectuable = !argv.includes("-lib")
const diagUnused = !argv.includes("-no-warn-unused")

// config
const productName = "wgen"
const cachedir = pjoin(rootdir, ".build-cache")
const srcdir   = pjoin(rootdir, "src")
const mainEntry = pjoin(srcdir, "main.ts")
let outfile  = pjoin(
  pjoin(rootdir, tsconfig.outDir || "dist"),
  (debug ? productName + ".g" : productName) +
  (productIsExectuable ? "" : ".js")
)
const debugSourceMapRoot = `/<${productName}> src`

// linter ts options
const linterTSCompilerOptions = {
  allowUnreachableCode: false,
  alwaysStrict: true,
  noFallthroughCasesInSwitch: true,
  noImplicitAny: true,
  noImplicitReturns: true,
  noImplicitThis: true,
  noUnusedLocals: diagUnused,
  noUnusedParameters: diagUnused,
  strictNullChecks: true,
  // strict: true, // ALL THE CHECKS -- "pedantic"
}

// do not try to embed these libraries
const externalLibs = [
  // nodejs builtins
  "assert",         "globals",      "readline",
  "async_hooks",    "http",         "repl",
  "base",           "http2",        "stream",
  "buffer",         "https",        "string_decoder",
  "child_process",  "index",        "timers",
  "cluster",        "inspector",    "tls",
  "console",        "module",       "trace_events",
  "constants",      "net",          "tty",
  "crypto",         "os",           "url",
  "dgram",          "path",         "util",
  "dns",            "perf_hooks",   "v8",
  "domain",         "process",      "vm",
  "events",         "punycode",     "worker_threads",
  "fs",             "querystring",  "zlib",

  // node_modules that are always external
  "source-map-support",
  "postcss-nesting",
  "typescript",

  // also non-dev deps
  ...Object.keys(pkg.dependencies || {}),
]

// parse CLI arguments
if (argv.includes('-o')) {
  outfile = argv[argv.indexOf('-o') + 1]
  if (!outfile || outfile[0] == "-") {
    console.error(`${prog}: missing value for -o (see ${prog} -help`)
    process.exit(1)
  }
} else {
  let arg = argv.find(arg => arg.startsWith('-o='))
  if (arg) {
    outfile = arg.substr(3).trim() // strip prefix "-o="
    if (outfile.length == 0 || outfile == "/") {
      console.error(`${prog}: empty value for -o (see ${prog} -help`)
      process.exit(1)
    }
  }
}
let forceTTYColors = 0
if (argv.includes("-color")) {
  let t = process.env.TERM || ""
  forceTTYColors = (
    t &&
    ['xterm','screen','vt100'].some(s => t.indexOf(s) != -1) ? (
      t.indexOf('256color') != -1 ? 8 : 4
    ) : 2
  )
}
if (argv.includes('-h') || argv.includes('-help') || argv.includes('--help')) {
  // show usage, read from comment at top of file
  let lines = fs.readFileSync(__filename, 'utf8').split(/\n/, 100)
  let started = false, end = 0, usage = []
  for (let i = 1; i < lines.length; ++i) {
    let line = lines[i]
    if (started) {
      if (!line.startsWith('//')) {
        console.error(usage.join('\n').replace(/[\r\t\n\s]+$/, ''))
        break
      }
      usage.push(line.substr(3))
    } else if (line.startsWith('// Usage:')) {
      started = true
      usage.push(line.substr(3))
    }
  }
  process.exit(1)
} else if (watch && !debug) {
  console.error("error: both -O and -w provided -- confused. Try -h for help")
  process.exit(1)
} else if (!debug && clean) {
  console.warn("warning: -clean has no effect in combination with -O")
}

let TARGET = "generic"
if (argv.includes('-target')) {
  TARGET = argv[argv.indexOf('-target') + 1]
}

// error handling
function onError(err) {
  if (typeof err != "object" || !err._wasReported) {
    console.error(`${prog}: ${err.stack||err}`)
  }
  process.exit(1)
}
if (!worker_threads || worker_threads.isMainThread) {
  process.on('unhandledRejection', onError)
  process.on('uncaughtException', onError)
}

// tty status
const stdoutIsTTY = !!process.stdout.isTTY
    , stderrIsTTY = !!process.stderr.isTTY
const screen = {
  width: 60,
  height: 20,
  clear() {},
}
if (stdoutIsTTY || stderrIsTTY) {
  const ws = (stdoutIsTTY && process.stdout) || process.stderr
  const updateScreenSize = () => {
    screen.width = ws.columns
    screen.height = ws.rows
  }
  ws.on('resize', updateScreenSize)
  updateScreenSize()
  screen.clear = () => { ws.write('\x1b[2J') }
  // Note: we can clear past rows relatively using these two functions:
  // ws.moveCursor(0, -4)
  // ws.clearScreenDown()
}

// terminal ANSI styling
const style = (() => {
  let ncolors = forceTTYColors
  if (!ncolors && (stdoutIsTTY || stderrIsTTY)) {
    const ws = (stdoutIsTTY && process.stdout) || process.stderr
    ncolors = (ws.hasColors() && ws.getColorDepth()) || 0
  }
  const sfn = (
    ncolors >= 8 ? (open16, open256, close) => {
      let a = '\x1b[' + open256 + 'm'
      let b = '\x1b[' + close + 'm'
      return s => a + s + b
    } :
    ncolors > 0 ? (open16, open256, close) => {
      let a = '\x1b[' + open16 + 'm'
      let b = '\x1b[' + close + 'm'
      return s => a + s + b
    } :
    () => s => s
  )
  return {
    ncolors,
    'reset'         : "\e[0m",
    // name               16c    256c                 close
    'bold'          : sfn('1',   '1',                 '22'),
    'italic'        : sfn('3',   '3',                 '23'),
    'underline'     : sfn('4',   '4',                 '24'),
    'inverse'       : sfn('7',   '7',                 '27'),
    'white'         : sfn('37',  '38;2;255;255;255',  '39'),
    'grey'          : sfn('90',  '38;5;244',          '39'),
    'black'         : sfn('30',  '38;5;16',           '39'),
    'blue'          : sfn('34',  '38;5;75',           '39'),
    'cyan'          : sfn('36',  '38;5;87',           '39'),
    'green'         : sfn('32',  '38;5;84',           '39'),
    'magenta'       : sfn('35',  '38;5;213',          '39'),
    'purple'        : sfn('35',  '38;5;141',          '39'),
    'pink'          : sfn('35',  '38;5;211',          '39'),
    'red'           : sfn('31',  '38;2;255;110;80',   '39'),
    'yellow'        : sfn('33',  '38;5;227',          '39'),
    'lightyellow'   : sfn('93',  '38;5;229',          '39'),
    'orange'        : sfn('33',  '38;5;215',          '39'),
  }
})()

// predefined diagnostics-logging prefixes
const diagInfoPrefix       = style.cyan("●") + " "
    , diagWarnPrefix       = style.orange("▲") + " "
    , diagErrPrefix        = style.red("✗") + " "
    , diagSuggestionPrefix = style.cyan("○") + " "
    , diagOkPrefix         = style.green("✓") + " "

// derived files
const mapfile = outfile + ".map"

// setup version info
const githashShort = getGitHashSync().substr(0, 10)
const VERSION = pkg.version
const VERSION_TAG = (
  githashShort ? (debug ? ("debug+" + githashShort) : githashShort) :
  ""
)
const VERSION_FULL = VERSION + (VERSION_TAG ? "-" + VERSION_TAG : "")

// constant definitions that may be inlined
const defines_inline = {
  DEBUG: debug,
  TARGET,
}

// constant defintions (will be available as `const name = value` at runtime)
const defines_all = Object.assign({
  VERSION,
  VERSION_FULL,
  VERSION_TAG,
}, defines_inline)

// typescript config
const tsPluginConfig = {
  // check: false, // don't lint -- faster
  verbosity: 1, // 0 Error, 1 Warning, 2 Info, 3 Debug
  tsconfig: tsconfigfile,
  tsconfigOverride: {
    compilerOptions: Object.assign({
      // for both debug and release builds
      noEmitOnError: true,
    }, debug ? {
      // only for debug builds
      pretty: true,
      preserveConstEnums: true,
    } : {
      // only for release builds
      pretty: false,
      removeComments: true,
    }),
  },
  cacheRoot: pjoin(cachedir, 'ts-' + (debug ? 'g' : 'o')),
  clean:     clean || !debug,
}

// input config
const rin = {
  input: mainEntry,
  external: externalLibs.slice(),
  plugins: [
    typescriptPlugin(tsPluginConfig),
  ],
  onwarn(m) {
    if (m.importer) {
      console.warn(`${diagWarnPrefix}${m.importer}: ${m.message}`)
    } else {
      console.warn(`${diagWarnPrefix}${m.message}`)
    }
  },
}

let versionBanner = `/* ${pkg.name} ${VERSION_FULL} */\n`
let execBanner = ""
if (productIsExectuable) {
  execBanner = (
    // --expose-gc is useful for BENCH
    debug ? '#!/usr/bin/env node --trace-warnings --expose-gc\n' :
            '#!/usr/bin/env node\n'
  )
}
const wrapperStart = '(function(global){\n'
const wrapperEnd = '\n})(typeof exports != "undefined" ? exports : this);\n'

// output config
const rout = {
  file: outfile,
  format: 'cjs',
  name: productName,
  sourcemap: true,
  sourcemapExcludeSources: true, // don't include source code in sourcemap
  sourcemapPathTransform: relativePath => {
    // ../src/foo/bar.ts -> /<co> src/foo/bar.ts
    // return "/<co> " + Path.relative('..', relativePath)
    return Path.relative('../src', relativePath)
  },
  freeze: debug, // Object.freeze(x) on import * as x from ...
  banner: execBanner + versionBanner + wrapperStart,
  footer: wrapperEnd,
  intro: '',
}

// add predefined constants to intro
rout.intro += 'const ' + Object.keys(defines_all).map(k =>
  k + ' = ' + JSON.stringify(defines_all[k])
).join(', ') + ';\n'

// add global code to intro
rout.intro += getGlobalJSSync()


// --------------------------
// main

function main() {
  if (noLint && noBuild) {
    console.error("nothing to do when both -nobuild and -nolint is specified")
    process.exit(0)
  }

  if (!noLint) {
    if (noBuild) {
      return startDiagnostics({ dedicated: true })
    }
    runProcess(startDiagnostics)
  }

  if (!noBuild) {
    if (watch) {
      buildIncrementally()
    } else {
      buildOnce()
    }
  }
}


function getNamedFunction(__function_name__obscured__) {
  // minimizes chance of resolving function name to a local
  try {
    return eval(__function_name__obscured__)
  } catch(_) {
    return null
  }
}


function runProcess(fun, ...args) {
  if (!worker_threads) {
    return fun(...args)
  }

  // make sure that eval(fun.name) === fun
  let fname = fun.name
  if (fname) {
    try {
      if (getNamedFunction(fname) !== fun) {
        fname = ""
      }
    } catch (_) {}
  }
  if (!fname) {
    throw new Error("process function is not a named module-level function")
  }
  const argv = process.argv
  if (style.ncolors) {
    argv.push("-color")
  }
  const workerData = {
    __argv: argv,
    __runProcess: { fname, args },
  }
  return startWorker(workerData, msg => {
    console.log("message from worker:", msg)
  })
}


function workerDispatch() {
  if (!isWorker) {
    throw new Error("workerDispatch called on main thread")
  }

  let wd = worker_threads.workerData
  if (!wd || typeof wd != "object") {
    throw new Error("unexpected workerData")
  }

  if (wd.__runProcess) {
    // worker was started via runProcess
    let fn = getNamedFunction(wd.__runProcess.fname)
    if (!fn || typeof fn != "function") {
      throw new Error("invalid worker function")
    }
    fn.apply(null, wd.__runProcess.args)
    return
  }

  throw new Error("unknown worker with workerData " + JSON.stringify(wd))
}


// interface CancellableProcess<T> extends Promise<T> {
//   cancel() :Promise<void>
// }

// interface CancellableWorker<T> extends CancellableProcess<T> {
//   worker   :Worker<T>
//   cancel() :Promise<void>
// }

function startWorker(workerData, onMessage) { // :CancellableWorker<T>
  let w = null
  let p = new Promise((resolve, reject) => {
    w = new worker_threads.Worker(__filename, { workerData })

    if (onMessage) {
      w.on('message', onMessage)
    }

    let ended = false

    w.on('error', err => {
      // console.error("worker died with error:", err)
      ended = true
      reject(err)
    })

    w.on('exit', code => {
      // console.log(`Worker ended with exit code ${code}`)
      if (!ended) {
        if (code == 0) {
          resolve()
        } else {
          reject(new Error("worker ended with code " + code))
        }
      }
    })
    // console.log(`started worker #${w.threadId}`)
  })
  p.worker = w

  let cancelled = false
  p.cancel = () => {
    if (!cancelled) {
      cancelled = true
      p.worker.terminate()
    }
    return p
  }

  return p
}


// ---------------------------------------------------------------------------


function startDiagnostics() {  // :CancellableProcess<void>
  let watchForChanges = watch
  let cancelled = null
  const p = new Promise(resolve => {

  const ts = require("typescript")

  const IGNORE     = -1
      , INFO       = ts.DiagnosticCategory.Message
      , WARN       = ts.DiagnosticCategory.Warning
      , ERR        = ts.DiagnosticCategory.Error
      , SUGGESTION = ts.DiagnosticCategory.Suggestion
      , OK         = IGNORE

  // rules maps TS diagnostics codes to severity levels.
  // The special value IGNORE can be used to completely silence a diagnostic.
  // For diagnostic codes not listed, the default DiagnosticCategory for a
  // certain diagnostic is used.
  const rules = {
    6031: IGNORE, // starting compilation
    6194: IGNORE, // Found N errors. Watching for file changes.
    6133: WARN,   // unused variable, parameter or import
  }

  const logPrefix = {
    [INFO]:       diagInfoPrefix,
    [WARN]:       diagWarnPrefix,
    [ERR]:        diagErrPrefix,
    [SUGGESTION]: diagSuggestionPrefix,
    [OK]:         diagOkPrefix,
  }

  const isDedicated = !isWorker && noBuild

  if (isDedicated) {
    console.log(`${diagInfoPrefix}running linter`)
  }

  const createProgram = ts.createSemanticDiagnosticsBuilderProgram

  // set or override relevant compiler options
  const compilerOptionsOverrides = { // CompilerOptions
    ...linterTSCompilerOptions,
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
  }

  // create host
  const host = ts.createWatchCompilerHost(
    tsconfigfile,
    compilerOptionsOverrides,
    ts.sys,
    createProgram,
    reportDiagnostic,
    reportWatchStatusChanged
  )

  const LN = ts.sys.newLine

  const formatHost = { // FormatDiagnosticsHost
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => LN,
    useCaseSensitiveFileNames: () => false,
  }

  // output buffer
  let reportBuf = [] // chunks
  let println = chunk => { reportBuf.push(chunk + "\n") }
  let flushReportBuf = () => {
    process.stderr.write(reportBuf.join(""))
    reportBuf = []
  }

  if (isDedicated) {
    // unbuffered
    println = chunk => process.stdout.write(chunk + "\n")
    flushReportBuf = () => {}
  }

  let tswatcher = null  // set and end to an active ts.Watch
  let diagScheduled = false
  let diagQueue = []

  function schedReportDiagnostics() {
    // call reportDiagnostics in the next runloop frame
    if (!diagScheduled) {
      diagScheduled = true
      process.nextTick(id => {
        diagScheduled = false
        reportDiagnostics()
      })
    }
  }

  let errors = []
    // populated by reportDiagnostics, cleared by finalizeReport

  let endTimer = null

  function endSoonUnlessThereIsMore() {
    clearTimeout(endTimer)
    endTimer = setTimeout(() => {
      if (!diagScheduled) {
        let errcount = errors.length // copy before it's cleared
        finalizeReport()
        if (cancelled || (tswatcher && !watchForChanges)) {
          tswatcher.close()
          resolve()
          if (isDedicated) {
            process.exit(errcount > 0 ? 1 : 0)
          }
        }
      } else {
        // retry again later
        endSoonUnlessThereIsMore()
      }
    }, 100)
  }

  let hasFinalizedReport = false

  function onRestart() {
    // called when we restart after files changed
    clearTimeout(endTimer)
    finalizeReport()
    hasFinalizedReport = false
    // if (isDedicated) {
    //   screen.clear()
    // }
  }

  function finalizeReport() {
    if (hasFinalizedReport) {
      return hasFinalizedReport
    }
    hasFinalizedReport = true

    if (errors.length > 0) {
      println(
        (errors.length > 10 ? "\n" : "") +
        style.red(`${errors.length} errors`)
      )
      for (let { d, msg } of errors) {
        printDiag(d, msg)
      }
    } else {
      println(style.green(`no errors`))
    }

    if (!isDedicated && !watchForChanges) {
      println(hline())
    }
    flushReportBuf()
    errors = []
  }


  const hlines = (new Array(200)).join("━")
  const spaces = (new Array(200)).join(" ")


  function hline(width /*optional*/) {
    return hlines.substr(0, width || (screen.width - 1))
  }


  function banner(message) {
    const hr = hline(screen.width - 3)
    const padding = spaces.substr(0, screen.width - message.length - 4)
    return (
      `┏${hr}┓\n` +
      `┃ ${message}${padding}┃\n` +
      `┗${hr}┛`
    )
  }


  function reportDiagnostics() {
    clearTimeout(endTimer)

    if (diagQueue.length > 0) {

      if (!isDedicated) {
        println(banner("Diagnostics report"))
      }

      // sort
      diagQueue = ts.sortAndDeduplicateDiagnostics(diagQueue)
      // diagQueue.sort((a, b) => {
      //   // sort errors at the bottom, so they appear close to the end of the report
      //   let aLevel = rules[a.code] !== undefined ? rules[a.code] : a.category
      //   let bLevel = rules[b.code] !== undefined ? rules[b.code] : b.category
      //   return (
      //     aLevel != ERR && bLevel == ERR ? -1 :
      //     aLevel == ERR && bLevel != ERR ? 1 :
      //     0
      //   )
      // })
      let diagPerFile = new Map() // filename => Diagnostic[]
      for (let d of diagQueue) {
        // simplify filename to be relative to src dir
        d.fileName = d.file ? relpath(dirname(srcdir), d.file.fileName) : ""

        let msg = ts.flattenDiagnosticMessageText(d.messageText, LN)

        let e = diagPerFile.get(d.fileName)
        if (e) {
          let msgcount = e.msgcount.get(msg)
          if (!msgcount) {
            e.dv.push({ d, msg })
            e.msgcount.set(msg, 1)
          } else {
            e.msgcount.set(msg, msgcount + 1)
          }
        } else {
          diagPerFile.set(d.fileName, {
            dv: [ { d, msg } ],
            msgcount: new Map([ [msg, 1] ]),
          })
        }
      }

      // let msg =
      //   ts.formatDiagnosticsWithColorAndContext(diagQueue, formatHost)
      // println(msg)

      // print
      for (let [file, e] of diagPerFile) {
        for (let { d, msg } of e.dv) {
          let level = rules[d.code] !== undefined ? rules[d.code] : d.category
          if (level == ERR) {
            errors.push({ d, msg })
          }
          printDiag(d, msg)
          let msgcount = e.msgcount.get(msg)
          if (msgcount > 1) {
            println(`  (${msgcount-1} more identical messages)`)
          }
        }
      }
    }

    // reset
    diagQueue = []
    endSoonUnlessThereIsMore()
  }


  function diagPrefix(d) {
    let level = rules[d.code] !== undefined ? rules[d.code] : d.category
    let prefix = logPrefix[level]
    if (!d.file) {
      return prefix
    }
    let file = d.fileName || d.file.fileName
    if (d.start === undefined) {
      return prefix + file
    }
    let {line, character} =
      ts.getLineAndCharacterOfPosition(d.file, d.start)
    if (level == ERR) {
      return prefix + style.red(`${file}:${line+1}:${character+1}`) + ": "
    } else {
      return `${prefix}${file}:${line+1}:${character+1}: `
    }
  }


  function printDiag(d, msg /*optional*/) {
    if (msg === undefined) {
      msg = ts.flattenDiagnosticMessageText(d.messageText, LN)
    }

    println(
      `${diagPrefix(d)}${style.white(msg)} ` + style.grey(`[TS${d.code}]`)
    )

    if (d.relatedInformation) {
      for (let d2 of d.relatedInformation) {

        d2.fileName = d2.file ? d2.file.fileName : ""
        if (d2.fileName.startsWith(srcdir)) {
          // /foo/bar/src/lol/cat.ts -> src/lol/cat.ts
          d2.fileName = relpath(dirname(srcdir), d2.fileName)
        }

        let msg2 = ts.flattenDiagnosticMessageText(d2.messageText, LN)
        let trailer = d2.code ? ` [TS${d2.code}]` : ""
        println(`  ${diagPrefix(d2)}${msg2}${trailer}`)
      }
    }
  }


  function isLibraryGlobalDefShadow(d) {
    // special case where a project-local definition shadows some external
    // libary's idea of global definitions.
    if (d.code != 2300 && d.code != 2451) {
      // 2300: "Duplicate identifier 'x'"
      // 2451: "Cannot redeclare block-scoped variable 'x'"
      return false
    }
    if (!d.relatedInformation) {
      return false
    }
    let ignore = true
    for (let d2 of d.relatedInformation) {
      if (d2.code != 6203 && d2.code != 6204) {
        // some other issue that is not "also declared here"
        return false
      }
      if (d2.file.fileName.startsWith(srcdir)) {
        // user source issue (not a library)
        return false
      }
    }
    // - d is TS2451 "Cannot redeclare block-scoped variable 'x'"
    // - all d's related info is either
    //   - TS6203: "'x' was also declared here", or
    //   - TS6204: "and here"
    return true
  }


  function reportDiagnostic(d /*Diagnostic*/) {
    if (rules[d.code] == IGNORE) {
      return
    }

    if (d.file) {
      let file = d.file.fileName
      if (!file.startsWith(srcdir) || isLibraryGlobalDefShadow(d)) {
        // ignore files outside of our source directory
        return
      }
    }

    if (d.code == 6133 && d.messageText.indexOf("'_'") != -1) {
      // TS6133 "'_' is declared but its value is never read"
      // We treat the "_" identifier as a placeholder for unused values as
      // older versions of TypeScript didn't support "holes" in positional
      // structured assignment. But now TS does, so let's add a top tip to
      // the diagnostic message to remind ourselves.
      d.relatedInformation = (d.relatedInformation || []).concat([{
        messageText: "Tip: Structured assignment supports holes, e.g. [,b]=x",
        category: SUGGESTION,
      }])
    }

    diagQueue.push(d)
    schedReportDiagnostics()
  }

  // Prints a diagnostic every time the watch status changes
  function reportWatchStatusChanged(d /*ts.Diagnostic*/) {
    if (d.code == 6032) {
      // File change detected. Starting incremental compilation
      if (isDedicated) {
        screen.clear()
        console.log(style.grey(
          `source change detected at ${new Date().toLocaleTimeString()}`
        ))
      }
      return // ignore
    }
    if (rules[d.code] == IGNORE) { return }
    printDiag(d)
  }

  const origAfterProgramCreate = host.afterProgramCreate
  host.afterProgramCreate = builderProgram => {
    origAfterProgramCreate(builderProgram)
    schedReportDiagnostics()
    // getPreEmitDiagnostics returns diagnostics found before code emission.
    // Note that our reportDiagnostic is called automatically for these
    // diagnostic messages already.
    // let dv = ts.getPreEmitDiagnostics(program)

    // TODO: rewrite this to print all diagnostics at the end instead of
    // trying to be clever and do it in chunks.
    // - Remove reportDiagnostic from createWatchCompilerHost args
    // - Remove all timing code for start/stop/begin/end
    // - Build on the code here below:
    //
    // const program = builderProgram.getProgram()
    // let allDiagnostics = []
    //   .concat(program.getOptionsDiagnostics())
    //   .concat(program.getGlobalDiagnostics())
    //   .concat(program.getConfigFileParsingDiagnostics())
    //   .concat(program.getSyntacticDiagnostics())
    //   .concat(program.getDeclarationDiagnostics())
    //   .concat(program.getSemanticDiagnostics())
    // for (let d of allDiagnostics) {
    //   reportDiagnostic(d)
    // }
  }

  let hasStartedOnce = false
  const origCreateProgram = host.createProgram
  host.createProgram = (rootNames, options, host, oldProgram) => {
    if (!hasStartedOnce) {
      hasStartedOnce = true
    } else {
      onRestart()
    }
    return origCreateProgram(rootNames, options, host, oldProgram)
  }

  // Idea: Create the builder to manage semantic diagnostics and cache them
  // createSemanticDiagnosticsBuilderProgram(newProgram: Program,
  //   host: BuilderProgramHost,
  //   oldProgram?: SemanticDiagnosticsBuilderProgram,
  //   configFileParsingDiagnostics?: ReadonlyArray<Diagnostic>
  // ): SemanticDiagnosticsBuilderProgram;
  // createSemanticDiagnosticsBuilderProgram(
  //   rootNames: ReadonlyArray<string> | undefined,
  //   options: CompilerOptions | undefined,
  //   host?: CompilerHost,
  //   oldProgram?: SemanticDiagnosticsBuilderProgram,
  //   configFileParsingDiagnostics?: ReadonlyArray<Diagnostic>,
  //   projectReferences?: ReadonlyArray<ProjectReference>
  // ): SemanticDiagnosticsBuilderProgram;

  tswatcher = ts.createWatchProgram(host)

  // TODO: convert this code to use createLanguageService instead, which offers
  // much better diagnostics. See:
  // https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
  // #incremental-build-support-using-the-language-services

  }) // promise `p` as CancellableProcess<void>

  p.cancel = () => {
    if (!cancelled) {
      cancelled = true
      watchForChanges = false
    }
    return p
  }

  return p
}

// exports.startDiagnostics = startDiagnostics


// ---------------------------------------------------------------------------
// build


function buildIncrementally() {
  let hasPatchedConfigAfterFirstRun = false
  const wopt = Object.assign({}, rin, {
    clearScreen: true,
    output: rout,
  })
  rollup.watch(wopt).on('event', ev => {
    switch (ev.code) {
      case 'START':        // the watcher is (re)starting
        break
      case 'BUNDLE_START': // building an individual bundle
      screen.clear()
        const outfiles = ev.output.map(fn => relpath(rootdir, fn)).join(', ')
        console.log(`build ${outfiles} (${VERSION_FULL}) ...`)
        break
      case 'BUNDLE_END':   // finished building a bundle
        onBuildCompleted(
          ev.duration,
          ev.output.map(fn => relpath(rootdir, fn))
        )
        break
      case 'END':          // finished building all bundles
        break
      case 'ERROR':        // encountered an error while bundling
        logBuildError(ev.error)
        break
      case 'FATAL': {       // encountered an unrecoverable error
        const err = ev.error
        if (err) {
          logBuildError(err)
          if (err.code == 'PLUGIN_ERROR' && err.plugin == 'rpt2') {
            // TODO: retry buildIncrementally() when source changes
          }
        } else {
          console.error('unknown error')
        }
        break
      }
      default:
        console.log('rollup event:', ev.code, ev)
    }
  })
}


function buildOnce() {
  let startTime = Date.now()
  console.log(`build ${relpath(rootdir, rout.file)} (${VERSION_FULL}) ...`)
  rollup.rollup(rin).then(bundle => {
    // console.log(`imports: (${bundle.imports.join(', ')})`)
    // console.log(`exports: (${bundle.exports.join(', ')})`)
    // bundle.modules is an array of module objects
    //
    bundle.generate(rout).then(res => {
      let { code, map } = res.output[0]
      patchSourceMap(map)
      let p
      if (debug) {
        code += '\n//# sourceMappingURL=' + Path.basename(mapfile)
        p = Promise.all([
          writefile(mapfile, map.toString(), 'utf8'),
          writefile(outfile, code, 'utf8'),
        ])
      } else {
        p = genOptimized(code, map)
      }

      return p.then(() => {
        onBuildCompleted(Date.now() - startTime, [relpath(rootdir, rout.file)])
      })
    })
  }).catch(err => {
    logBuildError(err)
    process.exit(1)
  })
}


// ---------------------------------------------------------------------------
// helpers


function logBuildError(err) {
  if (err.code == 'PLUGIN_ERROR') {
    // don't include stack trace
    let msg = err.message || ''+err
    if (err.plugin == 'rpt2') {
      // convert weird typescript origins `file(line,col):` to standard
      // `file:line:col:`
      msg = msg.replace(
        /(\n|^)(.+)\((\d+),(\d+)\)/g, '$1$2:$3:$4'
      )
    }
    console.log(msg)
  } else if (err.loc) {
    let l = err.loc
    console.error(`${l.file}:${l.line}:${l.column}: ${err.message}`)
    if (err.frame) {
      console.error(err.frame)
    }
  } else {
    console.error(err.stack || ''+err)
  }
}


function onBuildCompleted(duration, outfiles) {
  // patch sourcemap mapfile; add "sourceRoot":debugSourceMapRoot
  // note: in non-watch mode patchSourceMap takes care of this.
  if (watch) {
    let s = fs.readFileSync(mapfile, 'utf8')
    s = `{"sourceRoot":${JSON.stringify(debugSourceMapRoot)},` + s.substr(1)
    fs.writeFileSync(mapfile, s, 'utf8')
  }

  console.log(`built ${outfiles.join(', ')} in ${ Math.round((duration/100))/10 }s`)
  if (productIsExectuable) {
    fs.stat(rout.file, (err, st) => {
      if (err) { return }
      let mode = st.mode | 0o111  // u+x, g+x, o+x
      fs.chmodSync(rout.file, mode)
    })
  }
}


function patchSourceMap(m) {
  delete m.sourcesContent

  const srcDirRel = relpath(dirname(outfile), srcdir)
  const sourceRootRel = dirname(srcDirRel)

  m.sourceRoot = debug ? debugSourceMapRoot : srcDirRel

  m.file = Path.basename(outfile)

  m.sources = m.sources.map(path => {
    if (path.startsWith("/")) {
      return path.substr(1)
    }
    return path
  })
}


let ccbin

function getClosureCompilerBin() {
  if (!ccbin) {
    const ccutil = require('google-closure-compiler/lib/utils')
    // ClosureCompiler.CONTRIB_PATH
    ccbin = ccutil.getNativeImagePath()
    if (!ccbin) {
      ccbin = pjoin(__dirname, "node_modules", ".bin", "google-closure-compiler")
    }
  }
  return ccbin
}


async function genOptimized(code, map) { // :Promise<void>
  let tmpmapfile = pjoin(cachedir, Path.basename(mapfile))

  // must write sourcemap since closure-compiler must read it from disk
  await writefile(tmpmapfile, map.toString(), 'utf8')

  let filename = Path.relative(rootdir, outfile)
  let ccbin = getClosureCompilerBin()

  let nodeExternDir = pjoin(
    rootdir, "node_modules", "google-closure-compiler", "contrib", "nodejs"
  )

  // Note: ADVANCED is really complicated to use since we rely on nodejs
  // require()'d libraries.
  // "SIMPLE" optimizations still include constant eval, branch elim, etc
  // which is good enough.

  let args = [
    "-O=SIMPLE", //"ADVANCED",
    // "--js=" + filename,
    "--js_output_file=" + outfile,
    "--language_in=ECMASCRIPT_2018",
    "--language_out=ECMASCRIPT_2018",

    // "--env", "CUSTOM",
    // "--externs", "extern.js",
    // "--externs", pjoin(nodeExternDir, "globals.js"),

    "--module_resolution=NODE",
    // "--process_common_js_modules",
    "--package_json_entry_names=esnext:main,browser,main",

    "--assume_function_wrapper",
    // Enable additional optimizations based on the assumption that the output
    // will be wrapped with a function wrapper.  This flag is used to
    // indicate that "global" declarations will not actually be global but
    // instead isolated to the compilation unit. This enables additional
    // optimizations.

    "--create_source_map=" + tmpmapfile,
    "--source_map_input=stdin|" + tmpmapfile,
    `--source_map_location_mapping=${cachedir}|`,

    "--charset=UTF-8",
    "--output_wrapper=" + (
      execBanner +
      versionBanner +
      "\n%output%\n" +
      "//#sourceMappingURL=" + Path.basename(mapfile)
    ),
  ]

  // add nodejs externs
  // for (let f of fs.readdirSync(nodeExternDir, { encoding:"utf8", withFileTypes:true})) {
  //   if (f.isFile() && f.name.endsWith(".js")) {
  //     args.push("--externs", pjoin(nodeExternDir, f.name))
  //   }
  // }

  if (pretty) {
    args.splice(args.length, 0, "--formatting", "PRETTY_PRINT")
    // PRETTY_PRINT | PRINT_INP | UT_DELIMITER | SINGLE_QUOTES
  }

  console.log(`optimizing ${filename}...`)

  await closureCompiler(args, code)

  // patch source map
  let map2 = JSON.parse(await readfile(tmpmapfile, "utf8"))
  patchSourceMap(map2)
  // console.log(
  //   "data:application/json;base64," +
  //   Buffer.from(JSON.stringify(map2), "utf8").toString("base64")
  // )
  await writefile(mapfile, JSON.stringify(map2), 'utf8')
  fs.unlinkSync(tmpmapfile)
}


function closureCompiler(args, code) {
  return new Promise((resolve, reject) => {
    let p = subprocess.spawn(
      getClosureCompilerBin(),
      args,
      {
        cwd: rootdir,
        windowsHide: true,
        stdio: ['pipe', 'inherit', 'inherit'],  // pipe for stdin
      }
    )

    p.stdin.on("error", err => {
      if (err.errno != "EPIPE") {
        console.error("I/O on stdin: " + (err.stack || err))
      }
    })

    p.stdin.setDefaultEncoding("utf8")
    p.stdin.write(code, "utf8", () => {
      p.stdin.end()
    })

    p.on('exit', (code, signal) => {
      if (code == 0) {
        resolve()
      } else {
        reject(new Error("closure compiler error"))
      }
    })
  })
}


function fmtsize(z) {
  return (z / 1024).toFixed(1) + ' kB'
}


function getGlobalJSSync() {
  return fs.readFileSync(pjoin(srcdir, 'global.js'), 'utf8')
}


const _mkdir = promisify(fs.mkdir)
const _writefile = promisify(fs.writeFile)

function writefile(path, data, options) {
  return _writefile(path, data, options).catch(err => {
    if (err.code != 'ENOENT') { throw err }
    // directory not found -- create directories and retry
    let dir = dirname(path)
    return _mkdir(dir, {recursive:true}).then(() =>
      _writefile(path, data, options))
  })
}


var cachedGitHash

function getGitHashSync() {
  if (cachedGitHash === undefined) {
    cachedGitHash = ""
    if (fs.existsSync(pjoin(rootdir, '.git', 'refs', 'heads', 'master'))) {
      try {
        cachedGitHash = subprocess.execSync('git rev-parse HEAD', {
          cwd: rootdir,
          timeout: 2000,
        }).toString('utf8').trim()
      } catch (_) {}
    }
  }
  return cachedGitHash
}


// jsonparse parses "relaxed" JSON which can be in JavaScript format
//
function jsonparse(jsonText, filename /*optional*/) {
  return vm.runInNewContext(
    '(()=>(' + jsonText + '))()',
    { /* sandbox */ },
    { filename, displayErrors: true }
  )
}

function parseTSConfigFile(filename) {
  try {
    return jsonparse(fs.readFileSync(filename, "utf8"), filename)
  } catch(_) {}
  return {}
}


if (isWorker) {
  workerDispatch()
} else {
  main()
}
