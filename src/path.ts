// TODO: to support good old windows...
// const iswin32 = typeof process != 'undefined' && process.platform == 'win32'
// and check for \ in paths.


const SL = 0x2F  // '/'
    , DOT = 0x2E // .'


// dir returns the directory part of a path, or "." if no directory part.
//
export function dir(path :string) :string {
  if (path.indexOf('/') == -1) {
    return '.'
  }
  path = clean(path)
  let p = path.lastIndexOf('/')
  return (
    p == -1 ? '.' :
    p == path.length - 1 ? path : // "/"
    path.substr(0, p)
  )
}

TEST("dir", () => {
  assert(dir("/a/b/c") == "/a/b")
  assert(dir("a/b/c") == "a/b")
  assert(dir("a/b") == "a")
  assert(dir("/") == "/")
  assert(dir("a") == ".")
  assert(dir("") == ".")
})


// base returns the last element of path.
// Trailing slashes are removed before extracting the last element.
// If the path is empty or consists entirely of slashes, base returns "".
//
export function base(path :string) :string {
  if (path == "") {
    return ""
  }
  // search to beginning of any trailing slashes
  let end = path.length
  while (path.charCodeAt(--end) == SL) {}
  end++
  if (end == 0) {
    return ""
  }
  // search to first slash on the left (or beinning of path if no slashes)
  let start = end - 1
  while (start) {
    if (path.charCodeAt(start) == SL) {
      start++
      break
    }
    start--
  }
  return path.substring(start, end)
}

TEST("base", () => {
  var t = (ins :string, expect :string) => {
    let res = base(ins)
    assert(res == expect,
           `${repr(ins)} => expected: ${repr(expect)}, actual: ${repr(res)}`, t)
  }
  t("//",        "")
  t("a/bob",     "bob")
  t("a/bob//",   "bob")
  t("a",         "a")
  t("/a/b/c",    "c")
  t("/a/b/c/",   "c")
  t("/a/b/c///", "c")
  t("",          "")
  t(".",         ".")
  t("/",         "")
  t("///",       "")
})


class lazybuf {
  // The code in this class has been ported from Go and the following
  // license applies:
  //   Copyright 2009 The Go Authors. All rights reserved.
  //   Use of this source code is governed by a BSD-style
  //   license that can be found in the LICENSE file.
  //   https://golang.org/LICENSE

  buf :string|null = null
  w   :int = 0

  constructor(
    public s :string,
  ) {}

  index(i :int) :int {
    return this.buf !== null ? this.buf.charCodeAt(i) : this.s.charCodeAt(i)
  }

  append(c :int) {
    if (this.buf === null) {
      if (this.w < this.s.length && this.s.charCodeAt(this.w) == c) {
        this.w++
        return
      }
      this.buf = this.s.substr(0, this.w)
    }
    if (this.w < this.buf.length-1) {
      // w was reverted
      this.buf = this.buf.substr(0, this.w)
    }
    this.buf += String.fromCharCode(c) // ugh, javascript...
    this.w++
  }

  toString() :string {
    return (
      this.buf === null ? this.s.substr(0,this.w) :
      this.buf.substr(0, this.w)
    )
  }
}


// clean
//
export function clean(path :string) :string {
  // The code in this function has been ported from Go and the following
  // license applies:
  //   Copyright 2009 The Go Authors. All rights reserved.
  //   Use of this source code is governed by a BSD-style
  //   license that can be found in the LICENSE file.
  //   https://golang.org/LICENSE

  if (path == "") {
    return "."
  }

  const rooted = path.charCodeAt(0) == SL
  const n = path.length

  // Invariants:
  //  reading from path; r is index of next byte to process.
  //  writing to buf; w is index of next byte to write.
  //  dotdot is index in buf where .. must stop, either because
  //    it is the leading slash or it is a leading ../../.. prefix.
  let out = new lazybuf(path)
  let r = 0, dotdot = 0

  if (rooted) {
    out.append(SL)
    r = 1
    dotdot = 1
  }

  while (r < n) {
    const c0 = path.charCodeAt(r)
    if (c0 == SL) {
      // empty path element
      r++
    } else if (c0 == DOT && (r+1 == n || path.charCodeAt(r+1) == SL)) {
      // . element
      r++
    } else if (
      c0 == DOT &&
      path.charCodeAt(r+1) == DOT &&
      (r+2 == n || path.charCodeAt(r+2) == SL)
    ) {
      // .. element: remove to last /
      r += 2
      if (out.w > dotdot) {
        // can backtrack
        out.w--
        while (out.w > dotdot && out.index(out.w) != SL) {
          out.w--
        }
      } else if (!rooted) {
        // cannot backtrack, but not rooted, so append .. element.
        if (out.w > 0) {
          out.append(SL)
        }
        out.append(DOT)
        out.append(DOT)
        dotdot = out.w
      }
    } else {
      // real path element.
      // add slash if needed
      if (rooted && out.w != 1 || !rooted && out.w != 0) {
        out.append(SL)
      }
      // copy element
      // for (; r < n && path.charCodeAt(r) != SL; r++) {
      //   out.append(path.charCodeAt(r))
      // }
      let c :int
      for (; r < n; r++) {
        c = path.charCodeAt(r)
        if (c == SL) {
          break
        }
        out.append(c)
      }
    }
  }

  // Turn empty string into "."
  if (out.w == 0) {
    return "."
  }

  return out.toString()
}

