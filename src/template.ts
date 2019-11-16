import * as fs from "./fs"
import * as Path from "./path"

// properties passed to various template functions
export interface Props {
  env       :Record<string,any>
  filename? :string
  writer?   :Writer

  nostat? :bool
    // when true, template files are not stat'd but assumed to be up-to date when
    // they are found in the template cache.
}

// compiled template function
type TemplateFun = (...envvals:any[]) => Promise<void>

// writer function
type Writer = (v:any)=>void

// properties with writer, only used for type specification
type PropsWriter = Props & { writer :Writer }
// properties without writer, only used for type specification
type PropsBuffer = Exclude<Props, { writer? :never }>

// vm module, when targeting node
const vm = TARGET == "node" ? require("vm") : null

// JS eval function
const _eval = (TARGET == "node" ?
  (js :string, filename :string, env :any) :TemplateFun => {
    // nodejs provides rich syntax errors when using the vm module instead of eval
    return new vm.Script("0||" + js, {
      filename,
      lineOffset: -jsLineOffset,
      columnOffset: 0,
    }).runInContext(env, {
      displayErrors: true,
      // timeout: 1000,
    })
  } :
  (js :string, _filename :string, env :any) :TemplateFun => {
    // @ts-ignore
    return (0,eval)(`0||function(__env) { with(__env) { return ${js} } }`)(env)
  }
)

// number of extra source lines that compile() adds to the input source
const jsLineOffset = 1

const xmlencmap :{[k:string]:string} = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;'
}

