import React from 'react'
import {
  ADDRESS_IN, ARRIVE, BIO, BIO_SWAP, BUBBLES, CARD_IN, CHIP_IN, COLLAPSE, CONTACTS, CONTRACT, CTA, DISC, DROP,
  FLIP, FOOTNOTE, GAS_IN, GRID_IN, HITS, HOP, HOP_BACK, ICON_IN, INK_AT, JUMP, KEEP_LINE, LIFT, LOGO, NAME_IN,
  PAID, PANEL_IN, PAPER_AT, PAY_BIO, PAY_BTN, PROMISE_IN, PULL, PUSH, RETURN, RUN, SECTION, SEED_IN, SENT, SHAKE,
  TAP_PRIYA, TO_HOLE, TO_ICON, TO_PHONE, ZIPS, AMOUNT,
} from '../cues'
import { clamp, easeIn, easeInOut, easeOut, expoInOut, expoOut, lerp, rand, span, spring } from '../motion'
import { AppIcon, Bilby, Chip, Coin, FaceGlyph, FingerGlyph, Hello, Phone, ScreenText, Tick } from '../bilby'
import { CX, CY, Caption, Glow, H, W } from '../parts'
import {
  APRICOT, BLUE, BLUE_SOFT, DISPLAY, EARTH, GOLD, GREEN, INK, MUTED, NIGHT, PAPER, SAGE, SANS, SCARF, SKY,
} from '../theme'

export type Clock = { beat: number; spb: number; fpb: number }

/** A spring that starts at beat `at`. */
const arrive = (beat: number, at: number, spb: number, w = 12, z = 0.7) => spring((beat - at) * spb, { w, z })
/** A point on a quadratic arc from a to b, lifted by `lift` pixels. */
const arc = (a: readonly [number, number], b: readonly [number, number], t: number, lift: number): [number, number] => {
  const mx = (a[0] + b[0]) / 2
  const my = Math.min(a[1], b[1]) - lift
  const u = 1 - t
  return [u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]]
}
const money = (v: number) => `$${Math.round(v)}`

// ── 1 · Problem: crypto as it is today ──────────────────────────────────────────────────────

const ADDRESS = '0x5f3A9c27E1b84D0e6c3F71a2B95d0C4e8A17f3B9'
const SEED = ['apple', 'river', 'tiger', 'orbit', 'maple', 'cloud', 'ember', 'piano', 'quartz', 'lunar', 'velvet', 'harbor']

export function Problem({ beat, spb }: Clock) {
  if (beat > COLLAPSE[1] + 0.2) return null
  const c = span(beat, COLLAPSE[0], COLLAPSE[1], easeIn)
  const s = lerp(1, 0.03, c)
  const shake = beat > SHAKE[0] && beat < COLLAPSE[0] ? span(beat, SHAKE[0], SHAKE[1]) * 7 : 0
  const jx = (rand(Math.floor(beat * 14)) - 0.5) * shake * 2
  const jy = (rand(Math.floor(beat * 14) + 7) - 0.5) * shake * 2
  const fade = 1 - span(beat, COLLAPSE[1] - 0.35, COLLAPSE[1])
  const addressX = lerp(W + 40, -1150, span(beat, ADDRESS_IN, COLLAPSE[0], (t) => t))
  const wrong = beat > 4 ? 0.6 + 0.4 * Math.sin(beat * 6) : 0
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: fade, transformOrigin: `${CX}px ${CY}px`, transform: `translate(${jx}px, ${jy}px) scale(${s})` }}>
      <Glow x={CX} y={CY} r={900} color="#3264ED" opacity={0.18} />
      <div style={{ position: 'absolute', left: addressX, top: 210, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, fontSize: 104, color: BLUE_SOFT, letterSpacing: '0.02em', opacity: span(beat, ADDRESS_IN, ADDRESS_IN + 0.6) }}>
        {ADDRESS.split('').map((ch, i) => (
          <span key={i} style={i === 23 ? { color: SCARF, textDecoration: 'underline', textDecorationThickness: 6, opacity: 0.4 + wrong * 0.6 } : undefined}>{ch}</span>
        ))}
      </div>
      {SEED.map((word, i) => {
        const at = SEED_IN[0] + (i * (SEED_IN[1] - SEED_IN[0])) / SEED.length
        const a = arrive(beat, at, spb, 16, 0.6)
        const col = i % 4, row = Math.floor(i / 4)
        return (
          <Chip key={word} x={CX - 540 + col * 360} y={470 + row * 120} bg="#1E3560" color={SKY} size={44} opacity={clamp(a)} scale={0.6 + 0.4 * a}>
            <span style={{ color: MUTED, marginRight: 12 }}>{i + 1}</span>{word}
          </Chip>
        )
      })}
      <Chip x={CX} y={830} bg={SCARF} color={PAPER} size={44} opacity={clamp(arrive(beat, GAS_IN, spb, 18, 0.45))} scale={0.5 + 0.5 * arrive(beat, GAS_IN, spb, 18, 0.45)}>
        Insufficient MON for gas
      </Chip>
    </div>
  )
}

