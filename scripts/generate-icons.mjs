// สร้างไอคอน PWA แบบ pure-Node (ไม่พึ่ง ImageMagick/PIL) — วาดสี่เหลี่ยมพื้นหลัง + กากบาทกางเขนสีขาว (สัญลักษณ์เภสัชกรรม)
// รันครั้งเดียวตอน setup โปรเจกต์: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT_DIR = new URL('../public/icons/', import.meta.url)
mkdirSync(OUT_DIR, { recursive: true })

const BG = [13, 148, 136] // teal-600 #0d9488
const FG = [255, 255, 255]

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

// draws a rounded square background + a plus-sign cross, with optional extra padding for maskable icons
function makePng(size, { maskable = false } = {}) {
  const pad = maskable ? Math.round(size * 0.2) : Math.round(size * 0.08)
  const radius = maskable ? 0 : Math.round(size * 0.18)
  const crossThickness = Math.round(size * 0.16)
  const crossMargin = pad + Math.round(size * 0.14)

  const inBounds = (x, y) => {
    if (radius === 0) return true
    // rounded-corner mask relative to full canvas
    const rx = Math.min(x, size - 1 - x)
    const ry = Math.min(y, size - 1 - y)
    if (rx >= radius || ry >= radius) return true
    const dx = radius - rx
    const dy = radius - ry
    return dx * dx + dy * dy <= radius * radius
  }

  const cx = size / 2
  const cy = size / 2
  const halfLen = size / 2 - crossMargin
  const halfThick = crossThickness / 2

  const isCross = (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const vertical = Math.abs(dx) <= halfThick && Math.abs(dy) <= halfLen
    const horizontal = Math.abs(dy) <= halfThick && Math.abs(dx) <= halfLen
    return vertical || horizontal
  }

  const rowBytes = size * 4
  const raw = Buffer.alloc((rowBytes + 1) * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4
      const painted = inBounds(x, y)
      const [r, g, b] = !painted ? [0, 0, 0] : isCross(x, y) ? FG : BG
      const a = painted ? 255 : 0
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw, { level: 9 })
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-192-maskable.png', 192, { maskable: true }],
  ['icon-512-maskable.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon.png', 32, {}]
]

for (const [name, size, opts] of targets) {
  const png = makePng(size, opts)
  writeFileSync(new URL(name, OUT_DIR), png)
  console.log(`สร้างไฟล์ ${name} (${size}x${size}) แล้ว`)
}
