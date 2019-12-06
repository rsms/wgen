// base64enc returns the Base64 encoding of a JS string
export const base64enc = (s :string) :string =>
  Buffer.from(s, "utf8").toString("base64")


// jsonparse parses "relaxed" JSON which can be in JavaScript format
export function jsonparse(jsonText :string) :any {
  return (0,eval)('0||' + jsonText)
}


// parseVersion takes a dot-separated version string with 1-4 version
// components and returns a 32-bit integer encoding the versions in a
// comparable format. E.g. "2.8.10.20" corresponds to 0x02080a14
//
export function parseVersion(s :string) :int {
  let v = s.split(".").map(Number)
  if (v.length > 4) {
    throw new Error(`too many version numbers in "${s}" (expected <=4)`)
  }
  while (v.length < 4) {
    v.unshift(0)
  }
  return v[0] << 24 | v[1] << 16 | v[2] << 8 | v[3]  // 8 bytes per component
}


// bufexpand creates a new buffer containing `bytes` with some additional space.
//
export function bufexpand(bytes :ArrayLike<byte>, addlSize :int) :Buffer {
  const size = bytes.length + addlSize
  const b = Buffer.allocUnsafe(size)
  b.set(bytes, 0)
  return b
}


// monotonic high-resolution time in milliseconds
//
export function monotime() :number {
  let v = process.hrtime()
  return (v[0] * 1000) + (v[1] / 1000000)
}


// fmtduration formats a millisecond length to human-readable text
//
export function fmtduration(ms :number) :string {
  return (
    ms < 0.001 ?    `${(ms * 1000000).toFixed(0)}ns` :
    ms < 0.01  ?    `${(ms * 1000).toFixed(2)}µs` :
    ms >= 1000*60 ? `${(ms / (1000*60)).toFixed(2)}min` :
    ms >= 1000    ? `${(ms / 1000).toFixed(2)}s` :
                    `${ms.toFixed(2)}ms`
  )
}


// function countchar(s :string, c :number) :number {
//   let count = 0
//   for (let i = 0; i < s.length; i++) {
//     if (s.charCodeAt(i) == c) {
//       count++
//     }
//   }
//   return count
// }
