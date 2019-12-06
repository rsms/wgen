export enum ParseFlags {
  COLLAPSE_WHITESPACE         = 0x0001, // In TEXT, collapse non-trivial whitespace into single ' '
  PERMISSIVE_ATX_HEADERS      = 0x0002, // Do not require space in ATX headers ( ###header )
  PERMISSIVE_URL_AUTO_LINKS   = 0x0004, // Recognize URLs as links even without '<', '>'
  PERMISSIVE_EMAIL_AUTO_LINKS = 0x0008, // Recognize e-mails as links even without '<', '>'
  NO_INDENTED_CODE_BLOCKS     = 0x0010, // Disable indented code blocks. (Only fenced code works.)
  NO_HTML_BLOCKS              = 0x0020, // Disable raw HTML blocks.
  NO_HTML_SPANS               = 0x0040, // Disable raw HTML (inline).
  TABLES                      = 0x0100, // Enable tables extension.
  STRIKETHROUGH               = 0x0200, // Enable strikethrough extension.
  PERMISSIVE_WWW_AUTOLINKS    = 0x0400, // Enable WWW autolinks (without proto; just 'www.')
  TASK_LISTS                  = 0x0800, // Enable task list extension.
  LATEX_MATH_SPANS            = 0x1000, // Enable $ and $$ containing LaTeX equations.
  WIKI_LINKS                  = 0x2000, // Enable wiki links extension.
}

/** Options for the parse function */
export interface ParseOptions {
  parseFlags?  :ParseFlags  // defaults to a github-style set of flags
  format?      :"html"      // defaults to "html"

  // asMemoryView=true causes parse() to return a view of heap memory as a Uint8Array,
  // instead of a string.
  //
  // The returned Uint8Array is only valid until the next call to parse().
  // If you need to keep the returned data around, call Uint8Array.slice() to make a copy,
  // as each call to parse() reuses the same underlying memory.
  asMemoryView? :boolean
}

/** Markdown source code can be provided as a JavaScript string or UTF8 encoded data */
type Source = string|ArrayLike<number>

/**
 * parse reads markdown source and converts it to options.format
 * When output is a byte array, it will be a reference
 */
export function parse(s :Source, options? :ParseOptions & { asMemoryView? :never|false }) :string
export function parse(s :Source, options? :ParseOptions & { asMemoryView :true }) :Uint8Array
