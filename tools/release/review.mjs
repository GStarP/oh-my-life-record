import { mkdtemp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { candidate, repository } from './source.mjs'
import { authentication, remoteState, publish } from './publisher.mjs'
import { serveReview } from './server.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
await mkdir(resolve(root, '.scratch/release'), { recursive: true })
const destination = await mkdtemp(resolve(root, '.scratch/release/review-'))
const approved = await candidate(root, destination)
const remote = await remoteState(root, approved.tag)
const session = await serveReview({ approved, remote, repository, authenticate: () => authentication(root), publish: (auth, log) => publish(root, approved, remote, auth, message => { console.log(message); log(message) }), onClose: result => { process.exitCode = result.status === 'failed' ? 1 : 0; console.log('审核工具已退出：' + result.status) } })
console.log('本地发布审核：' + session.url)
console.log('只有用户点击确认才会发布；代理不得代点确认。取消将退出。')
const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
const browser = spawn(command, [session.url], { stdio: 'ignore' })
browser.on('error', () => console.log('请手动打开上述本地链接。'))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { session.close() })
