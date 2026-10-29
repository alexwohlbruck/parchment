export interface SoundBeat {
  start: number
  end: number
}

function noise(context: AudioContext, seconds: number) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const source = context.createBufferSource()
  source.buffer = buffer
  return source
}

function envelope(context: AudioContext, at: number, peak: number, attack: number, release: number) {
  const gain = context.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(peak, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release)
  return gain
}

/** A rising whir under the unfold, a paper snap as each fold lands, and a soft chime at the end. Times in ms. */
export function playUnfoldSound(beats: SoundBeat[], duration: number) {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return () => {}
  const context = new AudioContextClass()
  const master = context.createGain()
  master.gain.value = 0.5
  master.connect(context.destination)
  const t0 = context.currentTime + 0.02
  const total = duration / 1000

  const whir = noise(context, total)
  const band = context.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 2.2
  band.frequency.setValueAtTime(300, t0)
  band.frequency.exponentialRampToValueAtTime(2600, t0 + total * 0.85)
  const whirGain = envelope(context, t0, 0.22, total * 0.55, total * 0.45)
  whir.connect(band).connect(whirGain).connect(master)
  whir.start(t0)

  const hum = context.createOscillator()
  hum.type = 'sawtooth'
  hum.frequency.setValueAtTime(70, t0)
  hum.frequency.exponentialRampToValueAtTime(260, t0 + total * 0.85)
  const hush = context.createBiquadFilter()
  hush.type = 'lowpass'
  hush.frequency.value = 600
  const humGain = envelope(context, t0, 0.05, total * 0.6, total * 0.4)
  hum.connect(hush).connect(humGain).connect(master)
  hum.start(t0)
  hum.stop(t0 + total)

  for (const beat of beats) {
    const at = t0 + (beat.start + (beat.end - beat.start) * 0.6) / 1000
    const snap = noise(context, 0.12)
    const tone = context.createBiquadFilter()
    tone.type = 'bandpass'
    tone.frequency.value = 1500 + Math.random() * 600
    tone.Q.value = 0.9
    snap.connect(tone).connect(envelope(context, at, 0.35, 0.004, 0.09)).connect(master)
    snap.start(at)
  }

  const end = t0 + (beats[beats.length - 1]?.end ?? duration) / 1000
  for (const [i, frequency] of [523.25, 659.25, 783.99].entries()) {
    const chime = context.createOscillator()
    chime.type = 'sine'
    chime.frequency.value = frequency
    chime.connect(envelope(context, end + i * 0.06, 0.05, 0.03, 1.4)).connect(master)
    chime.start(end + i * 0.06)
    chime.stop(end + 1.6)
  }

  const close = setTimeout(() => context.close(), duration + 2000)
  return () => {
    clearTimeout(close)
    context.close().catch(() => {})
  }
}
