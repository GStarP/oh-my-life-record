import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adb, connectAndroid } from './helpers/android.mjs'

function systemBarFrame(dump, type) {
  const line = dump.split('\n').find((item) => item.includes(`type=${type} frame=`) && item.includes('visible=true'))
  const match = line?.match(/frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  assert.ok(match, `无法读取可见的 ${type} 位置`)
  const [left, top, right, bottom] = match.slice(1).map(Number)
  return { left, top, right, bottom }
}

function webViewFrame() {
  const path = '/data/local/tmp/ohmylife-insets-test.xml'
  try {
    adb('shell', 'uiautomator', 'dump', path)
    const xml = adb('shell', 'cat', path)
    const match = xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    assert.ok(match, '无法读取 WebView 在屏幕中的位置')
    const [left, top, right, bottom] = match.slice(1).map(Number)
    return { left, top, right, bottom }
  } finally {
    adb('shell', 'rm', '-f', path)
  }
}

test('Android 系统栏不会遮挡记录页的操作控件', { timeout: 60_000 }, async () => {
  // 新版 WebView 会让启用全屏视口的页面绘制到系统栏下方；旧版可能由原生层自动避让，无法暴露这个问题。
  // 因此在 Android 15 及以上、WebView 140 及以上的竖屏模拟器中，比较真实系统栏位置与搜索、同步、底部导航的屏幕坐标。
  // 这些控件必须完全位于状态栏下方和导航栏上方，保证用户既能看清也能操作；不依赖某个机型的固定边距。
  assert.ok(Number(adb('shell', 'getprop', 'ro.build.version.sdk')) >= 35, '此检查需要 Android 15 或更高版本')
  const version = adb('shell', 'dumpsys', 'webviewupdate').match(/Current WebView package \(name, version\): \([^,]+,\s*(\d+)\./)
  assert.ok(version && Number(version[1]) >= 140, '此检查需要 Android System WebView 140 或更高版本')

  const app = await connectAndroid()
  try {
    const { page } = app
    await page.getByRole('link', { name: '记录', exact: true }).click()
    await page.getByRole('textbox', { name: '筛选类型' }).waitFor()

    const webView = webViewFrame()
    const dump = adb('shell', 'dumpsys', 'window', 'displays')
    const status = systemBarFrame(dump, 'statusBars')
    const navigation = systemBarFrame(dump, 'navigationBars')
    assert.ok(navigation.top > status.bottom && navigation.right - navigation.left > navigation.bottom - navigation.top, '此检查需要竖屏及底部系统导航栏')
    const dpr = await page.evaluate(() => devicePixelRatio)

    for (const name of ['筛选类型', '手动同步']) {
      const box = await page.getByLabel(name, { exact: true }).boundingBox()
      assert.ok(box, `无法读取「${name}」的位置`)
      assert.ok(webView.top + box.y * dpr >= status.bottom, `「${name}」被状态栏遮挡`)
    }
    for (const name of ['记录', '设置']) {
      const box = await page.getByRole('link', { name, exact: true }).boundingBox()
      assert.ok(box, `无法读取「${name}」的位置`)
      assert.ok(webView.top + (box.y + box.height) * dpr <= navigation.top, `「${name}」被系统导航栏遮挡`)
    }
  } finally {
    await app.close()
  }
})