// ── 2–3 · Turn and What: Bilby jumps out of a phone number; push in to the icon ─────────────

const NUMBER = '+91 98··· ··210'

export function Turn({ beat, spb }: Clock) {
  if (beat < CHIP_IN - 0.1 || beat > PUSH[1] + 0.4) return null
  const chipA = arrive(beat, CHIP_IN, spb, 16, 0.55)
  const pop = beat > DROP ? 1 + 0.22 * Math.sin(clamp((beat - DROP) / 0.6) * Math.PI) : 1
  const settle = span(beat, JUMP, JUMP + 1.4, expoOut)
  const chipY = lerp(CY, CY + 360, settle)
  const disc = span(beat, DISC[0], DISC[1], easeInOut)
  const jump = arrive(beat, JUMP, spb, 9, 0.55)
  // The push-in: the camera flies to Bilby's face, which becomes the app icon.
  const push = span(beat, PUSH[0], PUSH[1], expoInOut)
  const zoom = lerp(1, 2.6, push)
  const fy = lerp(CY, CY - 170, push)
  const fade = 1 - span(beat, ICON_IN, ICON_IN + 0.5)
  return (
    <>
      {beat < DISC[1] + 0.3 && (
        <div style={{ position: 'absolute', left: CX - 1500 * disc, top: CY - 1500 * disc, width: 3000 * disc, height: 3000 * disc, borderRadius: '50%', background: PAPER, opacity: beat < PAPER_AT + 0.3 ? 1 : 0 }} />
      )}
      <div style={{ position: 'absolute', inset: 0, opacity: fade, transformOrigin: '0 0', transform: `translate(${CX}px, ${CY}px) scale(${zoom}) translate(${-CX}px, ${-fy}px)` }}>
        <Glow x={CX} y={CY - 60} r={520} color={BLUE_SOFT} opacity={0.7 * clamp(jump)} />
        <Hello x={CX} y={lerp(CY + 60, CY - 70, clamp(jump))} h={640 * Math.max(0, jump)} opacity={clamp(jump * 3)} />
        <Chip x={CX} y={chipY} bg={beat < DISC[0] + 0.6 ? PAPER : INK} color={beat < DISC[0] + 0.6 ? INK : PAPER} size={46} opacity={clamp(chipA)} scale={(0.4 + 0.6 * chipA) * pop}>
          {NUMBER}
        </Chip>
      </div>
    </>
  )
}

/** The app icon from the push-in to the phone's header. */
export function Icon({ beat }: Clock) {
  if (beat < ICON_IN - 0.1 || beat > LIFT[1]) return null
  const settle = span(beat, ICON_IN + 0.5, NAME_IN, easeInOut)
  const toPhone = span(beat, TO_PHONE[0], TO_PHONE[1], expoInOut)
  const size = lerp(lerp(600, 300, settle), 64, toPhone)
  const x = lerp(CX, PX, toPhone)
  const y = lerp(lerp(CY, CY - 120, settle), PY - 362, toPhone)
  const out = 1 - span(beat, LIFT[0], LIFT[0] + 0.6)
  return <AppIcon x={x} y={y} size={size} opacity={span(beat, ICON_IN, ICON_IN + 0.5) * out} />
}

export function Name({ beat, spb }: Clock) {
  if (beat < NAME_IN - 0.1 || beat > TO_PHONE[1]) return null
  const a = arrive(beat, NAME_IN, spb, 12, 0.7)
  const out = 1 - span(beat, TO_PHONE[0], TO_PHONE[0] + 0.6)
  return (
    <div style={{ position: 'absolute', left: CX, top: CY + 130, transform: `translate(-50%, -50%) translateY(${(1 - a) * 40}px)`, opacity: clamp(a) * out, fontFamily: DISPLAY, fontSize: 132, color: INK, whiteSpace: 'nowrap' }}>
      Bilby<span style={{ color: BLUE }}>Pay</span>
    </div>
  )
}

// ── 4 · How: the phone ──────────────────────────────────────────────────────────────────────

const PX = CX - 330
const PY = CY + 10
const SW = 398 // screen width inside the bezel

