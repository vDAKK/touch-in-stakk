# Auto-harvest (mule farming) — detection notes

Defensive reference for recognising an autonomous resource-farming client on
Dofus Touch. Written to build **detection**, not a bot. The launcher ships an
inert honeypot toggle (see [game.js](../../src/preload/game.js) `setAutoHarvest`)
whose only job is to fire a flag when someone tampers the client to enable it —
it sends no game traffic and harvests nothing.

## What Retouch's `__muleInteractive` does (RE summary)

The mule feature has two halves, both autonomous:

1. **Travel** — `crossBorder(...)`: computes an exit cell toward a target map and
   walks the character across map borders on its own (BFS over the map graph),
   independent of any group. Distinct from the game's native *grouped* party
   follow, which is server-mediated and legitimate for multibox.
2. **Harvest** — collects every interactive (resource) on the current map without
   user input, then advances to the next map.

## Protocol signature (client → server)

A harvest cycle produces this message sequence, per resource, at machine cadence:

- `MapInformationsRequestMessage` — on each map change (also normal play).
- `GameMapMovementRequestMessage` — path to the resource cell (also normal play).
- `InteractiveUseRequestMessage { elemId, skillInstanceUid }` — **the tell.** Use
  a specific interactive with a specific skill.
- server: `InteractiveUsedMessage` / `InteractiveUseEndedMessage`, or
  `InteractiveUseErrorMessage` on failure.

None of these messages is individually abnormal — a human harvests too. The
signal is in the **pattern**, not the message.

## Server / telemetry signals to flag

- **Cadence regularity**: inter-`InteractiveUseRequestMessage` intervals with very
  low variance (a human varies; a loop does not). Flag low coefficient of
  variation over a sliding window.
- **Zero idle**: continuous harvest+move with no pauses, chat, or UI window opens
  over long spans (hours).
- **Border-cross precision**: repeated exits on the exact optimal border cell with
  no wandering, map after map, 24/7.
- **No confirmation latency**: `InteractiveUseRequestMessage` firing before any
  plausible human reaction time after `InteractiveUsedMessage`/arrival.
- **Session length + volume**: harvest counts per hour beyond human ceilings,
  sustained across a full day.
- **Multi-account lockstep**: several accounts from one machine/IP harvesting on
  correlated paths (combine with the machine-id fingerprint).

## Client-side tripwire (this launcher)

`setAutoHarvest(true)` is inert but, on enable, captures `{ mapId, cellId,
interactiveCount }` and emits `honeypot-trip`; the renderer records a
`security:flag` with the account and location. Reaching the toggle requires the
hidden admin menu (`Ctrl+Shift+Alt+A`) or client tampering — either way, enabling
it is deliberate. The flag + machine-id is the ban dossier; harvesting never
happens.
