import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { hostname } from 'node:os'

/**
 * Finding OpenAgent on this Wi-Fi: a door open on the Wi-Fi says so on the network, the way a
 * printer does (multicast DNS, as Bonjour and Avahi speak it), and another computer's `devices
 * find` hears it. Written here and not taken from a library: the package has no other one, and
 * the little it needs is a few records.
 *
 * What a door says: its name, OpenAgent's version, and its port; the number it is at is the one its
 * answer comes from, and the one it says beside. Nothing in it lets anyone in: a computer that
 * found it asks, and a person on this computer allows it.
 */

/** What a door on the Wi-Fi is announced as. */
export const SERVICE = '_openagent._tcp.local'
const SERVICES = '_services._dns-sd._udp.local'
const GROUP = '224.0.0.251'
const PORT = 5353

const PTR = 12
const TXT = 16
const SRV = 33
const A = 1
const ANY = 255
/** How long another computer keeps what it heard: a door that closes says so, with nothing kept. */
const TTL_S = 120

/** What a door says of itself. */
export interface Announced {
  /** The computer's name, as a person reads it. */
  name: string
  /** OpenAgent's version on it, when it said. */
  version?: string
  /** Its door's port. */
  port: number
  /** Its number on the network. */
  address: string
}

/** A door heard on the Wi-Fi. */
export interface Found {
  name: string
  version?: string
  /** Where its door is: `http://<number>:<port>`. */
  url: string
}

/** A name as a packet carries it, label by label. */
function encodeName(name: string): Buffer {
  const labels = name.split('.').filter(Boolean).map(label => {
    const bytes = Buffer.from(label).subarray(0, 63)
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  })
  return Buffer.concat([...labels, Buffer.from([0])])
}

function record(name: string, type: number, data: Buffer, ttl: number, unique: boolean): Buffer {
  const head = Buffer.alloc(10)
  head.writeUInt16BE(type, 0)
  // The class, IN, with the bit that says this computer alone answers to the name.
  head.writeUInt16BE(unique ? 0x8001 : 1, 2)
  head.writeUInt32BE(ttl, 4)
  head.writeUInt16BE(data.length, 8)
  return Buffer.concat([encodeName(name), head, data])
}

function packet(response: boolean, questions: Buffer[], answers: Buffer[]): Buffer {
  const head = Buffer.alloc(12)
  head.writeUInt16BE(response ? 0x8400 : 0, 2)
  head.writeUInt16BE(questions.length, 4)
  head.writeUInt16BE(answers.length, 6)
  return Buffer.concat([head, ...questions, ...answers])
}

function question(name: string, type: number): Buffer {
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(type, 0)
  tail.writeUInt16BE(1, 2)
  return Buffer.concat([encodeName(name), tail])
}