function Contacts({ beat }: { beat: number }) {
  const rows = [
    { name: 'Priya', number: '+91 98··· ··210', bg: BLUE_SOFT },
    { name: 'Mum', number: '+61 4·· ··· 118', bg: SAGE },
    { name: 'Arjun', number: '+1 415 ··· 0198', bg: APRICOT },
  ]
  const tap = span(beat, TAP_PRIYA, TAP_PRIYA + 0.5)
  return (
    <>
      <ScreenText x={SW / 2} y={150} size={34} weight={900}>Send to</ScreenText>
      {rows.map((r, i) => (
        <div key={r.name} style={{ position: 'absolute', left: 22, top: 200 + i * 104, width: SW - 44, height: 88, borderRadius: 24, background: i === 0 && tap > 0 ? `rgba(50,100,237,${0.16 * tap})` : 'transparent' }}>
          <div style={{ position: 'absolute', left: 16, top: 14, width: 60, height: 60, borderRadius: '50%', background: r.bg, display: 'grid', placeItems: 'center', fontFamily: SANS, fontWeight: 900, fontSize: 28, color: INK }}>{r.name[0]}</div>
          <ScreenText x={92} y={30} align="left" size={28}>{r.name}</ScreenText>
          <ScreenText x={92} y={62} align="left" size={20} weight={700} color={MUTED}>{r.number}</ScreenText>
        </div>
      ))}
      {tap > 0 && tap < 1 && (
        <div style={{ position: 'absolute', left: 70 - 60 * tap, top: 244 - 60 * tap, width: 120 * tap, height: 120 * tap, borderRadius: '50%', border: `4px solid ${BLUE}`, opacity: 1 - tap }} />
      )}
    </>
  )
}

function Amount({ beat }: { beat: number }) {
  const digits = beat > AMOUNT[0] + 1.1 ? '$20' : beat > AMOUNT[0] + 0.5 ? '$2' : '$'
  return (
    <>
      <ScreenText x={SW / 2} y={150} size={28} color={MUTED}>To Priya</ScreenText>
      <ScreenText x={SW / 2} y={330} size={150} weight={900}><span style={{ fontFamily: DISPLAY, fontWeight: 400 }}>{digits}</span></ScreenText>
      <div style={{ position: 'absolute', left: 40, top: 640, width: SW - 80, height: 86, borderRadius: 999, background: BLUE, display: 'grid', placeItems: 'center', fontFamily: SANS, fontWeight: 900, fontSize: 32, color: PAPER }}>Send $20</div>
    </>
  )
}

function Bio({ beat }: { beat: number }) {
  const face = beat < BIO_SWAP
  const ping = (beat - BIO[0]) % 1.2 / 1.2
  return (
    <>
      <div style={{ position: 'absolute', left: SW / 2 - 100, top: 250, width: 200, height: 200, borderRadius: 56, background: PAPER, boxShadow: '0 8px 0 rgba(20,40,75,.12)', border: `2px solid ${SKY}`, display: 'grid', placeItems: 'center' }}>
        {face ? <FaceGlyph size={110} /> : <FingerGlyph size={124} />}
      </div>
      <div style={{ position: 'absolute', left: SW / 2 - 110 - 30 * ping, top: 240 - 30 * ping, width: 220 + 60 * ping, height: 220 + 60 * ping, borderRadius: 70, border: `4px solid ${GREEN}`, opacity: 0.8 * (1 - ping) }} />
      <ScreenText x={SW / 2} y={520} size={30} weight={900} color={GREEN}>{face ? 'Face ID' : 'Fingerprint'}</ScreenText>
    </>
  )
}

function Sent({ beat, spb }: Clock) {
  const a = arrive(beat, SENT, spb, 14, 0.5)
  return (
    <>
      <Tick x={SW / 2} y={300} r={88} scale={Math.max(0, a)} />
      <ScreenText x={SW / 2} y={460} size={40} weight={900} opacity={span(beat, SENT + 0.3, SENT + 0.8)}>Sent to Priya</ScreenText>
      <ScreenText x={SW / 2} y={512} size={26} color={MUTED} opacity={span(beat, SENT + 0.5, SENT + 1)}>$20.00 · 2.3 s</ScreenText>
    </>
  )
}