TEST("clean", () => {
  function t(input :string, expect :string) {
    const result = clean(input)
    assert(result == expect,
      `expected ${JSON.stringify(input)} => ${JSON.stringify(expect)}` +
      ` but instead got ${JSON.stringify(result)}`)
  }
  t("a/c",      "a/c")
  t("a/c/",     "a/c")
  t("./a/c/",   "a/c")
  t("/a/c",     "/a/c")
  t("a//c",     "a/c")
  t("a/c/.",    "a/c")
  t("a/c/b/..", "a/c")
  t("/../a/c",  "/a/c")
  t("/../a/b/../././/c", "/a/c")
  t("", ".")
  t("/", "/")
})


// isAbs returns true if the path is absolute
//
export function isAbs(path :string) :bool {
  return path.charCodeAt(0) == SL
}

TEST("isAbs", () => {
  assert(isAbs("/foo/bar") === true)
  assert(isAbs("foo/bar") === false)
})


// join glues paths together
//
export function join(...paths :string[]) :string {
  let s = ''
  for (let i = 0; i < paths.length; i++) {
    if (paths[i] != '') {
      return clean((i == 0 ? paths : paths.slice(i)).join('/'))
    }
  }
  return s
}

TEST("join", () => {
  function t(inputs :string[], expect :string) {
    const result = join.apply(null, inputs)
    assert(result == expect,
      `expected ${JSON.stringify(inputs)} => ${JSON.stringify(expect)}` +
      ` but instead got ${JSON.stringify(result)}`)
  }
  t(["a", "b", "c"], "a/b/c")
  t(["a", "b/c"], "a/b/c")
  t(["a/b/", "c"], "a/b/c")
  t(["a/b//", "//c"], "a/b/c")
  t(["/a/b//", "//c"], "/a/b/c")
  t(["/a/b//", "//c/"], "/a/b/c")
  t(["", ""], "")
  t(["a", ""], "a")
  t(["", "a"], "a")
})


// ext returns the file name extension used by path.
// The extension is the suffix beginning at the final dot in the final
// slash-separated element of path; it is empty if there is no dot or if path
// ends with a dot.
//
export function ext(path :string) :string {
  for (let e = path.length - 1, i = e; i > 0 && path.charCodeAt(i) != SL; i--) {
    if (path.charCodeAt(i) == DOT) {
      if (i == e) {
        // path ends in "."
        break
      }
      return path.substr(i)
    }
  }
  return ""
}

TEST("ext", () => {
  var t = (ins :string, expect :string) => {
    let res = ext(ins)
    assert(res == expect,
           `${repr(ins)} => expected: ${repr(expect)}, actual: ${repr(res)}`, t)
  }
  t("bob.cat",   ".cat")
  t("/a/b",      "")
  t("/a/b.c",    ".c")
  t("/a/b.c.d",  ".d")
  t("/a/b.c/",   "")
  t("a.",        "")
  t("a...",      "")
  t("//",        "")
  t(".",         "")
  t(".bob",      "")
})


const getcwd = typeof process != "undefined" ? process.cwd : () => "."


// resolve returns an absolute path
//
export function resolve(...paths :string[]) :string {
  let i = paths.length - 1
  while (i >= 0) {
    if (isAbs(paths[i])) {
      return clean(paths.slice(i).join("/"))
    }
    i--
  }
  return getcwd() + "/" + clean(paths.join("/"))
}

TEST("resolve", () => {
  var t = (ins :string[], expect :string) => {
    let res = resolve(...ins)
    assert(res == expect,
           `${repr(ins)} => expected: ${repr(expect)}, actual: ${repr(res)}`, t)
  }
  t(["/a/b", "/c/d"],   "/c/d")
  t(["/a/b", "c/d"],    "/a/b/c/d")
  t(["/x/y", "/a/b", "c/d"],    "/a/b/c/d")
  t(["/a/b", "./c/d"],  "/a/b/c/d")
  t(["//a///b/c/..", "./c/x/..//d"],  "/a/b/c/d")  // should get cleaned
  t(["a/b", "c/d"],    getcwd() + "/a/b/c/d")
})


// commondir returns the longest common root path of path1 and path2
// E.g. (/foo/bar/baz, /foo/bar/lolcat/hello) -> /foo/bar
//
export function commondir(path1 :string, path2 :string) :string {
  return path1.substr(0, commondirIndex(path1, path2))
}