/** A door's own label on the network: one per door, so two OpenAgents on one computer are two. */
const labelOf = (announced: Announced): string => `${hostLabel()}-${announced.port}`
const hostLabel = (): string =>
  hostname()
    .replace(/\.local$/i, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .slice(0, 40) || 'openagent'

/** The records a door answers with: it is one of the service, where it is, and what it says of itself. */
function recordsOf(announced: Announced, ttl: number): Buffer[] {
  const instance = `${labelOf(announced)}.${SERVICE}`
  const target = `${hostLabel()}-openagent.local`
  const srv = Buffer.alloc(6)
  srv.writeUInt16BE(announced.port, 4)
  const said = [`name=${announced.name.slice(0, 60)}`, ...(announced.version ? [`v=${announced.version}`] : [])].map(pair => {
    const bytes = Buffer.from(pair).subarray(0, 255)
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  })
  return [
    record(SERVICE, PTR, encodeName(instance), ttl, false),
    record(instance, SRV, Buffer.concat([srv, encodeName(target)]), ttl, true),
    record(instance, TXT, Buffer.concat(said), ttl, true),
    record(target, A, Buffer.from(announced.address.split('.').map(Number)), ttl, true),
  ]
}

interface Parsed {
  response: boolean
  questions: { name: string; type: number }[]
  records: { name: string; type: number; ttl: number; data: string | string[] | { port: number; target: string } | undefined }[]
}

/** A name in a packet, following the pointers names are shortened with; a loop or a name past the end throws. */
function readName(buf: Buffer, at: number): [string, number] {
  const labels: string[] = []
  let end = -1
  for (let jumps = 0; ; ) {
    const length = buf[at]
    if (length === undefined) throw new Error('name past the end')
    if (length === 0) {
      at++
      break
    }
    if ((length & 0xc0) === 0xc0) {
      if (++jumps > 16) throw new Error('names that point in a loop')
      if (end === -1) end = at + 2
      at = ((length & 0x3f) << 8) | buf.readUInt8(at + 1)
      continue
    }
    labels.push(buf.subarray(at + 1, at + 1 + length).toString())
    at += 1 + length
  }
  return [labels.join('.'), end === -1 ? at : end]
}

/** What a packet holds, as far as finding a door needs; anything else is skipped. Throws on a packet that is not one. */
export function parse(buf: Buffer): Parsed {
  const count = buf.readUInt16BE(4)
  const answered = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10)
  let at = 12
  const questions: Parsed['questions'] = []
  for (let i = 0; i < count; i++) {
    const [name, next] = readName(buf, at)
    questions.push({ name, type: buf.readUInt16BE(next) })
    at = next + 4
  }
  const records: Parsed['records'] = []
  for (let i = 0; i < answered; i++) {
    const [name, next] = readName(buf, at)
    const type = buf.readUInt16BE(next)
    const ttl = buf.readUInt32BE(next + 4)
    const length = buf.readUInt16BE(next + 8)
    const start = next + 10
    if (start + length > buf.length) throw new Error('record past the end')
    let data: Parsed['records'][number]['data']
    if (type === PTR) data = readName(buf, start)[0]
    else if (type === SRV) data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6)[0] }
    else if (type === A && length === 4) data = [...buf.subarray(start, start + 4)].join('.')
    else if (type === TXT) {
      const pairs: string[] = []
      for (let p = start; p < start + length; p += 1 + buf[p]!) pairs.push(buf.subarray(p + 1, p + 1 + buf[p]!).toString())
      data = pairs
    }
    records.push({ name, type, ttl, data })
    at = start + length
  }
  return { response: (buf.readUInt16BE(2) & 0x8000) !== 0, questions, records }
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** A socket on the port every computer on the network listens to, beside the system's own (mDNSResponder, Avahi). */
function openSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.once('error', reject)
    socket.bind(PORT, () => {
      socket.removeListener('error', reject)
      try {
        socket.addMembership(GROUP)
        socket.setMulticastTTL(255)
        socket.setMulticastLoopback(true)
      } catch (err) {
        socket.close()
        return reject(err)
      }
      resolve(socket)
    })
  })
}

const send = (socket: Socket, data: Buffer): Promise<void> => new Promise(resolve => socket.send(data, PORT, GROUP, () => resolve()))

/** Whether a packet asks for this door: for OpenAgent on the Wi-Fi, for every service, or for one of the door's own records. */
export function asksFor(buf: Buffer, announced: Announced): boolean {
  let asked: Parsed
  try {
    asked = parse(buf)
  } catch {
    return false
  }
  if (asked.response) return false
  const instance = `${labelOf(announced)}.${SERVICE}`
  const target = `${hostLabel()}-openagent.local`
  return asked.questions.some(
    q => ((q.type === PTR || q.type === ANY) && (same(q.name, SERVICE) || same(q.name, SERVICES))) || ((q.type === SRV || q.type === TXT || q.type === ANY) && same(q.name, instance)) || ((q.type === A || q.type === ANY) && same(q.name, target)),
  )
}

/** The question `find` asks: which doors are open on this Wi-Fi. */
export const lookingFor = (): Buffer => packet(false, [question(SERVICE, PTR)], [])

