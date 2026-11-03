import assert from 'node:assert/strict'
import { deflateSync, crc32 } from 'node:zlib'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { adb } from './android.mjs'

/** 只给独立验收模拟器加入一张 1200 万像素测试照片，实际经过系统媒体库和选图器。 */
export async function seedPhoto() {
  assert.match(adb('emu', 'avd', 'name'), /^Sync_UI/)
  const directory = await mkdtemp(resolve(tmpdir(), 'omlr-picker-'))
  const chunk = (name, body) => {
    const size = Buffer.alloc(4), type = Buffer.from(name), checksum = Buffer.alloc(4)
    size.writeUInt32BE(body.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, body])))
    return Buffer.concat([size, type, body, checksum])
  }
  const width = 4000, height = 3000, rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3
    rows[offset] = x < width / 2 ? 220 : 30; rows[offset + 1] = 40; rows[offset + 2] = x < width / 2 ? 30 : 220
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
  const name = 'omlr-native-fixture.png', path = '/sdcard/Pictures/' + name
  await writeFile(resolve(directory, name), png)
  adb('shell', 'mkdir', '-p', '/sdcard/Pictures'); adb('push', resolve(directory, name), path)
  adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + path)
  for (let i = 0; i < 40; i++) {
    if (adb('shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id:_display_name').includes(name)) break
    if (i === 39) throw new Error('测试图片没有进入系统媒体库')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return async () => {
    assert.match(adb('emu', 'avd', 'name'), /^Sync_UI/)
    adb('shell', 'rm', '-f', path, '/sdcard/omlr-picker.xml')
    await rm(directory, { recursive: true, force: true })
  }
}

const nodes = xml => [...xml.matchAll(/<node\s+([^>]+)/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]])))
function tap(node) {
  const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number)
  adb('shell', 'input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2)))
}

export async function pickPhoto(page) {
  await page.getByText('图片', { exact: true }).locator('..').getByRole('button', { name: '添加', exact: true }).click()
  let selected = false
  for (let i = 0; i < 20; i++) {
    adb('shell', 'uiautomator', 'dump', '/sdcard/omlr-picker.xml')
    const xml = adb('shell', 'cat', '/sdcard/omlr-picker.xml'), items = nodes(xml)
    await writeFile(resolve('.scratch/android-native/last-picker.xml'), xml)
    if (!selected) {
      const image = items.find(item => /icon_thumbnail|thumbnail/.test(item['resource-id'] ?? '') && item.bounds !== '[0,0][0,0]')
        ?? items.find(item => /^Photo taken|^Photo,/.test(item['content-desc'] ?? ''))
      if (image) { tap(image); selected = true }
    } else {
      const confirm = items.find(item => item.enabled === 'true' && /^(Add|Select|Done)(\s|\(|$)/.test(item.text ?? ''))
      if (confirm) {
        tap(confirm)
        for (let j = 0; j < 30; j++) {
          if (/topResumedActivity=.*app\.ohmylife\.record\/\.MainActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities'))) return
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        throw new Error('系统选图器没有返回编辑器')
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('无法在系统选图器选择测试照片，见 last-picker.xml')
}
