type Formatter = (v :any, n? :number) => any

const formatters = {
  s:   String,
  j:   JSON.stringify,
  j_:  (v:any, n: number) => JSON.stringify(v, null, n),
  r:   repr,
  r_:  repr,
  q:   (v:any) => JSON.stringify(String(v)),
  n:   Number as any as Formatter,
  f:   Number,
  f_:  (v:any, n: number) => Number(v).toFixed(n),
  i:   Math.round,
  d:   Math.round,
  x:   (v:any) => Math.round(v).toString(16),
  X:   (v:any) => Math.round(v).toString(16).toUpperCase(),
} as any as {[k:string]:Formatter}


// fmt formats a string
//
// Format specifiers:
//
//  %s       String(value)
//  %r       repr(value)
//  %Nr      repr(value, maxdepth=N)
//  %j       JSON.stringify(value)
//  %jN      JSON.stringify(value, null, N)
//  %q       JSON.stringify(String(value))
//  %n, %f   Number(value)
//  %fN      Number(value).toFixed(N)
//  %i, %d   Math.round(value)
//  %x       Math.round(value).toString(16)
//  %X       Math.round(value).toString(16).toUpperCase()
//  %%       "%"
//
// A value that is a function is called and its return value is used.
//
export function fmt(format :string, ...args :any[]) :string {
  let index = 0
  let s = format.replace(/%(?:([sjrqnfidxX%])|(\d+)([jrf]))/g, (s, ...m) => {
    let spec = m[0]
    if (spec == "%") {
      return "%"
    } else if (!spec) {
      // with leading number
      spec = m[2]
    }
    if (index == args.length) {
      throw new Error(`superfluous parameter %${spec} at offset ${m[3]}`)
    }
    let v = args[index++]
    if (typeof v == "function") {
      v = v()
    }
    return m[0] ? formatters[spec](v) : formatters[spec + "_"](v, parseInt(m[1]))
  })
  if (index < args.length) {
    // throw new Error(`superfluous arguments`)
    s += `(fmt:extra ${args.slice(index).map(v => `${typeof v}=${v}`).join(", ")})`
  }
  return s
}


TEST("fmt", () => {
  function t(format :string, args :any[], expected :string) {
    assertEquals(fmt(format, ...args), expected, undefined, t)
  }

  // s
  t("hello %s world", ["world"], "hello world world")
  t("hello %s", ["world"],       "hello world")
  t("%s world", ["hello"],       "hello world")

  // j
  t("hello %j world", ["wo\"rld"],
    'hello "wo\\"rld" world')
  t("hello %j world", [ {foo:1,bar:["a",2]} ],
    'hello {"foo":1,"bar":["a",2]} world')

  // Nj
  t("hello %2j world", [ {foo:1,bar:["a",2]} ],
    'hello {\n  "foo": 1,\n  "bar": [\n    "a",\n    2\n  ]\n} world')

  if (typeof process != "undefined") {
    // these test samples are specific to the repr() implementation when running in NodeJS
    // r
    t("hello %r world", ["wo\"rld"],  "hello 'wo\"rld' world")
    t("hello %r world", [{a:1}],  "hello { a: 1 } world")

    // Nr
    let obj = { a1: 1, a2: { b1: 2, b2: { c1: 3, c2: { d1: 4, d2: { x:"z" } } } } }
    t("hello %r world", [obj],
      'hello {\n' +
      '  a1: 1,\n' +
      '  a2: { b1: 2, b2: { c1: 3, c2: { d1: 4, d2: [Object] } } }\n' +
      '} world'
    )
    t("%0r", [obj], "{ a1: 1, a2: [Object] }")
    t("%1r", [obj], "{ a1: 1, a2: { b1: 2, b2: [Object] } }")
    t("%2r", [obj], "{ a1: 1, a2: { b1: 2, b2: { c1: 3, c2: [Object] } } }")
  }

  // q
  t("hello %q world", ["wo\"rld"],  'hello "wo\\"rld" world')
  t("hello %q world", [9],          'hello "9" world')
  t("hello %q world", [["a", "b"]], 'hello "a,b" world')
  t("hello %q world", [[]],         'hello "" world')

  // i, d
  t("hello %i world", [4.1], "hello 4 world")
  t("hello %d world", [4.1], "hello 4 world")

  // n
  t("hello %n world", [4.1], "hello 4.1 world")
  t("hello %n world", [4],   "hello 4 world")

  // f
  t("hello %f world", [4.1],  "hello 4.1 world")
  t("hello %f world", [4],    "hello 4 world")

  // Nf
  t("hello %4f world", [4.1], "hello 4.1000 world")
  t("hello %0f world", [4.1], "hello 4 world")

  // %
  t("hello %%s world", [], "hello %s world")

  // mixed
  t("a %s b %j c %f d %i%% e %r", ["s", [1,2], 3.1, 95, {a:1}],
    "a s b [1,2] c 3.1 d 95% e { a: 1 }")

  // function expansion
  t("hello %s world", [ () => "you" ], "hello you world")
  t("hello %r world", [ () => function a(){} ], "hello [Function: a] world")

  // extra arguments
  t("hello %s world", ["hello", 4, "foo"],
    "hello hello world(fmt:extra number=4, string=foo)")

  // too few arguments
  assertThrows(() => fmt("a %s b %s", 1), "superfluous parameter %s at offset 7")
  assertThrows(() => fmt("a %s b"),       "superfluous parameter %s at offset 2")
})
