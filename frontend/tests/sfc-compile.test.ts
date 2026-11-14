/**
 * 监控模块 SFC 编译冒烟：用 @vue/compiler-sfc 编译任务监控的全部 .vue 文件，
 * 捕获模板语法与脚本编译错误（vue-tsc 管类型，本测试管可编译性）。
 * 运行：node --experimental-strip-types frontend/tests/sfc-compile.test.ts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const here = dirname(fileURLToPath(import.meta.url))
const monitorDir = join(here, '..', 'src', 'views', 'monitor')

function collectVueFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectVueFiles(full))
    } else if (entry.name.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

let passed = 0
const files = collectVueFiles(monitorDir)
assert.ok(files.length >= 6, '监控模块至少应有主页面与 5 个组件')

for (const file of files) {
  const source = readFileSync(file, 'utf-8')
  const { descriptor, errors } = parse(source, { filename: file })
  assert.deepEqual(errors, [], `${file} 模板解析不应报错`)

  if (descriptor.scriptSetup || descriptor.script) {
    const script = compileScript(descriptor, { id: file })
    assert.ok(script.content.length > 0, `${file} 脚本应编译出内容`)
  }
  if (descriptor.template) {
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename: file,
      id: file,
    })
    assert.deepEqual(tpl.errors, [], `${file} 模板编译不应报错`)
    assert.ok(tpl.code.length > 0, `${file} 模板应编译出渲染函数`)
  }
  passed += 1
  console.log(`  ✓ ${file.replace(monitorDir, '.')} 编译通过`)
}

console.log(`\n全部 ${passed} 个监控 SFC 编译冒烟通过`)