export interface Announcing {
  /** Say on the network that the door closed, and stop answering. */
  stop(): Promise<void>
}

/**
 * Say on this Wi-Fi that this door is open, now and again a second later, and answer every
 * computer that asks for OpenAgent, until stopped. Rejects when the network's port cannot be had.
 */
export async function announce(announced: Announced): Promise<Announcing> {
  const socket = await openSocket()
  const answer = (): Promise<void> => send(socket, announcement(announced))
  socket.on('message', (buf: Buffer) => {
    if (asksFor(buf, announced)) void answer()
  })
  socket.on('error', () => {})
  await answer()
  const again = setTimeout(() => void answer(), 1_000)
  return {
    async stop() {
      clearTimeout(again)
      await send(socket, announcement(announced, true))
      socket.close()
    },
  }
}

/** The answer a door gives, or says by itself: it is one of the service, where it is, and what it says of itself. With `gone`, that it closed. */
export function announcement(announced: Announced, gone = false): Buffer {
  return packet(true, [], recordsOf(announced, gone ? 0 : TTL_S))
}

/** What was heard on the Wi-Fi while looking: each answer as it came, and from where. */
export class Heard {
  private readonly instances = new Set<string>()
  private readonly where = new Map<string, { port: number; target: string }>()
  private readonly said = new Map<string, string[]>()
  private readonly numbers = new Map<string, string>()
  private readonly from = new Map<string, string>()

  /** One packet, from the number `sender`; one that is no answer, or no packet, changes nothing. */
  add(buf: Buffer, sender: string): void {
    let heard: Parsed
    try {
      heard = parse(buf)
    } catch {
      return
    }
    if (!heard.response) return
    for (const { name, type, ttl, data } of heard.records) {
      const key = name.toLowerCase()
      // A door that closed says so with nothing kept: it is not listed.
      if (type === PTR && ttl === 0 && typeof data === 'string') {
        this.instances.delete(data.toLowerCase())
        continue
      }
      if (type === PTR && same(name, SERVICE) && typeof data === 'string') this.instances.add(data.toLowerCase())
      else if (type === SRV && data && typeof data === 'object' && !Array.isArray(data)) {
        this.where.set(key, data)
        this.from.set(key, sender)
      } else if (type === TXT && Array.isArray(data)) this.said.set(key, data)
      else if (type === A && typeof data === 'string') this.numbers.set(key, data)
    }
  }

  /** Every door heard, once each. */
  found(): Found[] {
    const found: Found[] = []
    for (const instance of this.instances) {
      const at = this.where.get(instance)
      if (!at) continue
      const pairs = Object.fromEntries((this.said.get(instance) ?? []).filter(pair => pair.includes('=')).map(pair => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
      // The number its answer came from first: the one it is at now, whatever it said a while ago.
      const number = this.from.get(instance) ?? this.numbers.get(at.target.toLowerCase())
      if (!number) continue
      const name = pairs.name?.trim() ? pairs.name.trim().slice(0, 60) : instance.split('.')[0]!
      const url = `http://${number}:${at.port}`
      if (!found.some(door => door.url === url)) found.push({ name, ...(pairs.v ? { version: pairs.v } : {}), url })
    }
    return found
  }
}

/**
 * Ask this Wi-Fi which doors are open, and listen for `ms`: every door heard, by its name, its
 * version and where it is. Asked twice, as a packet can be lost. Rejects when the network's port
 * cannot be had.
 */
export async function find(ms = 2_000): Promise<Found[]> {
  const socket = await openSocket()
  const heard = new Heard()
  socket.on('message', (buf: Buffer, sender: RemoteInfo) => heard.add(buf, sender.address))
  socket.on('error', () => {})
  const ask = (): Promise<void> => send(socket, lookingFor())
  const half = Math.min(1_000, ms / 2)
  await ask()
  await new Promise(resolve => setTimeout(resolve, half))
  await ask()
  await new Promise(resolve => setTimeout(resolve, ms - half))
  socket.close()
  return heard.found()
}
