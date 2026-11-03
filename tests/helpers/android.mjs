import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const adbPath = process.env.ANDROID_HOME ? process.env.ANDROID_HOME + '/platform-tools/adb' : 'adb'
function targetArgs() {
  const serial = process.env.ADB_SERIAL
  if (!serial || !/^emulator-\d+$/.test(serial)) throw new Error('请显式设置模拟器 ADB_SERIAL；回归测试使用独立 Sync_UI 设备')
  return ['-s', serial]
}
export const adb = (...args) => execFileSync(adbPath, [...targetArgs(), ...args], { encoding: 'utf8' }).trim()
export async function connectAndroid() {
  if (adb('shell', 'getprop', 'ro.kernel.qemu') !== '1') throw new Error('自动验收仅面向 Android 模拟器')
  adb('shell', 'am', 'start', '-W', '-n', 'app.ohmylife.record/.MainActivity')
  const pid = adb('shell', 'pidof', 'app.ohmylife.record')
  const port = adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid)
  let browser
  for (let attempt = 0; attempt < 30; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { noDefaults: true, timeout: 1000 }); break }
    catch (error) { if (attempt === 29) throw error; await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  let page
  try {
    page = browser.contexts()[0].pages()[0]
    page.setDefaultTimeout(10_000)
    // 原生初始化完成后才渲染应用根节点；设置页和记录页都应能连接调试。
    await page.waitForFunction(() => document.querySelector('#root a[aria-label="记录"]') || document.body.innerText.includes('启动失败'))
    if ((await page.locator('body').innerText()).includes('启动失败')) throw new Error(await page.locator('body').innerText())
  } catch (error) {
    await browser.close()
    try { adb('forward', '--remove', 'tcp:' + port) } catch { /* 设备离线时调试转发随连接释放。 */ }
    throw error
  }
  let closed = false
  return { browser, page, close: async () => {
    if (closed) return
    closed = true
    try { await browser.close() }
    finally { try { adb('forward', '--remove', 'tcp:' + port) } catch { /* 清理失败不覆盖验收结果。 */ } }
  } }
}
export async function native(page, method, options = {}) {
  return page.evaluate(({ method, options }) => Capacitor.Plugins.LocalData[method](options), { method, options })
}

export function writeAndroidFile(path, bytes) {
  if (!/^files\/[A-Za-z0-9_.-]+$/.test(path)) throw new Error('测试文件路径不正确')
  execFileSync(adbPath, [...targetArgs(), 'shell', 'run-as', 'app.ohmylife.record', 'tee', path], { input: bytes, stdio: ['pipe', 'ignore', 'pipe'] })
}