// commondirIndex returns the character offset into path1 and path2 of their
// common directory, or 0 if they do not share a root.
//
function commondirIndex(path1 :string, path2 :string) :number {
  let z = 0, a = 0, b = 0, i = 0
  // invariant: i <= z
  if (path1 == path2) {
    return path1.length
  }
  while (1) {
    // find common prefix
    a = path1.charCodeAt(z)
    b = path2.charCodeAt(z)
    if (b == SL || a == SL) {
      i = z
    }
    if (isNaN(a) || a != b) {
      // either path1 or path2 ended, or they diverge at z
      break
    }
    z++
  }
  // when b is '/' i is the index, else z is the index; z=min(len(path1),len(path2))
  // dlog({path1,path2, b: String.fromCharCode(b), })
  // assert(b != SL || z == Math.min(path1.length, path2.length))
  return i
}

TEST("commondir", () => {
  let samples = [
    ["/foo/bar/baz", "/foo/bar/lol",   "/foo/bar"],
    ["/foo/bar",     "/foo/bar/lol",   "/foo/bar"],
    ["/foo/bar",     "/foo/bar",       "/foo/bar"],
    ["",             "/foo/bar",       ""],
    ["/",            "/foo",           ""],
    ["/foo/bar",     "",               ""],
    ["foo/bar",      "foo/ba",         "foo"],
    [".",            "./hello",        "."],
    ["/foo/bar/a",   "/foo/bar",       "/foo/bar"],
    [".",            "/a/b/c",         ""],
    ["/foo",         "/foo",           "/foo"],
    ["/foo/",        "/foo",           "/foo"],
    ["/foo///",      "/foo",           "/foo"],
  ]
  // add reversed samples as commondir is commutative
  samples = samples.concat(
    samples.filter(([a, b, _]) => a != b).map(([a, b, expect]) => [b, a, expect])
  )
  for (let [a, b, expect] of samples) {
    let res = commondir(a, b)
    assert(res == expect, `${repr([a, b])} => expected: ${repr(expect)}, actual: ${repr(res)}`)
  }
})


// rel returns the shortest relative path from -> to.
// `from` is assumed to be a directory.
// e.g. (/foo/bar/baz, /foo/lol) -> "../../lol"
//      (/foo,         /foo/bar) -> "bar"
//      (/foo/bar,     /foo/bar) -> ""
//
export function rel(from :string, to :string) :string {
  from = clean(from)
  to = clean(to)
  if (from == to) {
    return ""
  }
  if (from == "." && !isAbs(to)) {
    return to
  }

  let prefixlen = commondirIndex(from, to)
  let fromtail = from.substr(prefixlen + 1)
  let totail = to.substr(prefixlen + 1)

  if (totail.charCodeAt(0) == SL) {
    // to is within from. e.g. (/foo/bar, /foo/bar/baz) -> /baz
    totail = totail.substr(1)
  } else if (fromtail != "") {
    // to is outside from. e.g. (/foo/bar, /foo/baz) -> baz
    totail = "../" + totail
    for (let i = 0; i < fromtail.length; i++) {
      if (fromtail.charCodeAt(i) == SL) {
        totail = "../" + totail
      }
    }
  }

  return totail
}

TEST("rel", () => {
  var t = (ps :string, ts :string, expect :string) => {
    let res = rel(ps, ts)
    assert(res == expect,
           `${repr([ps, ts])} => expected: ${repr(expect)}, actual: ${repr(res)}`, t)
  }
  t("/a/b/c", "/a/x",         "../../x")
  t("/a/b/c", "/a/b/x/y",     "../x/y")
  t("/a/b/c", "/a/b/c/d/e",   "d/e")
  t("/a/b",   "/a/b/c",       "c")
  t("/a",     "/a/b",         "b")
  t("/a/b",   "/x/y/z",       "../../x/y/z")
  t("/a/b/c", "/a/b/c",       "")
  t("",       "/a/b/c",       "a/b/c")
  t(".",      "/a/b/c",       "a/b/c")  // note: "" == "." since clean() is applied
  t("/",      "/a/b/c",       "a/b/c")

  t("a/b",    "a/x/y" ,       "../x/y")
  t(".",      "a/b" ,         "a/b")
})


// function countchar(s :string, c :number) :number {
//   let count = 0
//   for (let i = 0; i < s.length; i++) {
//     if (s.charCodeAt(i) == c) {
//       count++
//     }
//   }
//   return count
// }


// function commonPrefixLen(names :string[], sepch :number) :number {
//   for (let pos = 0; ; pos++) {
//     for (let i = 0; i < names.length; i++) {
//       let c = names[i].charCodeAt(pos)
//       if (c && c == names[0].charCodeAt(pos)) {
//         continue
//       }
//       while (pos > 0 && names[0].charCodeAt(--pos) != sepch) {}
//       return pos
//     }
//   }
//   return 0
// }
