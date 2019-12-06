import { jsonparse } from "./util"

const jsStartChars = {
  0x22: 1, // '
  0x27: 1, // "
  0x5b: 1, // [
  0x7b: 1, // {
}

export interface FrontMatter {
  [k:string] :any
}

export function parseFrontMatter(source :string) :FrontMatter {
  let fm :FrontMatter = {}
  let re = /(?:^|\n)([a-zA-Z0-9_\.\-\$]+):/g
  let valstart = -1, valend = -1
  let key = ""
  while (1) {
    let m = re.exec(source)
    if (valstart != -1) {
      // flush key-value
      let value :any = source.substring(valstart, m ? m.index : undefined).trim()
      if (value.charCodeAt(0) in jsStartChars) {
        try {
          value = jsonparse(value)
        } catch (e) {
          e = new Error(`Invalid front matter value for key ${key}: ${e.message||e}`)
          e.name = "SyntaxError"
          throw e
        }
      } else {
        try {
          let n = Number(value)
          if (!isNaN(n)) {
            value = n
          }
        } catch (_) {}
      }
      fm[key] = value
    }
    if (!m) {
      break
    }
    valstart = m[0].length + m.index
    key = m[1]
  }
  return fm
}