function escapeXml(s :string) :string {
  return String(s).replace(/[&<>'"]/g, s => xmlencmap[s] || s);
}

// Template represents a pre-compiled template
//
export class Template {
  readonly ctx      :TemplateContext
  readonly f        :TemplateFun
  readonly filename :string
  readonly mtime    = 0  // file modification time, from stat. 0 when props.nostat is true.

  constructor(ctx :TemplateContext, f :TemplateFun, filename :string) {
    this.ctx = ctx
    this.f = f
    this.filename = filename
  }

  // eval executes the template with properties.
  // It returns either a buffer of the evaluation results or nothing when a
  // writer is used.
  //
  async eval(props :PropsWriter) :Promise<void>
  async eval(props? :PropsBuffer) :Promise<string>
  async eval(props? :Props) :Promise<string|void> {
    if (!props) {
      props = {env:{}}
    }

    // output buffer writer
    let outbuffer = ""
    let _print = props.writer || function _print(v :any) { outbuffer += v }
    function printv(v :any) {
      _print(escapeXml(v))
    }

    const include = async (pathv :any, env? :{[k:string]:any}) => {
      let path = Path.resolve(Path.dir(this.filename), String(pathv))
      // use this template's env as basis for env to other template
      env = env ? { ...props!.env, ...env } : props!.env
      return this.ctx.evalFile(path, { env, writer: _print })
    }

    let env = {
      print: _print,
      printv,
      include,

      ...props.env,
    }

    await this.f(env)

    return outbuffer
  }
}


export default class TemplateContext {

  // static compilation js environment, exposed to the template in compile()
  readonly env :{[k:string]:any}

  // template cache
  readonly cache = new Map<string,Template>()


  constructor(builtins? :{[k:string]:any}) {
    // environment available in all templates created with this context.
    // These must be immutable and pure, since they are used by multiple templates.
    this.env = {
      ...(builtins || {}),
      console,
      escape: escapeXml,
    }
    if (TARGET == "node") {
      // contextify
      this.env = vm.createContext(this.env, {
        name: "template",
        codeGeneration: {
          strings: false,  // disallow eval, Function, etc
          wasm: true,      // allow wasm
        },
      })
    }
  }


  compile(source :string, filename :string = "<string>") :Template {
    let js = parse(source)
    let f = _eval(js, filename, this.env)
    return new Template(this, f, filename)
  }


  async getFile(filename :string, props? :Props) :Promise<Template> {
    let t = this.cache.get(filename)
    let mtime = 0
    props = props || ({} as Props)
    if (!props.nostat) {
      try {
        mtime = (await fs.stat(filename)).mtimeMs
      } catch (_) {
        mtime = Infinity
      }
    }
    if (!t || t.mtime < mtime) {
      let source = await fs.readfile(filename, "utf8")
      t = this.compile(source, props.filename || filename)
      ;(t as any).mtime = mtime
      this.cache.set(filename, t)
    }
    return t
  }


  evalFile(filename :string, props :PropsWriter) :Promise<void>
  evalFile(filename :string, props :PropsBuffer) :Promise<string>
  evalFile(filename :string, props :Props) :Promise<string|void> {
    return this.getFile(filename).then(t => t.eval(props))
  }


  eval(source :string, props :PropsWriter) :Promise<void>
  eval(source :string, props :PropsBuffer) :Promise<string>
  eval(source :string, props :Props) :Promise<string|void> {
    return this.compile(source, props.filename).eval(props)
  }

} // class Template



function parse(source :string) :string {
  function wplain(s :string) :string {
    return s.replace(/`/g, "\\`").replace(/\$\{/g, "\\$\{")
  }

  const re = /(\s*)<\?-((?:(?!-\?>|\?>).)*)(-?)\?>(\s*)|<\?((?:(?!-\?>|\?>).)*)(-?)\?>(\s*)/sgm
  //        1        2                   3      4        5                   6      7
  const jsclose = ";"
  const plainopen = "print(`"
  const plainclose = "`)" + jsclose

  let out = ""  // output buffer
  let i = 0     // offset in source of last chunk's end
  let plainprefix = plainopen  // prefix for next plain-text chunk
  let m :{ [i:number]:string; index :number } | null  // regex match

  while ((m = re.exec(source)) !== null) {

    // if there was any plain text preceeding this match, append it to out
    let end = m.index
    if (end > i) {
      // print(`  before: ${repr(source.substring(i, end))}`)
      out += plainprefix + wplain(source.substring(i, end)) + plainclose
    }

    // advance i past the current match
    i = end + m[0].length

    // the JS will be in group 2 or 5
    let js = m[2] || m[5]

    if (js.charCodeAt(0) == 0x3D) { // =
      js = `printv(${js.substr(1)})`
    } else {
      // If the code is only whitespace, simply yield js as-is to maintain line count
      if (/^[\s\r\n]*$/.test(js)) {
        out += js + jsclose
        plainprefix = plainopen
        continue
      }
      // include -> await include
      js = js.replace(/([\r\n]\s*|^[\r\n\s]*)include\(/sg, "$1await include(")
    }

    // append js and set plainprefix
    if (m[2]) {
      out += m[1] + js + jsclose
      plainprefix = m[3] ? m[4] + plainopen  // <?- -?>
                         : plainopen + m[4]  // <?- ?>
    } else {
      out += js + jsclose
      plainprefix = m[6] ? m[7] + plainopen  // <? -?>
                         : plainopen + m[7]  // <? ?>
    }
  }

  if (i < source.length) {
    // print(`  final before: ${repr(source.substr(i))}`)
    out += plainprefix + wplain(source.substr(i)) + plainclose
  } else if (plainprefix.charCodeAt(plainprefix.length - 1) != 0x60) { // 0x60=`
    // the end of the template has some whitespace, e.g.
    //   "<? foo ?>  "
    //             ~~
    //
    out += plainprefix + plainclose
  }

  // wrap
  out = (
    `function (__env) { with(__env) {\n` +
    `return (async function __template(){"use strict";\n` +
    out + "\n})()}}"
  )

  // print("output:\n———————————————————————————\n" + out + "\n———————————————————————————\n")
  return out
}

// -----------------------------------------------------------------------------------------
// Rest of this file is benchmarks and tests
// Run benchmarks with -debug-bench=template


BENCH("parse", async (bench) => {
  let samples = [
    "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",
    "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day<?/*C*/?>  ",
    "hello<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",
  ]

  await bench(samples.length, () => {
    for (let source of samples) {
      GlobalContext.x = parse(source)
    }
  })

  let genSample = (size :number) => {
    let s = ""; while (1) { s += samples[1] + "\n"; if (s.length >= size) { break } }
    return s
  }

  let s10k = genSample(1024 * 10)
  await bench("10kB", () => parse(s10k) )

  let s100k = genSample(1024 * 100)
  await bench("100kB", () => parse(s100k) )

  let s1M = genSample(1024 * 1000)
  await bench("1MB", () => parse(s1M) )
})


BENCH("eval", async (bench) => {
  const tc = new TemplateContext({})
  const env = {}

  let templates = [
    "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",
    "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day<?/*C*/?>  ",
    "hello<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",
  ].map(source => tc.compile(source))

  await bench(templates.length, async () => {
    for (let t of templates) {
      GlobalContext.x = await t.eval({ filename: "test.html", env })
    }
  })

  let genTemplate = (size :number) => {
    let s = "" ; while (1) {
      s += "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day<?/*C*/?>\n"
      if (s.length >= size) { break }
    }
    return tc.compile(s)
  }

  let t10k = genTemplate(1024 * 10)
  await bench("10kB", () => t10k.eval({ filename: "test.html", env }) )

  await bench("10kB/null-writer", () =>
    t10k.eval({ filename: "test.html", env, writer(_:any){} }) )

  let t100k = genTemplate(1024 * 100)
  await bench("100kB", () => t100k.eval({ filename: "test.html", env }) )

  let t1M = genTemplate(1024 * 1000)
  await bench("1MB", () => t1M.eval({ filename: "test.html", env }) )
})


BENCH("compile+eval", async (bench) => {
  const tc = new TemplateContext({})
  const env = {}

  let samples = [
    "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",
    "<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day<?/*C*/?>  ",
    "hello<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",
  ]

  await bench(samples.length, async () => {
    for (let sample of samples) {
      GlobalContext.x = await tc.eval(sample, { filename: "test.html", env })
    }
  })

  let genSample = (size :number) => {
    let s = ""; while (1) { s += samples[1] + "\n"; if (s.length >= size) { break } }
    return s
  }

  let sample10k = genSample(1024 * 10)
  await bench("10kB", () => tc.eval(sample10k, { filename: "test.html", env }) )

  let sample100k = genSample(1024 * 100)
  await bench("100kB", () => tc.eval(sample100k, { filename: "test.html", env }) )

  let sample1M = genSample(1024 * 1000)
  await bench("1MB", () => tc.eval(sample1M, { filename: "test.html", env }) )
})


TEST("template", async () => {
  let tc = new TemplateContext({
    builtin1(v:any) :any {
      return `[value from builtin1: ${v}]`
    },
  })

  async function t(source :string, expected :string, env :{[k:string]:any}={}) {
    try {
      let actual = await tc.eval(source, { filename: "test.html", env })
      assert(actual==expected, `\n  expected: ${repr(expected)}\n  actual:   ${repr(actual)}`,t)
    } catch (err) {
      let s = source.replace(/\n/g,'\\n\n').replace(/\t/g,'\\t')
      assert(0, `failed to compile: \n  ${s}\n${err.stack}`, t)
    }
  }

  return Promise.all([

  // parse(): escaping of plain content
  t("`",                 "`"),
  t("<?1?>`",            "`"),
  t("`<?1?>",            "`"),
  t("<?1?>`<?1?>",       "`"),
  t("${meow}",           "${meow}"),
  t("<?1?>${meow}",      "${meow}"),
  t("${meow}<?1?>",      "${meow}"),
  t("<?1?>${meow}<?1?>", "${meow}"),

  // parse() mix
  t("<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",            "`world`2day"),
  t("<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day<?/*C*/?>  ", "`world`2day  "),
  t("hello<?/*1*/?>`world`\n <?-/*B*/?><?=2?>day",       "hello`world`2day"),

  // eval
  t(`5 * 2 = <?= 5 * 2 ?>`,         `5 * 2 = 10`),
  t(`5 * 2 = \n\n <?= 5 * 2 ?>\n!`, `5 * 2 = \n\n 10\n!`),

  t(`{<? print(builtin1(["hello", "world"])) ?>}`,
    `{[value from builtin1: hello,world]}`),

  // block comment before include (transform await)
  // [
  //   `<?` +
  //   `\n/*` +
  //   `\ninclude` +
  //   `\nsome stuff */` +
  //   `\ninclude("test.html", { message: "Meow" }) ?>`,

  //   ``
  // ]

  ])
})
