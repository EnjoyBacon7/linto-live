/** AMF0, as much as RTMP commands need (numbers, booleans, strings, objects, null). */
export type Amf = number | boolean | string | null | undefined | { [k: string]: Amf } | Amf[]

const NUMBER = 0x00, BOOLEAN = 0x01, STRING = 0x02, OBJECT = 0x03, NULL = 0x05, UNDEFINED = 0x06
const ECMA_ARRAY = 0x08, OBJECT_END = 0x09, STRICT_ARRAY = 0x0a, DATE = 0x0b, LONG_STRING = 0x0c

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  const len = Buffer.alloc(2)
  len.writeUInt16BE(b.length)
  return Buffer.concat([len, b])
}

export function encode(...values: Amf[]): Buffer {
  const out: Buffer[] = []
  const one = (v: Amf): void => {
    if (typeof v === 'number') {
      const b = Buffer.alloc(9)
      b[0] = NUMBER
      b.writeDoubleBE(v, 1)
      out.push(b)
    } else if (typeof v === 'boolean') out.push(Buffer.from([BOOLEAN, v ? 1 : 0]))
    else if (typeof v === 'string') out.push(Buffer.from([STRING]), str(v))
    else if (v === null) out.push(Buffer.from([NULL]))
    else if (v === undefined) out.push(Buffer.from([UNDEFINED]))
    else if (Array.isArray(v)) {
      const n = Buffer.alloc(5)
      n[0] = STRICT_ARRAY
      n.writeUInt32BE(v.length, 1)
      out.push(n)
      v.forEach(one)
    } else {
      out.push(Buffer.from([OBJECT]))
      for (const [k, x] of Object.entries(v)) {
        out.push(str(k))
        one(x)
      }
      out.push(Buffer.from([0, 0, OBJECT_END]))
    }
  }
  values.forEach(one)
  return Buffer.concat(out)
}

/** Decodes every value of `b`; throws on a truncated or unknown value. */
export function decode(b: Buffer): Amf[] {
  let i = 0
  const need = (n: number): void => {
    if (i + n > b.length) throw new Error('AMF0 tronqué')
  }
  const key = (): string => {
    need(2)
    const n = b.readUInt16BE(i)
    need(2 + n)
    const s = b.toString('utf8', i + 2, i + 2 + n)
    i += 2 + n
    return s
  }
  const props = (): { [k: string]: Amf } => {
    const o: { [k: string]: Amf } = {}
    for (;;) {
      need(3)
      if (b.readUInt16BE(i) === 0 && b[i + 2] === OBJECT_END) {
        i += 3
        return o
      }
      const k = key()
      o[k] = one()
    }
  }
  const one = (): Amf => {
    need(1)
    const t = b[i++]
    switch (t) {
      case NUMBER: need(8); i += 8; return b.readDoubleBE(i - 8)
      case BOOLEAN: need(1); return b[i++] !== 0
      case STRING: return key()
      case LONG_STRING: {
        need(4)
        const n = b.readUInt32BE(i)
        need(4 + n)
        i += 4 + n
        return b.toString('utf8', i - n, i)
      }
      case OBJECT: return props()
      case ECMA_ARRAY: need(4); i += 4; return props()
      case STRICT_ARRAY: {
        need(4)
        const n = b.readUInt32BE(i)
        i += 4
        return Array.from({ length: n }, one)
      }
      case NULL: return null
      case UNDEFINED: return undefined
      case DATE: need(10); i += 10; return b.readDoubleBE(i - 10)
      default: throw new Error(`AMF0 : type ${t} non pris en charge`)
    }
  }
  const out: Amf[] = []
  while (i < b.length) out.push(one())
  return out
}
