import { Config } from "./config"
import * as fs from "./fs"
import * as Path from "./path"
import TemplateContext from "./template"


export async function build(c :Config) {
  const srcdir = Path.resolve(c.srcdir)
  const outdir = Path.resolve(srcdir, c.outdir)
  const templatedir = fs.realpathSync(Path.resolve(c.srcdir, c.templatedir))

  const tctx = new TemplateContext({})

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

  async function buildMarkdownPage(sfile :string) {
    dlog("TODO: buildMarkdownPage", sfile)
    return copyFile(sfile)  // XXX FIXME
  }

  async function buildXmlPage(sfile :string) {
    let ofile = outFilename(sfile, ".html")
    // let omtime = mtimeSync(ofile)
    let t = await tctx.getFile(sfile)
    let content = await t.eval({
      env: {
        title: "Hello",
        message: "O hai",
      }
    })
    print(`template ${relpath(srcdir, sfile)} -> ${relpath(outdir, ofile)}`)
    return fs.writefile(ofile, content, "utf8")
  }

  async function copyFile(sfile :string) {
    let ofile = outFilename(sfile)
    let [smtime, omtime] = await Promise.all([
      fs.stat(sfile).then(st => st.mtimeMs),
      fs.stat(ofile).then(st => st.mtimeMs).catch(() => {}),
    ])
    if (!omtime || omtime < smtime) {
      print(`copy ${relpath(srcdir, sfile)} -> ${relpath(outdir, ofile)}`)
      return fs.copyfile(sfile, ofile, fs.constants.COPYFILE_FICLONE)
    }
  }


  function processFile(sfile :string) :Promise<void> {
    let ext = Path.ext(sfile).toLowerCase()
    switch (ext) {

    case ".md":
    case ".mdown":
    case ".markdown":
      return buildMarkdownPage(sfile)

    case ".html":
    case ".htm":
    case ".xml":
      return buildXmlPage(sfile)

    default:
      return copyFile(sfile)
    }
  }


  async function copySymlink(sfile :string) :Promise<void> {
    // copy symlink itself, not its contents
    let ofile = outFilename(sfile)
    try {
      let target = await fs.copysymlink(sfile, ofile)
      print(`symlink ${relpath(outdir, ofile)} -> ${target}`)
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

  // TODO: collect information about all pages.
  //
  // Create a promise for "site-wide information" like page titles etc.
  //
  // When building a page
  // 1. Extract information about the page and add it to the database.
  // 2. Async, build/generate the page.
  //    - If it requires site-wide information, wait on that promise.
  //


  await scandir(Path.resolve(srcdir))

  // symlinks must be created after we finished with all other files, since nodejs
  // insists on checking that their targets exist, which may not be the case if a
  // symlink points to a file that is supposed to be copied into outdir.
  if (symlinks.length > 0) {
    await Promise.all(symlinks.map(copySymlink))
  }

  // let filename = Path.join(srcdir, "_templates", "default.html")
  // let props = {
  //   // nostat: true,
  //   env: {
  //     title: "Figma HIG",
  //     content: "<b>hello</b> world",
  //     pages: [
  //       { url: "/sample-page/", title: "Samples" },
  //       { url: "/icons/", title: "Iconography" },
  //       { url: "/buttons/", title: "Buttons" },
  //     ],
  //   }
  // }
  // let output = await tctx.evalFile(filename, props)
  // console.log(
  //   "-----------------------------------\n" +
  //   output +
  //   "\n-----------------------------------"
  // )

  // let n = 10
  // while (n--) {
  //   let output = await t.evalFile(filename, props)
  //   console.log(
  //     "-----------------------------------\n" +
  //     output +
  //     "\n-----------------------------------"
  //   )
  //   await new Promise(r => setTimeout(r, 1000))
  // }
}