export function How(clock: Clock) {
  const { beat, spb } = clock
  if (beat < TO_PHONE[0] || beat > LIFT[1] + 0.3) return null
  const a = arrive(beat, TO_PHONE[0] + 0.2, spb, 11, 0.75)
  const leave = span(beat, LIFT[0], LIFT[1], expoInOut)
  const screen = (from: number, to: number) => Math.min(span(beat, from, from + 0.35), 1 - span(beat, to - 0.2, to + 0.15))
  // Bilby runs the coin to Priya's number.
  const run = span(beat, RUN[0], RUN[1], easeInOut)
  const runIn = arrive(beat, RUN[0] - 0.6, spb, 10, 0.7)
  const bx = lerp(1060, 1430, run)
  const hop = Math.abs(Math.sin(run * Math.PI * 5)) * 26
  const coinIn = run < 0.92 ? 1 : 1 - span(run, 0.92, 1)
  const priya = arrive(beat, RUN[0], spb, 14, 0.6)
  const look = arrive(beat, CONTACTS[0] + 0.2, spb, 10, 0.7)
  const credited = beat > RUN[1] - 0.3
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-1100 * leave}px)`, opacity: 1 - leave }}>
      <Phone x={PX} y={PY} scale={0.55 + 0.45 * a} opacity={clamp(a * 2)}>
        <div style={{ position: 'absolute', inset: 0, opacity: screen(CONTACTS[0], CONTACTS[1]) }}><Contacts beat={beat} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: screen(AMOUNT[0], AMOUNT[1]) }}><Amount beat={beat} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: screen(BIO[0], BIO[1]) }}><Bio beat={beat} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: span(beat, SENT, SENT + 0.3) }}><Sent {...clock} /></div>
      </Phone>
      <Bilby pose="searching" x={1360} y={CY + 30 + (1 - clamp(look)) * 160} h={560} opacity={clamp(look * 2) * (1 - span(beat, RUN[0] - 0.9, RUN[0] - 0.5))} />
      <Bilby pose="running" x={bx} y={CY + 40 - hop} h={470} opacity={clamp(runIn * 2) * span(beat, RUN[0] - 0.7, RUN[0] - 0.4)} />
      <Coin x={bx + 70} y={CY - 210 - hop} r={44} opacity={clamp(runIn * 2) * coinIn} />
      <Chip x={1600} y={CY + 340} bg={credited ? GREEN : PAPER} color={credited ? PAPER : INK} size={36} opacity={clamp(priya)} scale={0.6 + 0.4 * priya}>
        {credited ? 'Priya +$20' : `Priya · ${NUMBER}`}
      </Chip>
    </div>
  )
}

// ── 5 · Anyone: a claim link, and the refund ────────────────────────────────────────────────

const CARD_X = CX + 200
const CARD_Y = CY + 90

function ClaimCard({ grey = 0 }: { grey?: number }) {
  return (
    <div style={{ width: 440, borderRadius: 30, overflow: 'hidden', background: PAPER, boxShadow: '0 14px 0 rgba(20,40,75,.16)', filter: grey ? `grayscale(${grey})` : undefined, opacity: 1 - grey * 0.35 }}>
      <div style={{ height: 150, background: APRICOT, display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 70, color: INK }}>$24.50</div>
      <div style={{ padding: '18px 26px 22px', fontFamily: SANS }}>
        <div style={{ fontWeight: 900, fontSize: 34, color: INK }}>You've got money</div>
        <div style={{ fontWeight: 700, fontSize: 24, color: MUTED }}>Tap to claim · BilbyPay</div>
      </div>
    </div>
  )
}

function GiftCard() {
  return (
    <div style={{ width: 440, height: 290, borderRadius: 30, background: `linear-gradient(135deg, ${GOLD}, ${APRICOT})`, boxShadow: '0 14px 0 rgba(20,40,75,.16)', position: 'relative', fontFamily: SANS, color: INK }}>
      <div style={{ position: 'absolute', left: 30, top: 26, fontFamily: DISPLAY, fontSize: 40 }}>Coffee Co.</div>
      <div style={{ position: 'absolute', left: 30, top: 84, fontWeight: 900, fontSize: 30 }}>$25 gift card</div>
      <div style={{ position: 'absolute', left: 30, bottom: 30, display: 'flex', gap: 5, alignItems: 'flex-end' }}>
        {Array.from({ length: 16 }, (_, i) => <div key={i} style={{ width: rand(i) > 0.5 ? 6 : 3, height: 58, background: INK }} />)}
      </div>
      <div style={{ position: 'absolute', right: 26, bottom: 28, fontWeight: 800, fontSize: 20, color: '#7A5410' }}>Opens in BilbyPay</div>
    </div>
  )
}

export function Anyone(clock: Clock) {
  const { beat, spb } = clock
  if (beat < LIFT[0] || beat > FLIP[1] + 0.3) return null
  // The "sent" tick lifts out of the phone and becomes my chat bubble.
  const lift = span(beat, LIFT[0], LIFT[1], expoInOut)
  const tickFrom: [number, number] = [PX, PY - 440 + 16 + 300]
  const tickTo: [number, number] = [CARD_X + 120, CY - 210]
  const [tx, ty] = arc(tickFrom, tickTo, lift, 160)
  const bubble = (at: number) => arrive(beat, at, spb, 13, 0.65)
  const card = arrive(beat, CARD_IN, spb, 12, 0.62)
  const ret = span(beat, RETURN[0], RETURN[1], easeInOut)
  const [cx2, cy2] = arc([CARD_X, CARD_Y - 40], [CARD_X + 520, CY + 360], ret, 220)
  const back = arrive(beat, RETURN[1] - 0.4, spb, 14, 0.6)
  const recv = arrive(beat, LIFT[1] - 0.4, spb, 10, 0.7)
  const flipping = beat >= FLIP[0]
  const out = 1 - span(beat, FLIP[0], FLIP[1])
  return (
    <>
      {lift < 1 && <Tick x={tx} y={ty} r={lerp(88, 40, lift)} opacity={1 - span(beat, LIFT[1] - 0.3, LIFT[1])} />}
      <div style={{ opacity: out }}>
        <Chip x={CARD_X - 60} y={CY - 300} bg={SKY} color={INK} size={32} opacity={clamp(bubble(BUBBLES))} scale={0.7 + 0.3 * bubble(BUBBLES)}>dinner was great!</Chip>
        <Chip x={CARD_X + 120} y={CY - 210} bg={BLUE} color={PAPER} size={32} opacity={clamp(bubble(BUBBLES + 0.8))} scale={0.7 + 0.3 * bubble(BUBBLES + 0.8)}>my share</Chip>
      </div>
      {!flipping && (
        <div style={{ position: 'absolute', left: CARD_X, top: CARD_Y, transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * card})`, opacity: clamp(card) }}>
          <ClaimCard grey={ret} />
        </div>
      )}
      {ret > 0 && ret < 1 && !flipping && <Coin x={cx2} y={cy2} r={40} />}
      {!flipping && <Chip x={CARD_X + 520} y={CY + 360} bg={GREEN} color={PAPER} size={34} opacity={clamp(back)} scale={0.6 + 0.4 * back}>Unclaimed? Back to you</Chip>}
      <Bilby pose="receiving" x={CX - 470} y={CY + 60 + (1 - clamp(recv)) * 200} h={580} opacity={clamp(recv * 2) * (beat >= (FLIP[0] + FLIP[1]) / 2 ? 0 : 1)} />
    </>
  )
}

