const FENCE_LANGUAGE_PATTERN = /^[\t ]*(?:`{3,}|~{3,})\s*([^\s`~{]+)/gm;

// Shiki web bundle 中包含的核心语言集合
// Shiki web bundle 中包含的核心语言
// 只列出实际存在于 bundle 中的语言，避免加载时出现警告
export const SHIKI_CORE_LANGS = [
  // JavaScript ecosystem
  'javascript', 'typescript', 'jsx', 'tsx',
  // Data/Config formats
  'json', 'json5', 'jsonc', 'yaml', 'toml', 'ini',
  // Web/Markup
  'markdown', 'mdx', 'html', 'xml', 'css', 'scss', 'sass', 'less', 'postcss',
  // Shell/CLI
  'bash', 'shellscript', 'powershell', 'cmd',
  // JVM languages
  'python', 'java', 'kotlin', 'groovy', 'scala', 'clojure',
  // Systems languages
  'go', 'rust', 'c', 'cpp', 'csharp', 'zig',
  // Other compiled
  'php', 'ruby', 'swift', 'dart', 'lua', 'perl', 'r',
  // Functional
  'elixir', 'erlang', 'haskell', 'ocaml', 'fsharp',
  // .NET
  'vb', 'fs',
  // Mobile
  'objective-c', 'objc',
  // Database/Query
  'sql', 'graphql', 'prisma',
  // DevOps/Config
  'docker', 'dockerfile', 'nginx', 'apache',
  // Tools
  'diff', 'viml', 'http',
  // Frameworks
  'vue', 'vue-html', 'svelte', 'astro', 'angular-html', 'angular-ts',
  'solidity',
  // Documentation
  'latex', 'tex',
] as const;

const SHIKI_CORE_LANGS_SET = new Set<string>(SHIKI_CORE_LANGS);

export const SHIKI_LANGUAGE_ALIASES: Record<string, string> = {
  // JavaScript
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  es6: 'javascript',
  es7: 'javascript',
  // TypeScript
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  // Shell
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  fish: 'bash',
  bash: 'bash',
  // Config/Data
  yml: 'yaml',
  yaml: 'yaml',
  // Python
  py: 'python',
  python3: 'python',
  py3: 'python',
  // Rust
  rs: 'rust',
  rust: 'rust',
  // Markdown
  md: 'markdown',
  markdown: 'markdown',
  // C/C++
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  h: 'c',
  // Ruby
  rb: 'ruby',
  ruby: 'ruby',
  gemfile: 'ruby',
  // Kotlin
  kt: 'kotlin',
  kts: 'kotlin',
  kotlin: 'kotlin',
  // PowerShell
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  powershell: 'powershell',
  // Docker
  dockerfile: 'docker',
  docker: 'docker',
  // GraphQL
  gql: 'graphql',
  gqls: 'graphql',
  graphqls: 'graphql',
  graphql: 'graphql',
  // Make
  make: 'makefile',
  mk: 'makefile',
  makefile: 'makefile',
  // Vim
  vim: 'viml',
  viml: 'viml',
  vimscript: 'viml',
  // Objective-C
  objc: 'objective-c',
  'obj-c': 'objective-c',
  'objective-c': 'objective-c',
  objectivec: 'objective-c',
  // Go
  golang: 'go',
  go: 'go',
  // Java
  java: 'java',
  // PHP
  php: 'php',
  // Swift
  swift: 'swift',
  // Dart
  dart: 'dart',
  // Lua
  lua: 'lua',
  // Perl
  perl: 'perl',
  pl: 'perl',
  pm: 'perl',
  // R
  r: 'r',
  rlang: 'r',
  // Julia
  jl: 'julia',
  julia: 'julia',
  // SQL variants
  mysql: 'sql',
  postgresql: 'sql',
  postgres: 'sql',
  sqlite: 'sql',
  mssql: 'sql',
  oracle: 'sql',
  tsql: 'sql',
  // HTML/XML
  htm: 'html',
  xhtml: 'html',
  svg: 'svg',
  // CSS variants
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  postcss: 'postcss',
  pcss: 'postcss',
  // JSON variants
  jsonc: 'jsonc',
  json5: 'json5',
  // TOML
  toml: 'toml',
  // INI
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  config: 'ini',
  // XML
  xml: 'xml',
  plist: 'xml',
  // Batch/CMD
  bat: 'batch',
  cmd: 'cmd',
  batch: 'batch',
  // Zig
  zig: 'zig',
  // Nim
  nim: 'nim',
  // Crystal
  cr: 'crystal',
  crystal: 'crystal',
  // Elixir
  ex: 'elixir',
  exs: 'elixir',
  elixir: 'elixir',
  // Erlang
  erl: 'erlang',
  erlang: 'erlang',
  // Haskell
  hs: 'haskell',
  lhs: 'haskell',
  haskell: 'haskell',
  // OCaml
  ml: 'ocaml',
  mli: 'ocaml',
  ocaml: 'ocaml',
  // F#
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  fsharp: 'fsharp',
  'f#': 'fsharp',
  // Elm
  elm: 'elm',
  // Clojure
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',
  clojure: 'clojure',
  // VB
  vb: 'vb',
  vba: 'vb',
  vbnet: 'vb',
  // LaTeX
  tex: 'latex',
  latex: 'latex',
  // Solidity
  sol: 'solidity',
  solidity: 'solidity',
  // HTTP
  http: 'http',
  https: 'http',
};

export function normalizeShikiLanguage(rawLang: string): string {
  const normalized = rawLang.trim().toLowerCase();
  if (!normalized) return '';

  // Diagram fences are handled by Mermaid, not Shiki — must not fall through to ''.
  if (normalized === 'mermaid' || normalized === 'mmd') {
    return normalized;
  }

  // Avoid passing arbitrary fence-info text into Shiki.
  // Accept only plausible language identifiers and known aliases/core names.
  if (!/^[a-z][a-z0-9_+#.-]*$/i.test(normalized)) {
    return '';
  }

  const aliased = SHIKI_LANGUAGE_ALIASES[normalized] ?? normalized;
  if (SHIKI_CORE_LANGS_SET.has(aliased)) {
    return aliased;
  }

  return '';
}

export function extractMarkdownFenceLanguages(markdown: string): string[] {
  if (!markdown) return [];

  const languages = new Set<string>();

  for (const match of markdown.matchAll(FENCE_LANGUAGE_PATTERN)) {
    const normalized = normalizeShikiLanguage(match[1] ?? '');
    if (!normalized || normalized === 'mermaid' || normalized === 'mmd') {
      continue;
    }
    languages.add(normalized);
  }

  return Array.from(languages);
}
