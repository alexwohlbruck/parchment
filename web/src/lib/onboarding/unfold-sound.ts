export interface SoundBeat {
  start: number
  end: number
}

const BELL_PARTIALS = [
  { ratio: 1, level: 1, decay: 4.5 },
  { ratio: 2.01, level: 0.45, decay: 3.2 },
  { ratio: 2.76, level: 0.3, decay: 2.4 },
  { ratio: 5.43, level: 0.12, decay: 1.4 },
]

/** A soft swell through the unfold that resolves into a shimmering bell as the map lands. Times in ms. */
export function playUnfoldSound(beats: SoundBeat[], duration: number) {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  const t0 = context.currentTime + 0.03
  const land = t0 + (beats[beats.length - 1]?.end ?? duration) / 1000

  const master = context.createGain()
  master.gain.value = 0.22
  master.connect(context.destination)

  const shimmer = context.createDelay(1)
  shimmer.delayTime.value = 0.27
  const feedback = context.createGain()
  feedback.gain.value = 0.48
  const damp = context.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 2800
  shimmer.connect(damp).connect(feedback).connect(shimmer)
  const wet = context.createGain()
  wet.gain.value = 0.5
  damp.connect(wet).connect(master)

  const voice = (frequency: number, at: number, level: number, attack: number, decay: number, detune = 0) => {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = frequency
    osc.detune.value = detune
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(level, at + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    osc.connect(gain)
    gain.connect(master)
    gain.connect(shimmer)
    osc.start(at)
    osc.stop(at + attack + decay + 0.1)
  }

  const swell = land - t0
  for (const [frequency, detune] of [[440, -6], [440, 6], [659.25, 0], [880, 3]] as const) {
    voice(frequency, t0, 0.07, swell * 0.8, swell * 0.6 + 0.8, detune)
  }
  for (const root of [880, 1318.5]) {
    for (const partial of BELL_PARTIALS) {
      voice(root * partial.ratio, land + (root > 1000 ? 0.09 : 0), 0.16 * partial.level, 0.005, partial.decay)
    }
  }

  setTimeout(() => context.close(), duration + 6000)
}