// ── 6 · Gift: the claim card flips into a gift card ─────────────────────────────────────────

export function Gift({ beat }: Clock) {
  if (beat < FLIP[0] || beat > TO_HOLE[1] + 0.2) return null
  const flip = span(beat, FLIP[0], FLIP[1], easeInOut)
  const angle = flip * 180
  const drop = span(beat, TO_HOLE[0], TO_HOLE[1], expoInOut)
  const x = lerp(CARD_X, HOLE_X, drop)
  const y = lerp(CARD_Y, HOLE_Y - 10, drop)
  const s = lerp(1, 0.18, drop)
  const bil = beat >= (FLIP[0] + FLIP[1]) / 2 ? 1 : 0
  const bx = lerp(CX - 470, BURROW_BILBY_X, drop)
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${s}) perspective(1600px) rotateY(${angle}deg)`, opacity: 1 - span(beat, TO_HOLE[1] - 0.3, TO_HOLE[1]) }}>
        {angle < 90 ? <ClaimCard /> : <div style={{ transform: 'rotateY(180deg)' }}><GiftCard /></div>}
      </div>
      <Bilby pose="gifting" x={bx} y={lerp(CY + 60, CY + 90, drop)} h={lerp(580, 460, drop)} opacity={bil * (1 - span(beat, TO_HOLE[1] - 0.4, TO_HOLE[1]))} />
    </>
  )
}

// ── 7 · Burrow: keep $50, the rest digs in; pay more, it comes back ─────────────────────────

const HOLE_X = CX + 250
const HOLE_Y = 860
const PANEL_X = CX - 400
const PANEL_Y = CY - 30
const BURROW_BILBY_X = CX + 590

export function Burrow(clock: Clock) {
  const { beat, spb } = clock
  if (beat < TO_HOLE[0] || beat > PULL[1] + 0.2) return null
  const hole = span(beat, TO_HOLE[0], TO_HOLE[1], expoOut)
  const panel = arrive(beat, PANEL_IN, spb, 12, 0.7)
  const keep = span(beat, KEEP_LINE, KEEP_LINE + 0.8)
  const arrived = arrive(beat, ARRIVE, spb, 16, 0.5)
  // The balance through the scene.
  let bal = 50
  if (beat > ARRIVE) bal = lerp(50, 170, span(beat, ARRIVE, ARRIVE + 0.8))
  if (beat > HOP[0]) bal = lerp(170, 50, span(beat, HOP[0], HOP[1]))
  if (beat > HOP_BACK[0]) bal = lerp(50, 80, span(beat, HOP_BACK[0], HOP_BACK[1]))
  if (beat > PAID) bal = lerp(80, 0, span(beat, PAID, PAID + 0.6))
  let burrow = 0
  if (beat > HOP[0]) burrow = lerp(0, 120, span(beat, HOP[0], HOP[1]))
  if (beat > HOP_BACK[0]) burrow = lerp(120, 90, span(beat, HOP_BACK[0], HOP_BACK[1]))
  const coins = [0, 1, 2].map((i) => {
    const from = HOP[0] + i * 1.1
    const t = span(beat, from, from + 1.6, easeInOut)
    return { t, pos: arc([PANEL_X + 120, PANEL_Y - 40], [HOLE_X, HOLE_Y - 20], t, 260) }
  })
  const backT = span(beat, HOP_BACK[0], HOP_BACK[1], easeInOut)
  const backPos = arc([HOLE_X, HOLE_Y - 20], [PANEL_X + 120, PANEL_Y - 40], backT, 260)
  const btn = arrive(beat, PAY_BTN, spb, 13, 0.65)
  const paid = arrive(beat, PAID, spb, 14, 0.5)
  const pull = span(beat, PULL[0], PULL[1], expoInOut)
  const zoom = lerp(1, 0.22, pull)
  const label = arrive(beat, HOP[1] - 0.4, spb, 14, 0.6)
  return (
    <div style={{ position: 'absolute', inset: 0, transformOrigin: `${CX}px ${CY}px`, transform: `scale(${zoom})`, opacity: 1 - span(beat, PULL[1] - 0.6, PULL[1]) }}>
      {/* The ground and the burrow. */}
      <div style={{ position: 'absolute', left: 0, top: HOLE_Y + 10, width: W, height: H - HOLE_Y, background: SAGE, opacity: hole }} />
      <div style={{ position: 'absolute', left: HOLE_X - 190 * hole, top: HOLE_Y - 48 * hole, width: 380 * hole, height: 96 * hole, borderRadius: '50%', background: EARTH, boxShadow: `inset 0 18px 0 #4A321E` }} />
      <Glow x={HOLE_X} y={HOLE_Y - 30} r={260} color={GOLD} opacity={0.5 * span(beat, HOP[0], HOP[1]) * (1 - span(beat, PULL[0], PULL[1]))} />
      <Chip x={HOLE_X} y={HOLE_Y - 120} bg={EARTH} color={PAPER} size={32} opacity={clamp(label)} scale={0.7 + 0.3 * label}>Burrow {money(burrow)}</Chip>
      <Bilby pose="saving" x={BURROW_BILBY_X} y={CY + 90} h={460} opacity={span(beat, TO_HOLE[1] - 0.4, TO_HOLE[1])} />
      {/* The balance. */}
      <div style={{ position: 'absolute', left: PANEL_X - 270, top: PANEL_Y - 220, width: 540, height: 360, borderRadius: 40, background: PAPER, boxShadow: '0 16px 0 rgba(20,40,75,.12)', border: `3px solid ${SKY}`, opacity: clamp(panel), transform: `scale(${0.7 + 0.3 * panel})` }}>
        <div style={{ position: 'absolute', left: 40, top: 34, fontFamily: SANS, fontWeight: 800, fontSize: 30, color: MUTED }}>Balance</div>
        <div style={{ position: 'absolute', left: 40, top: 76, fontFamily: DISPLAY, fontSize: 120, color: INK }}>{money(bal)}</div>
        <div style={{ position: 'absolute', left: 40, top: 262, width: 460 * keep, borderTop: `5px dashed ${BLUE}` }} />
        <div style={{ position: 'absolute', left: 40, top: 282, fontFamily: SANS, fontWeight: 900, fontSize: 30, color: BLUE, opacity: keep }}>Keep $50</div>
      </div>
      <Chip x={PANEL_X + 200} y={PANEL_Y - 250} bg={GREEN} color={PAPER} size={32} opacity={clamp(arrived) * (1 - span(beat, HOP[0], HOP[0] + 0.5))} scale={0.6 + 0.4 * arrived}>+$120 arrived</Chip>
      {coins.map((c, i) => (c.t > 0 && c.t < 1 ? <Coin key={i} x={c.pos[0]} y={c.pos[1]} r={42} label="$40" /> : null))}
      {backT > 0 && backT < 1 && <Coin x={backPos[0]} y={backPos[1]} r={42} label="$30" />}
      <div style={{ position: 'absolute', left: PANEL_X - 200, top: PANEL_Y + 170, width: 400, height: 84, borderRadius: 999, background: beat > PAID ? GREEN : BLUE, display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'center', fontFamily: SANS, fontWeight: 900, fontSize: 32, color: PAPER, opacity: clamp(btn), transform: `scale(${0.7 + 0.3 * btn})` }}>
        {beat > PAY_BIO && beat < PAID ? <FingerGlyph size={44} color={PAPER} /> : null}
        {beat > PAID ? 'Paid $80 · one tap' : beat > HOP_BACK[0] ? 'Pay $80 · $30 from Burrow' : 'Pay $80'}
      </div>
      {beat > PAID && <Tick x={PANEL_X + 230} y={PANEL_Y - 170} r={40} scale={Math.max(0, paid)} />}
      {beat > FOOTNOTE[0] && beat < FOOTNOTE[1] + 0.5 && (
        <div style={{ position: 'absolute', left: CX, top: 1040, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: SANS, fontWeight: 700, fontSize: 22, color: INK, opacity: 0.75 * Math.min(span(beat, FOOTNOTE[0], FOOTNOTE[0] + 0.6), 1 - span(beat, FOOTNOTE[1], FOOTNOTE[1] + 0.5)) }}>
          Variable rate via Aave on mainnet. Testnet beta uses a stand-in. Not a guaranteed return.
        </div>
      )}
    </div>
  )
}

