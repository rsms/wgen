const GlobalContext = (
  typeof global != 'undefined' ? global :
  typeof window != 'undefined' ? window :
  this || {}
)

var __utillib = null;
try {
  if (typeof require != 'undefined') {
    __utillib = require("util");
    require("source-map-support").install();
  }
} catch(_) {}

function _stackTrace(cons) {
  const x = {stack:''}
  if (Error.captureStackTrace) {
    Error.captureStackTrace(x, cons)
    const p = x.stack.indexOf('\n')
    if (p != -1) {
      return x.stack.substr(p+1)
    }
  }
  return x.stack
}

// _parseStackFrame(sf :string) : StackFrameInfo | null
// interface StackFrameInfo {
//   func :string
//   file :string
//   line :int
//   col  :int
// }
//
function _parseStackFrame(sf) {
  let m = /\s*at\s+(?:[^\s]+\.|)([^\s\.]+)\s+(?:\[as ([^\]]+)\]\s+|)\((?:.+[\/ ](src\/[^\:]+)|([^\:]*))(?:\:(\d+)\:(\d+)|.*)\)/.exec(sf)
  // 1: name
  // 2: as-name | undefined
  // 3: src-filename
  // 4: filename
  // 5: line
  // 6: column
  //
  if (m) {
    return {
      func: m[2] || m[1],
      file: m[3] || m[4],
      line: m[5] ? parseInt(m[5]) : 0,
      col:  m[6] ? parseInt(m[6]) : 0,
    }
  } else {
    console.log("failed to parse stack frame", JSON.stringify(sf))
  }
  return null
}

function exit(status) {
  if (typeof process != 'undefined') {
    process.exit(status)
  }
  throw 'EXIT#' + status
}

function print() {
  console.log.apply(console, Array.prototype.slice.call(arguments))
}

const dlog = DEBUG ? function _dlog(){
  let e = new Error()
  let m = e.stack.split(/\n/, 3)[2].match(/(src\/[^\/]+:\d+:\d+)/)
  let loc = m ? `D ${m[1]}:` : "D:"
  console.log.apply(console, [loc, ...arguments])
} : function(){}


function panic(msg) {
  console.error.apply(console,
    ['panic:', msg].concat(Array.prototype.slice.call(arguments, 1))
  )
  console.error(_stackTrace(panic))
  exit(2)
}

function assert() {
  if (DEBUG) { // for DCE
    let cond = arguments[0]
      , msg = arguments[1]
      , cons = arguments[2] || assert
    if (cond) {
      return
    }
    let stack = _stackTrace(cons)
    let message = 'assertion failure: ' + (msg || cond)

    if (typeof process != 'undefined') {
      let sf = _parseStackFrame(stack.substr(0, stack.indexOf('\n') >>> 0))
      if (sf) try {
        let fs = require('fs')
        let lines = fs.readFileSync(sf.file, 'utf8').split(/\n/)
        let line_before = lines[sf.line - 2]
        let line        = lines[sf.line - 1]
        let line_after  = lines[sf.line]
        let context = [' > ' + line]
        if (typeof line_before == 'string') {
          context.unshift('   ' + line_before)
        }
        if (typeof line_after == 'string') {
          context.push('   ' + line_after)
        }
        stack = (
          sf.file + ':' + sf.line + ':' + sf.col + "\n" +
          context.join('\n') + '\n\nStack trace:\n' +
          stack
        )
      } catch (_) {}
    }

    if (!assert.throws && typeof process != 'undefined') {
      console.error(message + "\n" + stack)
      exit(3)
    } else {
      let e = new Error(message)
      e.name = 'AssertionError'
      e.stack = stack
      throw e
    }
  }
}

function assertThrows(f, errpat, msg, cons) {
  if (DEBUG) {
    try {
      f()
    } catch(e) {
      if (errpat) {
        let emsg = String(e.message || e)
        assert(
          (errpat instanceof RegExp ? errpat.test(emsg) : errpat == emsg),
          msg || (
            "Error did not match." +
            "\n  expect error to match: " + errpat +
            "\n  actual error message:  " + emsg
          ),
          cons || assertThrows
        )
      }
      return
    }
    assert(false, msg || "did not throw an error", cons || assertThrows)
  }
}

function assertEquals(a, b, msg, cons) {
  if (DEBUG) {
    assert(
      a === b,
      msg || `\n  ${repr(a)}\n  !=\n  ${repr(b)}`,
      cons || assertEquals
    )
  }
}


