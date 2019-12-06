import { Config } from "./config"
import * as fs from "./fs"
import * as Path from "./path"
import { bufexpand } from "./util"
import { FrontMatter, parseFrontMatter } from "./frontmatter"


// number of bytes to read up front when parsing header
// The ideal number is the size of the longest header (\n---\n...\n---\n).
// If the front matter of a page is longer than this, a slight time penalty
// is incurred from additional disk reads.
const HEADER_READ_SIZE = 512

// number of bytes to read in one go as we read the remainder of a file.
const REST_READ_SIZE = 4096


interface ReadState {
  fd        :number    // source file read FD. -1 when invalid
  buf       :Buffer
  fm        :FrontMatter|null
  fmEndOffs :number  // offset in buf where front matter ends, -1 if no front matter
}


export default class Page {
  // internal
  _s :ReadState

  parent   :Page|null = null
  children :Page[] = []

  constructor(
    public title :string,
    public sfile :string,  // source filename (absolute path)
    public sext  :string,  // source file extension, e.g. ".md"
    public ofile :string,  // output filename (relative path)
    public url   :string,  // inter-site URL, e.g /foo/bar.html
    public meta  :FrontMatter|null,  // null if there is no front matter
    _s :ReadState,
  ) {
    this._s  = _s
  }

  toString() :string {
    return `Page(${this.title})`
  }

  // NOTE: Any properties in Page objects are visible within templates.
  // For this reason, helper functions like readAll are not part of the prototype.

  // readAll reads the complete page source
  //
  static readAll(p :Page) :Buffer {
    let buf = p._s.buf
    let hasMore = buf.length >= HEADER_READ_SIZE && buf.length % HEADER_READ_SIZE == 0
    if (p._s.fmEndOffs != -1) {
      // trim way front matter
      buf = buf.subarray(p._s.fmEndOffs)
    }
    let fd = p._s.fd
    if (hasMore) {
      // read rest
      while (1) {
        let z = buf.length
        buf = bufexpand(buf, REST_READ_SIZE)  // grow buffer
        let bytesRead = freadSync(fd, buf, z, REST_READ_SIZE)
        if (bytesRead < REST_READ_SIZE) {
          buf = buf.subarray(0, z + bytesRead)
          break
        }
      }
    }
    fs.close(fd)
    delete p._s
    return buf
  }

  static async read(c :Config, file :string, sext :string) :Promise<Page> {
    // dlog(`Page.read ${file}`)
    let fd = fs.openSync(file, "r")
    try {
      let _s = await readHeader(c, fd, file)
      let fm = _s.fm ; _s.fm = null
      let file_noext = file.substr(0, file.length - sext.length)  // a/b.md -> a/b
      let name = Path.base(file_noext)  // a/b -> b

      // figure out ofile and url
      let url = c.baseUrl
      let ofile = ""
      if (name == "index") {
        ofile = Path.join(Path.dir(c.relpath(file_noext)), "index.html")
        url += c.relpath(Path.dir(file)) + "/"
      } else {
        ofile = c.relpath(file_noext) + ".html"
        url += name + ".html"
      }

      return new Page(
        (fm && fm.title) || titleFromFile(c, file, name),
        file,
        sext,
        ofile,
        url,
        fm,
        _s,
      )
    } catch (err) {
      fs.closeSync(fd)
      throw err
    }
  }
}


function titleFromFile(c :Config, file :string, name :string) :string {
  let title = name
  if (title == "index") {
    let parent = Path.dir(file)
    if (parent == c.srcdirAbs) {
      return "Home"
    } else {
      title = Path.base(parent)
    }
  }
  // "foo-bar.baz" -> "Foo bar baz"
  return title[0].toUpperCase() + title.substr(1).replace(/[_\-\.]+/g, " ")
}




// The most minimal structured page is 8 bytes:
//---\n
//---\n


function hasMoreToRead(s :ReadState) :bool {
  return s.buf.length >= HEADER_READ_SIZE && s.buf.length % HEADER_READ_SIZE == 0
}


function fread(fd :number, buf :Buffer, offs :int) :Promise<int> {
  // dlog(`fread len=${buf.length - offs} from fd=${fd} into buf[${offs}]`)
  return fs.read(fd, buf, offs, buf.length - offs, null).then(r => r.bytesRead)
}

function freadSync(fd :number, buf :Buffer, offs :int, len :int) :int {
  // dlog(`freadSync len=${buf.length - offs} from fd=${fd} into buf[${offs}]`)
  return fs.readSync(fd, buf, offs, len, null)
}


async function readHeader(c :Config, fd :number, file :string) :Promise<ReadState> {
  let buf = Buffer.allocUnsafe(HEADER_READ_SIZE)
  let len = await fread(fd, buf, 0)
  let nread = HEADER_READ_SIZE
  let fm :FrontMatter|null = null
  let fmend = -1

  if (len > 7) { // The most minimal magic page is 8 bytes
    let i = 0  // index in buf

    // find start of front matter
    let fmstart = 0
    while (i < len) {
      let c = buf[i++]
      if (c != 0x2D) { // -
        if (c == 0x0A) {
          // ---\n
          fmstart = i
        }
        break
      }
    }
    if (fmstart) {
      // find end of front matter
      let index = i
      while (1) {
        index--  // to include "\n"
        let count = 0
        while (index < len) {
          let c = buf[index]
          if (fmend != -1) {
            if (c == 0x0A && count >= 3) {
              // found end; <LF> c{n,} <LF>
              //                        ^
              index++
              break
            } else if (c == 0x2D) { // -
              count++
            } else {
              fmend = -1
            }
          } else if (c == 0x0A) {
            // probably start
            fmend = index
          }
          index++
        }

        // Note: In case the header is larger than HEADER_READ_SIZE we may get a false positive
        //       here, indicating there's no header end, but in fact it is beyond what we read.
        if (fmend == -1 && len == nread) {
          buf = bufexpand(buf, HEADER_READ_SIZE)
          len += freadSync(fd, buf, len, HEADER_READ_SIZE)
          nread += HEADER_READ_SIZE
          index = i  // reset index
        } else {
          break
        }
      }

      if (fmend != -1) {
        try {
          fm = parseFrontMatter(buf.subarray(fmstart, fmend).toString("utf8"))
          fmend = index  // end of the last "\n---\n" <
        } catch (err) {
          console.error(
            `${c.relpath(file)}: Failed to parse header: ${err.message||err}; ` +
            `Treating this page as a verbatim file.`
          )
        }
      } else if (len > HEADER_READ_SIZE) {
        // in this case we read until the end of the file but found no ending \n---\n
        c.log(
          `suspicious: %q seems to have front matter ("---" at the beginning)` +
          ` but no ending "\\n---\\n" was found. Treating this page as a verbatim file.`,
          ()=>c.relpath(file)
        )
      }
    }
  }
  return {
    fd,
    buf: buf.subarray(0, len),
    fm,
    fmEndOffs: fmend,
  }
}


// // findLFNchLF locates the index of: <LF> c{n,} <LF>
// function findLFNchLF(buf :ArrayLike<byte>, bufoffs :int, buflen :int, c :int, n :int) {
//   let index = -1
//   let i = bufoffs
//   let count = 0
//   while (i < buflen) {
//     let c = buf[i++]
//     if (index != -1) {
//       if (c == 0x0A && count >= n) {
//         // found end; <LF> c{n,} <LF>
//         //                        ^
//         return index
//       } else if (c == 0x2D) { // -
//         count++
//       } else {
//         index = -1
//       }
//     } else if (c == 0x0A) {
//       // probably start
//       index = i + 1
//     }
//   }
//   return -1
// }