// ── 8–9 · Passkey and scale: one phone of many, then a crowd paying each other ──────────────

const PHONES = 5
const phoneX = (i: number) => CX + (i - (PHONES - 1) / 2) * 330

export function Passkey({ beat, spb }: Clock) {
  if (beat < PULL[0] + 0.6 || beat > GRID_IN[1] + 0.2) return null
  const toGrid = span(beat, GRID_IN[0], GRID_IN[1], expoInOut)
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - toGrid }}>
      {Array.from({ length: PHONES }, (_, i) => {
        const a = arrive(beat, PULL[0] + 1 + Math.abs(i - 2) * 0.35, spb, 12, 0.7)
        const face = (Math.floor(beat * 0.8) + i) % 2 === 0
        return (
          <Phone key={i} x={phoneX(i)} y={CY - 40} w={250} h={510} scale={(0.6 + 0.4 * a) * lerp(1, 0.3, toGrid)} opacity={clamp(a * 2)}>
            <div style={{ position: 'absolute', left: 109 - 60, top: 150, width: 120, height: 120, display: 'grid', placeItems: 'center' }}>
              {face ? <FaceGlyph size={100} color={i === 2 ? GREEN : INK} /> : <FingerGlyph size={110} color={i === 2 ? GREEN : INK} />}
            </div>
            <ScreenText x={109} y={330} size={22} weight={900} color={MUTED}>Passkey</ScreenText>
          </Phone>
        )
      })}
    </div>
  )
}

