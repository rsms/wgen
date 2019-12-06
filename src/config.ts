import * as Path from "./path"
import { fmt } from "./fmt"
import { stdoutStyle, stderrStyle } from "./termstyle"

export class Config {
  srcdir        = "."
  outdir        = "_build"
  templatedir   = "_templates"
  name          = "."  // name used in log messages. Usually == srcdir
  defaultLayout = "default"
  baseUrl       = "/"

  _quiet = false
  debug = false
  verbatimSymlinks = true

  pageExts :{[k:string]:string} = { // must all be lower case
    ".md":       "md",
    ".mdown":    "md",
    ".markdown": "md",
    ".html":     "xml",
    ".htm":      "xml",
    ".xml":      "xml",
  }

  log(format :string, ...args :any[]) {
    if (!this.quiet) {
      console.log(stdoutStyle.white(fmt(format, ...args)))
    }
  }

  warn(format :string, ...args :any[]) {
    console.error(stderrStyle.orange(fmt(format, ...args)))
  }

  error(format :string, ...args :any[]) {
    console.error(stderrStyle.red(fmt(format, ...args)))
  }

  get quiet() { return this._quiet }
  set quiet(v) {
    if (this._quiet = v) {
      this.log = function(){}
    } else {
      delete this.log
    }
  }

  // absolute srcdir
  get srcdirAbs() :string {
    let s = Path.resolve(this.srcdir)
    Object.defineProperty(this, "srcdirAbs", { value: s })
    return s
  }

  relpath(path :string) :string {
    return Path.rel(this.srcdirAbs, path)
  }
}
