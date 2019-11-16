// base64enc returns the Base64 encoding of a JS string
export const base64enc = (s :string) :string =>
  Buffer.from(s, "utf8").toString("base64")


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


// function countchar(s :string, c :number) :number {
//   let count = 0
//   for (let i = 0; i < s.length; i++) {
//     if (s.charCodeAt(i) == c) {
//       count++
//     }
//   }
//   return count
// }