const COLS = 11
const ROWS = 4
const AV = 46
const avatar = (i: number) => {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  return [CX + (col - (COLS - 1) / 2) * 150, CY - 120 + (row - (ROWS - 1) / 2) * 150] as const
}
const AV_COLORS = [BLUE_SOFT, SAGE, APRICOT, SKY, GOLD]
const INITIALS = 'PMAJSKRLNTBEDYOHGCVWFUIZ'

export function Crowd({ beat, spb }: Clock) {
  if (beat < GRID_IN[0] || beat > CONTRACT[1] + 0.2) return null
  const contract = span(beat, CONTRACT[0], CONTRACT[1], easeIn)
  const zips = Array.from({ length: 10 }, (_, k) => {
    const at = ZIPS[0] + k * 0.85
    const t = span(beat, at, at + 1.4, easeInOut)
    const a = Math.floor(rand(k * 3.1) * COLS * ROWS)
    const b = Math.floor(rand(k * 7.7 + 1) * COLS * ROWS)
    return { t, from: avatar(a), to: avatar(b === a ? (a + 5) % (COLS * ROWS) : b) }
  })
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - span(beat, CONTRACT[1] - 0.4, CONTRACT[1]) }}>
      <Glow x={CX} y={CY - 120} r={760} color={BLUE_SOFT} opacity={0.5} />
      {Array.from({ length: COLS * ROWS }, (_, i) => {
        const [x, y] = avatar(i)
        const a = arrive(beat, GRID_IN[0] + 0.3 + Math.hypot(x - CX, y - CY) / 900, spb, 13, 0.65)
        const px = lerp(x, CX, contract)
        const py = lerp(y, CY - 20, contract)
        const pulse = zips.some((z) => z.t > 0.9 && z.t < 1 && z.to[0] === x && z.to[1] === y) ? 1.15 : 1
        const r = AV * clamp(a) * lerp(1, 0.4, contract) * pulse
        return (
          <div key={i} style={{ position: 'absolute', left: px - r, top: py - r, width: r * 2, height: r * 2, borderRadius: '50%', background: AV_COLORS[i % AV_COLORS.length], display: 'grid', placeItems: 'center', fontFamily: SANS, fontWeight: 900, fontSize: r * 0.8, color: INK, boxShadow: '0 6px 0 rgba(20,40,75,.12)' }}>
            {INITIALS[i % INITIALS.length]}
          </div>
        )
      })}
      {zips.map((z, k) => (z.t > 0 && z.t < 1 && contract < 0.2 ? (() => { const [x, y] = arc(z.from, z.to, z.t, 120); return <Coin key={k} x={x} y={y} r={22} /> })() : null))}
    </div>
  )
}

