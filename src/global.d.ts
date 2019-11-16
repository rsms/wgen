type int = number
type byte = number
type bool = boolean

// writable version of ArrayLike
interface WArrayLike<T> {
  length: number
  [n: number]: T
}

interface Constructor<T> {
  new(...args :any[]) :T
}

declare var AssertionError :ErrorConstructor
declare const DEBUG :bool
declare const VERSION :string      // e.g. "0.1.2"
declare const VERSION_TAG :string  // e.g. "debug+53be2cb6c3"
declare const VERSION_FULL :string // e.g. "0.1.2-debug+53be2cb6c3"
declare const TARGET :string  // "node" | "generic"
declare const GlobalContext :{[k:string]:any}

// panic prints a message to stderr, equivalent to console.log
//
declare function print(msg :any, ...v :any[]) :void

// dlog is same as print but stripped from DEBUG builds
//
declare function dlog(msg :any, ...v :any[]) :void

// panic prints a message to stderr, stack trace and exits the process
//
declare function panic(msg :any, ...v :any[]) :never

// assert checks the condition for truth, and if false, prints an optional
// message, stack trace and exits the process.
// assert is removed in release builds
//
// declare function assert(cond :any, msg? :string, cons? :Function) :void
declare interface AssertFun {
  (cond :any, msg? :string, cons? :Function) :void

  // throws can be set to true to cause assertions to be thrown as exceptions,
  // or set to false to cause the process to exit.
  // Only has an effect in Nodejs-like environments.
  // false by default.
  throws :bool
}
declare var assert :AssertFun

// repr resturns a detailed string representation of the input
//
declare function repr(obj :any, maxdepth? :int) :string

// TEST can be called at init time to add a unit test to be run at startup.
// Only active in debug builds (when DEBUG is true.)
//
declare function TEST(name :string, f :()=>any) :void
declare function TEST(f :()=>any) :void

// BENCH defines a benchmark function that can be run with -bench or -bench=name.
// f should return a function which will be called repeatedly to gather samples.
// Only active in debug builds (when DEBUG is true.)
//
declare function BENCH(name :string, f :(b:BenchmarkFun)=>void) :void
//
// The benchmark function receives the current sample iteration.
//
// Optionally a benchmark can define ncalls, which declares the number of calls
// the benchmark function does to some code being measured.
// If ncalls is larger than 1, it is used to divide the time spent in the benchmark
// function, making up the "time per invocation".
//
// Example:
//   function square(v) {
//     return v * v
//   }
//   BENCH("square", () => {
//     let sampleInput = [ 0, 2, 4, 8, 16 ]
//     return {
//       sample() {
//         sampleInput.forEach(square)
//       },
//       ncalls: sampleInput.length,  // divvy up sample function's time
//   })
//
interface BenchmarkFun {
  (label :string, ncalls :number, f :(iteration? :number)=>any) :any
  (ncalls :number, f :(iteration? :number)=>any) :any
  (label :string, f :(iteration? :number)=>any) :any
  (f :(iteration? :number)=>any) :any
}
// type Benchmark = BenchmarkFun | { sample :BenchmarkFun, ncalls? :number }

// needed for older typescript
// declare namespace WebAssembly {
//   interface Export {
//     kind: string
//     name: string
//   }
//   interface Import {
//     module: string
//     kind: string
//     name: string
//   }
//   class Module {
//     constructor (bufferSource: ArrayBuffer|Uint8Array)
//     static customSections(module: Module, sectionName: string): ArrayBuffer[]
//     static exports(module: Module): Export[]
//     static imports(module: Module): Import[]
//   }
//   class Instance {
//     readonly exports: { [name:string]: Function }
//     constructor (module: Module, importObject?: Object)
//   }
//   interface MemoryDescriptor {
//     initial :number
//       // The initial size of the WebAssembly Memory, in units of
//       // WebAssembly pages
//     maximum :number
//       // The maximum size the WebAssembly Memory is allowed to grow to,
//       // in units of WebAssembly pages.
//       // When present, the maximum parameter acts as a hint to the engine
//       // to reserve memory up front.  However, the engine may ignore or clamp
//       // this reservation request.  In general, most WebAssembly modules
//       // shouldn't need to set a maximum.
//   }
//   class Memory {
//     readonly buffer :ArrayBuffer
//     constructor(descriptor :MemoryDescriptor)

//     // grow increases the size of the memory instance by a specified number
//     // of WebAssembly pages.
//     grow(pages :number)
//   }
// }
