import * as fs from 'fs'
import { promisify } from 'util'
import * as Path from "./path"
import { parseVersion } from './util'

export const stat = promisify(fs.stat)
export const lstat = promisify(fs.lstat)
export const statSync = fs.statSync
export const mkdir = promisify(fs.mkdir)
export const symlink = promisify(fs.symlink)
export const readlink = promisify(fs.readlink)
export const unlink = promisify(fs.unlink)
export const realpathSync = fs.realpathSync.native
export const constants = fs.constants

const node_v10_12_0 = parseVersion("10.12.0")
const node_version  = parseVersion(process.version.substr(1))

export const mkdirs :(path :string)=>Promise<void> = (

  node_version >= node_v10_12_0 ? // node 10.12.0 adds "recursive" option
  (path :string) :Promise<void> => mkdir(path, {recursive:true}) :

  // legacy nodejs
  (path :string) :Promise<void> => {
    async function _mkdir(p :string) :Promise<void> {
      try {
        await mkdir(p)
      } catch (err) {
        if (err.code == 'ENOENT') {
          let p2 = Path.dir(p)
          if (p2 == p) { throw err }
          return await _mkdir(p2).then(() => _mkdir(p))
        } if (err.code == 'EEXIST') {
          try {
            if ((await stat(p)).isDirectory()) {
              return // okay, exists and is directory
            }
          } catch (_) {}
        }
        throw err
      }
    }
    return _mkdir(Path.resolve(path))
  }
)

export const readdir = promisify(fs.readdir)

export const readfile = promisify(fs.readFile)

export async function exists(path :fs.PathLike) :Promise<bool> {
  try {
    await stat(path)
    return true
  } catch(_) {}
  return false
}

export async function isFile(path :fs.PathLike) :Promise<bool> {
  try {
    let st = await stat(path)
    return st.isFile()
  } catch(_) {}
  return false
}

export async function isDir(path :fs.PathLike) :Promise<bool> {
  try {
    let st = await stat(path)
    return st.isDirectory()
  } catch(_) {}
  return false
}

function strpath(path :fs.PathLike) :string {
  return (
    typeof path == "string" ? path :
    path instanceof Buffer ? path.toString("utf8") :
    String(path)
  )
}

const _writefile = promisify(fs.writeFile)

export function writefile(
  path :fs.PathLike | number,
  data :any,
  options :fs.WriteFileOptions,
) :Promise<void> {
  return _writefile(path, data, options).catch(async (err) => {
    if (err.code != 'ENOENT' || typeof path == "number") {
      throw err
    }
    // directory not found -- create directories and retry
    await mkdirs(Path.dir(strpath(path)))
    return _writefile(path, data, options)
  })
}


const _copyfile = promisify(fs.copyFile)

export function copyfile(src :fs.PathLike, dst :fs.PathLike, flags?: number) :Promise<void> {
  return _copyfile(src, dst, flags).catch(async (err) => {
    if (err.code != 'ENOENT') {
      throw err
    }
    // directory not found -- create directories and retry
    await mkdirs(Path.dir(strpath(dst)))
    return _copyfile(src, dst, flags)
  })
}


// copysymlink copies a symlink verbatim
//
export async function copysymlink(src :string, dst :string) :Promise<string> {
  let target = await readlink(src)
  let retry = true
  while (1) {
    try {
      symlink(target, dst)
    } catch (err) {
      if (err.code == "EEXIST") {
        if (await readlink(dst) == target) {
          break  // already points to same target
        }
        if (retry) {
          await unlink(dst).catch(()=>{})
          retry = false
          continue
        }
      }
      throw err
    }
    break
  }
  return target
}