// ── 10 · End: Bilby asleep, money safe → the icon → the name ───────────────────────────────

export function End({ beat, spb }: Clock) {
  if (beat < CONTRACT[1] - 0.6) return null
  const sleep = arrive(beat, CONTRACT[1] - 0.6, spb, 11, 0.7)
  const ink = span(beat, INK_AT[0], INK_AT[1], easeInOut)
  const toIcon = span(beat, TO_ICON[0], TO_ICON[1], expoInOut)
  const hit = HITS.reduce((m, h) => Math.max(m, beat >= h ? Math.exp(-(beat - h) * 6) : 0), 0)
  const name = arrive(beat, LOGO, spb, 12, 0.7)
  return (
    <>
      {beat < INK_AT[1] + 0.2 && (
        <div style={{ position: 'absolute', left: CX - 1400 * ink, top: CY - 1400 * ink, width: 2800 * ink, height: 2800 * ink, borderRadius: '50%', background: INK }} />
      )}
      <Bilby pose="sleeping" x={CX} y={CY - 20 - toIcon * 100} h={lerp(420, 200, toIcon) * clamp(sleep)} opacity={clamp(sleep * 2) * (1 - toIcon)} />
      <Glow x={CX} y={CY - 120} r={520} color={BLUE} opacity={0.35 * toIcon} />
      <AppIcon x={CX} y={CY - 120} size={300 * (1 + 0.06 * hit)} opacity={toIcon} />
      <div style={{ position: 'absolute', left: CX, top: CY + 120, transform: `translate(-50%, -50%) translateY(${(1 - name) * 30}px)`, opacity: clamp(name), fontFamily: DISPLAY, fontSize: 110, color: PAPER, whiteSpace: 'nowrap' }}>
        Bilby<span style={{ color: BLUE_SOFT }}>Pay</span>
      </div>
      {beat > CTA && (
        <div style={{ position: 'absolute', left: CX, top: 1030, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: SANS, fontWeight: 700, fontSize: 24, color: SKY, opacity: 0.8 * span(beat, CTA, CTA + 0.6) }}>
          Beta on Monad testnet. Test money only. Not audited.
        </div>
      )}
    </>
  )
}

/** The background under each moment: night for the problem, paper with Bilby, ink at the end. */
export function backgroundAt(beat: number) {
  if (beat < PAPER_AT) return NIGHT
  if (beat < INK_AT[1]) return PAPER
  return INK
}

// ── Every line of type ──────────────────────────────────────────────────────────────────────

export function Words({ beat }: Clock) {
  return (
    <>
      <Caption beat={beat} at={PROMISE_IN} out={TO_PHONE[0]} y={900} size={72} words={['Your number is your', { accent: 'wallet.' }]} />
      <Caption beat={beat} at={SENT + 1.5} out={LIFT[0]} x={1390} y={200} size={56} words={['Lands in about', { accent: '2 seconds.' }]} />
      <Caption beat={beat} at={BUBBLES + 0.5} out={RETURN[0] - 0.5} y={990} size={60} words={['Send to', { accent: 'anyone.' }]} />
      <Caption beat={beat} at={FLIP[1]} out={TO_HOLE[0]} y={990} size={60} words={['Gifts, delivered by', { accent: 'text.' }]} />
      <Caption beat={beat} at={HOP[0] - 1} out={PAY_BTN - 0.6} y={150} size={60} words={['Your savings', { accent: 'burrow.' }]} />
      <Caption beat={beat} at={PULL[1]} out={GRID_IN[0]} y={930} size={72} words={['No seed', { accent: 'phrase.' }]} />
      <Caption beat={beat} at={GRID_IN[1]} out={CONTRACT[0]} y={960} size={64} words={['Final in', { accent: '0.6 s' }, '· under 1¢ a payment']} />
      <Caption beat={beat} at={LOGO + 0.6} out={CTA - 0.4} y={890} size={66} color={PAPER} accent={BLUE_SOFT} words={['Money that just', { accent: 'works.' }]} />
      <Caption beat={beat} at={CTA} out={SECTION.out + 2} y={890} size={56} color={PAPER} accent={BLUE_SOFT} words={['Try the beta ·', { accent: 'bilbypay.pages.dev' }]} />
    </>
  )
}

export { expoOut, easeOut }
