import { Config } from "./config"
import * as fs from "./fs"
import * as Path from "./path"
import Page from "./page"
import TemplateContext from "./template"
import * as md from "./md"


const NO_LAYOUT = "none"

// buffer constants, used as find targets
const ltqBuf = Buffer.from([0x3C, 0x3F]) // <?
const qgtBuf = Buffer.from([0x3F, 0x3E]) // ?>


interface SitePages extends Array<Page> {
}

export interface SiteMeta {
  title :string
  home  :Page|null
  pages :SitePages
}


export async function build(c :Config) {
  const srcdir = Path.resolve(c.srcdir)
  const outdir = Path.resolve(srcdir, c.outdir)
  // const templatedir = fs.realpathSync(Path.resolve(c.srcdir, c.templatedir))
  const templatedir = Path.resolve(c.srcdir, c.templatedir)

  const template = new TemplateContext({})
  const pages = new Map<string,Page>() // indexed by Page.sfile
  const site :SiteMeta = {
    title: "Site title",
    home: null,
    pages: []
  }

  function relpath(dir :string, file :string) :string {
    return file.substr(dir.length + 1)
  }

  // (srcdir/foo/bar.lol) => outdir/foo/bar.lol
  // (srcdir/foo/bar.lol, .md) => outdir/foo/bar.md
  function outFilename(sfile :string, ext? :string) :string {
    let name = (
      ext ? sfile.substring(srcdir.length + 1, sfile.length - Path.ext(sfile).length) + ext
          : sfile.substr(srcdir.length + 1)
    )
    return Path.join(outdir, name)
  }

  // function mtimeSync(file :string) :number {
  //   try {
  //     return fs.statSync(file).mtimeMs
  //   } catch (_) {}
  //   return 0
  // }


  async function readPage(sfile :string, ext :string) {
    try {
      let page = await Page.read(c, sfile, ext)
      pages.set(page.sfile, page)
      site.pages.push(page)
      // if (sfile.indexOf("hig/index.md") != -1) {
      //   dlog("read page", page)
      // }
    } catch (err) {
      console.error(
        `failed to build page ${c.relpath(sfile)}: ${err.message||err}; copying verbatim`
      )
      return copyFile(sfile)
    }
  }


  async function copyFile(sfile :string) {
    let ofile = outFilename(sfile)
    let [smtime, omtime] = await Promise.all([
      fs.stat(sfile).then(st => st.mtimeMs),
      fs.stat(ofile).then(st => st.mtimeMs).catch(() => {}),
    ])
    if (!omtime || omtime < smtime) {
      c.log(`Copy ${c.relpath(sfile)} -> ${relpath(outdir, ofile)}`)
      return fs.copyfile(sfile, ofile, fs.constants.COPYFILE_FICLONE)
    }
  }


  function processFile(sfile :string) :Promise<void> {
    let ext = Path.ext(sfile).toLowerCase()
    if (ext in c.pageExts) {
      return readPage(sfile, ext)
    }
    return copyFile(sfile)
  }


  async function copySymlink(sfile :string) :Promise<void> {
    // copy symlink itself, not its contents
    let ofile = outFilename(sfile)
    try {
      let target = await fs.copysymlink(sfile, ofile)
      c.log(`Link ${relpath(outdir, ofile)} -> ${target}`)
    } catch (err) {
      if (err.code == "ENOENT") {
        let target = await fs.readlink(sfile).catch(()=>{})
        console.error(`error: symlink ${relpath(outdir, ofile)}: target ${target} does not exist`)
      } else {
        throw err
      }
    }
  }


  interface FileInfo {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }


  const visitedDirs = new Set<string>([
    // starts with files that we never visit
    templatedir,
    outdir,
    srcdir,  // in case there's a symlink pointing to parent
  ])


  const excludePattern = /^\./
  const symlinks :string[] = []  // symlink queue; for verbatim copy

  async function scandir(dir :string) {
    const buildPromises :Promise<void>[] = []
    for (let f of await fs.readdir(dir, { encoding: "utf8", withFileTypes: true })) {
      if (excludePattern.test(f.name)) {
        continue
      }
      let filename = Path.join(dir, f.name)
      let e :FileInfo = f
      let maxloop = 10  // max unfold level for symlinks
      while (maxloop--) {
        if (e.isFile()) {
          buildPromises.push(processFile(filename))
        } else if (e.isDirectory()) {
          // filename = fs.realpathSync(filename)
          if (!visitedDirs.has(filename)) {
            visitedDirs.add(filename)
            buildPromises.push(scandir(filename))
          }
        } else if (e.isSymbolicLink()) {
          if (!c.verbatimSymlinks) {
            // copy contents of symlink
            // Note: statSync will error if the symlink is cyclic
            e = fs.statSync(filename)
            continue
          }
          symlinks.push(filename)
        }
        break
      }
    }
    return Promise.all(buildPromises) as any as Promise<void>
  }


  // wrapInLayout returns the results of evaluating a template defined by p.meta.layout,
  // with env.content set to content.
  //
  function wrapInLayout(p :Page, content :string, layout :string) :Promise<string> {
    return template.getFile(Path.join(templatedir, layout + ".html"))
          .then(t => t.eval({
            env: {
              ...p,
              site,
              content,
            }
          }))
  }


  function buildFinalize(p :Page, content :Buffer|string) :Promise<void> {
    let ofile = Path.join(outdir, p.ofile)
    c.log(`Write ${c.relpath(p.sfile)} -> ${relpath(outdir, ofile)}`)

    let layout = p.meta ? (p.meta.layout || c.defaultLayout) : NO_LAYOUT
    if (layout && layout != NO_LAYOUT) {
      if (typeof content != "string") {
        content = content.toString("utf8")
      }
      return wrapInLayout(p, content, layout).then(s => fs.writefile(ofile, s, "utf8"))
    }

    if (typeof content == "string") {
      return fs.writefile(ofile, content, "utf8")
    }
    return fs.writefile(ofile, content)
  }


  async function buildMarkdownPage(p :Page) {
    // read page source
    let buf = Page.readAll(p)

    // parse markdown and as render html
    const outbuf = Buffer.from(md.parse(buf, { asMemoryView: true }))

    return buildFinalize(p, outbuf)
  }


  async function buildXmlPage(p :Page) {
    let ofile = outFilename(p.sfile, ".html")

    // TODO: consider comparing mtime of page (and all its includes!) with existing ofile,
    // and skipping generation if up to date.

    // read page source
    let buf = Page.readAll(p)
    let content = ""

    // check file contents to see if it has at least one "<?"; skip template if not.
    if (buf.indexOf(ltqBuf) != -1 && buf.indexOf(qgtBuf) != -1) {
      let t = template.compile(buf.toString("utf8"), p.sfile)
      content = await t.eval({
        env: {
          ...p,
          site,
        }
      })
    }

    return buildFinalize(p, content || buf)
  }


  function buildPage(p :Page) :Promise<void> {
    let format = c.pageExts[p.sext]
    switch (format) {
      case "md":  return buildMarkdownPage(p)
      case "xml": return buildXmlPage(p)
      default:
        return Promise.reject(new Error(`Invalid page format ${repr(format)}`))
    }
  }


  function buildPages() :Promise<void> {
    c.log(`Building ${pages.size} pages`)
    dlog(`page tree:\n` + fmtPageTree(site.home || site.pages[0]!))

    //
    // TODO: if pages.size > SOME_LARGE_NUMBER then
    //         child_process.fork and build some in a second process.
    //
    //       In that case, make sure to structured-clone-copy the whole `site` object
    //       as page templates needs it.
    //
    let p :Promise<void>[] = []
    for (let page of pages.values()) {
      p.push(buildPage(page).then(() => {
        // clear read state to free up memory
        ;(page as any)._s = null
      }))
    }
    return Promise.all(p) as any as Promise<void>
  }


  function fmtPageTree(root :Page, indent :string = "• ") {
    function visitPage(p :Page, ind :string) {
      let s = `${p.title}`
      for (let c of p.children) {
        s += "\n" + ind + visitPage(c, ind + indent)
      }
      return s
    }
    return visitPage(root, indent)
  }


  function sortAndLinkPages() {
    // note: pages is a Map indexed on Page.sfile
    //       site.pages is an array of Page objects

    // Sort pages by url filename (templates can sort some other way if they like)
    site.pages.sort((a, b) =>
      a.url < b.url ? -1 :
      b.url < a.url ? 1 :
      0 )

    // Map ofile => Page
    let omap = new Map<string,Page>()
    for (let p of site.pages) {
      let existing = omap.get(p.ofile)
      if (existing) {
        c.warn(`Conflict: output file %q generated by both %q and %q`,
          p.ofile, existing.sfile, p.sfile)
      } else {
        omap.set(p.ofile, p)
      }
    }

    // Connect parents and children
    for (let p of site.pages) {
      if (p.ofile == "index.html") {
        site.home = p
      } else {
        let obase = Path.base(p.ofile)
        let odir = Path.dir(p.ofile)
        if (obase == "index.html") {
          odir = Path.dir(odir)
        }
        while (true) {
          let parentofile = Path.join(odir, "index.html")
          let parent = omap.get(parentofile)
          if (parent) {
            p.parent = parent
            parent.children.push(p)
            break
          }
          if (odir == ".") {
            break
          }
          odir = Path.dir(odir)
        }
      }
    }

    // if (DEBUG) for (let p of site.pages) {
    //   if (p !== site.home && !p.parent) { dlog(`page without parent:`, p.title) }
    // }
  }


  // Find and parse all pages (and copy verbatim files)
  await scandir(Path.resolve(srcdir))

  // Populate parent & children properties
  sortAndLinkPages()

  // Build all pages
  await buildPages()

  // symlinks must be created after we finished with all other files, since nodejs
  // insists on checking that their targets exist, which may not be the case if a
  // symlink points to a file that is supposed to be copied into outdir.
  if (symlinks.length > 0) {
    await Promise.all(symlinks.map(copySymlink))
  }
}