var repr = __utillib && __utillib.inspect ? function repr(obj, maxdepth) {
  if (maxdepth === undefined) {
    maxdepth = 3
  }
  return __utillib.inspect(obj, /*showHidden*/false, maxdepth)
} : function repr(obj, maxdepth) {
  // TODO: something better
  try {
    return JSON.stringify(obj, null, 2)
  } catch (_) {
    return String(obj)
  }
}

function TEST(){}
function BENCH(){}
if (DEBUG) {

function getsrcloc(stackoffs) {
  let e = new Error(), srcloc = '?', srcfile = ""
  if (e.stack) {
    let sf = e.stack.split(/\n/, stackoffs+1)[stackoffs]
    let m = /\s+(?:\(.+[\/\s](src\/.+)\)|at\s+.+[\/\s](src\/.+))$/.exec(sf)
    if (m) {
      srcloc = m[1] || m[2]
      let v = srcloc.split(/[\/\\]/)
      v.shift() // "src"
      if (v[v.length-1].match(/^index/)) {
        v.pop()
      }
      srcfile = v.join("/")
      let p = srcfile.indexOf(':')
      srcfile = p != -1 ? srcfile.substr(0, p) : srcfile
      if ((p = srcfile.indexOf('_test.ts')) != -1) {
        srcfile = p != -1 ? srcfile.substr(0, p) : srcfile
      } else if ((p = srcfile.indexOf('.ts')) != -1) {
        srcfile = p != -1 ? srcfile.substr(0, p) : srcfile
      }
    }
  }
  return { srcloc, srcfile }
}

// TEST
if (typeof process != 'undefined' && process.argv.includes('-debug-test')) {
  let allTests = []
  TEST = (name, f) => {
    if (f === undefined) {
      f = name
      name = f.name || '?'
    }
    let { srcloc, srcfile } = getsrcloc(3)
    if (srcfile) {
      name = srcfile + '/' + name
    }
    allTests.push({ f, name, srcloc })
  }
  let testPromise
  GlobalContext.runTests = function runTests() {
    if (testPromise) {
      return testPromise
    }
    return testPromise = new Promise(resolve => {
      let throws = assert.throws
      assert.throws = true
      let longestTestName = allTests.reduce((a, t) => Math.max(a, t.name.length), 0)
      let spaces = "                                                              "
      let promises = []
      let onerr = err => {
        assert.throws = throws
        if (!throws && typeof process != 'undefined') {
          console.error(err.message)
          if (err.stack) {
            if (err.stack.indexOf('AssertionError:') == 0) {
              err.stack = err.stack.split(/\n/).slice(1).join('\n')
            }
            console.error(err.stack)
          }
          exit(3)
        } else {
          throw err
        }
      }
      try {
        for (let i = 0; i < allTests.length; ++i) {
          let t = allTests[i];
          let name = t.name + spaces.substr(0, longestTestName - t.name.length)
          console.log(`[TEST] ${name}${t.srcloc ? '  '+t.srcloc : ''}`);
          let r = t.f();
          if (
            r instanceof Promise ||
            (r && typeof r == "object" && typeof r.then == "function")
          ) {
            r.catch(onerr)
            promises.push(r)
          }
        }
        assert.throws = throws
      } catch(err) {
        onerr(err)
      }

      if (promises.length > 0) {
        // await outstanding tests, showing a message if it takes a long time
        let timer = setTimeout(() => {
          console.log(`awaiting ${promises.length} async tests...`)
        }, 500)
        return Promise.all(promises).then(() => {
          clearTimeout(timer)
          resolve()
        })
      }

      resolve()
    }) // Promise
  }
} else {
  GlobalContext.runTests = () => Promise.resolve()
}

// BENCH
if (typeof process != 'undefined' && process.argv.some(v => v.startsWith('-debug-bench'))) {
  let benchmarks = new Map()
  BENCH = (name, f) => {
    let { srcloc, srcfile } = getsrcloc(3)
    if (srcfile) {
      name = srcfile + '/' + name
    }
    benchmarks.set(name, { f, name, srcloc })
  }
  let benchmarkPromise
  GlobalContext.runBenchmarks = function runBenchmarks() {
    if (benchmarkPromise) {
      return benchmarkPromise
    }
    return benchmarkPromise = (async () => {
      let bv = []
      if (process.argv.includes("-debug-bench")) {
        bv = Array.from(benchmarks.values())  // all
      } else {
        for (let arg of process.argv) {
          if (arg.startsWith('-debug-bench=')) {
            let name = arg.substr('-debug-bench='.length)
            let b = benchmarks.get(name)
            if (b) {
              bv.push(b)
            } else {
              let bvlenA = bv.length
              // try prefix, e.g. name=template matches template/*
              let prefix = name.replace(/\/+$/, "") + "/"
              for (let name of benchmarks.keys()) {
                if (name.startsWith(prefix)) {
                  bv.push(benchmarks.get(name))
                }
              }
              if (bvlenA == bv.length) {
                // no match
                let names = Array.from(benchmarks.keys()).join("\n  ")
                panic(`unknown benchmark "${name}". Available benchmarks:\n  ${names}`)
              }
            }
          }
        }
      }

      function fmtdur(ms) {
        return (
          ms < 0.001 ? `${(ms * 1000000).toFixed(0)}ns` :
          ms < 0.01  ? `${(ms * 1000).toFixed(2)}µs` :
          ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` :
                       `${ms.toFixed(2)}ms`
        )
      }

      const minTime = 200 // ms. Spend at least this much time gathering samples
      const maxTime = 10000 // ms. Spend no more than this much time gathering samples
      const minSamplesMin = 50   // minimum value of minSamples. Minimum sensible sample size.
      const minSamplesMax = 1000 // maximum value of minSamples
      let minSamples = 1000  // Samples between checking minTime. Based on 1ms call duration.
      const dogc = typeof gc != 'undefined' ? gc : function(){}

      async function bench(name, srclocDef, label, ncalls, f) {
        if (f === undefined) {
          if (ncalls === undefined) {
            // bench(f)
            f = label
            ncalls = 1
            label = ""
          } else if (typeof label == "string") {
            // bench(label, f)
            f = ncalls
            ncalls = 1
          } else {
            // bench(ncalls, f)
            f = ncalls
            ncalls = label
            label = ""
          }
        } // else: bench(label, ncalls, f)

        let srcloc = getsrcloc(3).srcloc || srclocDef

        label = `[BENCH] ${name}${label ? "/" + label : ""} `
        console.log(`${label}start at ${srcloc}`)

        let samples = 0
        let duration = 0
        let updateMinSamples = () => {
          // Adjust minSamples based on the time it took to call f the first time.
          // This helps to bring total time closer to minTime.
          let end = process.hrtime()
          let duration = ((end[0] - start[0]) * 1000) + ((end[1] - start[1]) / 1000000)
          minSamples = Math.ceil(minSamples / duration)
          minSamples = Math.min(minSamplesMax, Math.max(minSamplesMin, minSamples))
        }

        // test if f is async
        let start = process.hrtime()
        let p = f(0)
        if (p instanceof Promise) {
          // f is async
          await p
          updateMinSamples()

          let next = () => {
            let end = process.hrtime()
            duration += ((end[0] - start[0]) * 1000) + ((end[1] - start[1]) / 1000000)
            if (duration > maxTime) {
              console.log(`${label}taking longer than maxtime=${fmtdur(maxTime)} -- ending early.`)
            } else if (duration < minTime || samples < minSamples) {
              if (samples % minSamples == 0) {
                dogc()
              }
              start = process.hrtime()
              return f(samples++).then(next)
            }
          }
          dogc()
          start = process.hrtime()
          await f(samples++).then(next)
        } else {
          // f is sync
          updateMinSamples()
          while (1) {
            dogc()
            let start = process.hrtime()
            for (let n = 0; n < minSamples; n++) {
              f(samples++)
            }
            let end = process.hrtime()
            duration += ((end[0] - start[0]) * 1000) + ((end[1] - start[1]) / 1000000)
            if (duration >= minTime) {
              break
            } else if (duration > maxTime) {
              console.log(`${label}taking longer than maxtime=${fmtdur(maxTime)} -- ending early.`)
              break
            }
          }
        }

        let avg = duration / samples
        let msg = `${label}end: ${fmtdur(duration)} total, ${fmtdur(avg)} avg`
        if (ncalls > 1) {
          let navg = avg / ncalls
          msg += `, ${fmtdur(navg)} per op`
        }
        console.log(msg)
      }

      let longestName = bv.reduce((a, b) => Math.max(a, b.name.length), 0)
      let spaces = "                                                     "
      for (let { f, name, srcloc } of bv) {
        let p = f(bench.bind(null, name, srcloc))
        if (p instanceof Promise) {
          await p
        }
      }
    })()
  }
} else {
  GlobalContext.runBenchmarks = () => Promise.resolve()
}

}
