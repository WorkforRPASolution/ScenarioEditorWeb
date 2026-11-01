'use strict'
// C# 기준 도구 호출부. dotnet 은 ~/.dotnet 에 있다(로컬 NuGet 캐시로 오프라인 빌드).
const { execFileSync, spawnSync } = require('node:child_process')
const { join } = require('node:path')
const { existsSync } = require('node:fs')
const os = require('node:os')

const DIR = __dirname
const DOTNET_DIR = join(os.homedir(), '.dotnet')
const env = { ...process.env, PATH: `${DOTNET_DIR}:${process.env.PATH}`, DOTNET_CLI_TELEMETRY_OPTOUT: '1' }
const DLL = join(DIR, 'bin/out/CsharpGolden.dll')

function dotnetAvailable() {
  return spawnSync('dotnet', ['--version'], { env }).status === 0
}

// 출력은 붙잡아 두고, 성공하면 아무것도 찍지 않는다. 실패하면 붙잡은 stdout·stderr 를 메시지에 담아 던진다.
function build() {
  const r = spawnSync('dotnet', ['build', '-c', 'Release', '-o', 'bin/out', '--nologo', '-v', 'q'], { cwd: DIR, env, encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    throw new Error(`dotnet build 실패 (종료 ${r.status}${r.error ? `, ${r.error.message}` : ''})\n${r.stdout || ''}${r.stderr || ''}`)
  }
}

function normalize(type, json) {
  if (!existsSync(DLL)) build()
  return execFileSync('dotnet', [DLL, type], { env, input: json, maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
}

module.exports = { dotnetAvailable, build, normalize }
