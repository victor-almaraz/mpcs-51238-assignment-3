# Mixer and routing

## Signal path
Every track feeds the master bus directly (`src/dsp/engine/engine.js`, `src/dsp/mixer/mixer.js`).

1. Source: the instrument (MIDI clips and live input) or the audio clips
2. Insert effects, up to eight, in `deviceIds` order after the instrument
3. Fader (`gainDb`)
4. Pan
5. Mute and solo gate, smoothed over 5 ms
6. Track meter
7. Master bus

The master path is: master bus → master effects → metronome click → master volume → master pan → master meter → safety stage (limiter last, `audio-safety.md`).

Buses and sends are out of scope (`assignment-3-scope.md`). Track records carry the `output`, `sendIds` and `soloSafe` fields of the project model (`project-model.md`); the engine does not read `sendIds` or `soloSafe`.

## Levels
| Control | Range | Default | Stored in |
|---|---|---|---|
| Track fader | −∞ to +6 dB; the −60 dB minimum is silence and reads "−∞ dB"; 0.1 dB steps (project limit) | 0 dB | Project |
| Master volume | −60 to 0 dB (`audio-safety.md`) | −12 dB | Saved settings |
| Pan, tracks and master | −1 (full left) to +1 (full right), 0.01 steps | 0 | Project |

Gain and the gate are smoothed per sample. Pan is smoothed, and its gains are computed once per block.

## Pan law
| Source | Law |
|---|---|
| Mono, no insert effects | Constant power: θ = (p + 1)·π/4, L = cos θ, R = sin θ; centre is −3.01 dB per side |
| Mono, with insert effects | Enters the stereo chain at −3.01 dB per side; the strip pans by balance |
| Stereo | Balance: p < 0 scales R by (1 + p); p > 0 scales L by (1 − p); centre is unity |
| Master | Balance, as for stereo sources |

## Solo
Solo is solo-in-place. A track is audible when it is not muted and either no track is soloed or it is soloed.

## Metering
| Meter | Definition |
|---|---|
| Engine readings | Sample peak and mean square per channel over each report window, for every track and the master, after the strip; posted with each position report as a `Float32Array` of `[peakL, peakR, meanSquareL, meanSquareR]` per track, master last (`src/dsp/mixer/meter.js`) |
| Master level | Post-limiter peaks and the limiter's gain, from the safety node (`getMasterLevel()`: `{ peakL, peakR, reduction }`) |
| Displayed peak | Per channel; 1.5 s hold; 20 dB/s fall (project limits), applied in the UI (`src/components/ui/Meter.jsx`) |

Loudness (LUFS) and true-peak meters are not implemented.

## Mixer panel
The `Mixer` tab of the dock shows one vertical strip per track, side by side and scrolling sideways, and the master strip separated at the right (`src/components/mixer/`).

| Strip | Top to bottom |
|---|---|
| Track (`TrackStrip.jsx`) | Pan knob ("C", "L20", "R20"); fader with its dB scale beside the stereo peak meter; dB readout ("−6.0 dB"); `M`, `S` and the clip indicator in one row; track name. The strip's top edge carries the track colour. |
| Master (`MasterStrip.jsx`) | Master pan knob; limiter readout; master volume fader beside the post-limiter meter; dB readout in an amber window; "Master" |

### Faders
- A fader (`src/components/ui/Fader.jsx`) is a vertical track and cap over a visually hidden native range input with `aria-orientation="vertical"`, named "Bass volume" or "Master volume", with value text such as "−6.0 dB".
- The scale follows a square taper (`src/components/ui/level-scale.js`), so the upper range (+6 to −12 dB) has most of the travel. Marks at +6, 0, −6, −12, −24 and −∞ appear where they fall in the range.
- Vertical drag moves the cap (Shift for fine steps); a click on the track jumps there; double-click or Delete resets. Arrows step, Page Up and Page Down move 10 % of the range, Home and End go to the ends.

### Meter scale
The peak meter beside a fader is given the fader's range (`scale={[min, max]}`) and uses the same taper, so a level and the scale mark of the same dB sit at the same height and 0 dBFS is level with the 0 mark. Track meters span −60 to +6 dB; the master meter spans −60 to 0 dB. A meter without a scale (the transport's master meter) runs linearly from −60 to 0 dBFS. Meters are hidden from the accessibility tree.

### Clip indicator
The clip indicator latches when either channel's peak passes 0 dBFS and stays lit until pressed. While lit it is a red `Clip` button, "Clear clip indicator, Bass clipped", and "Bass clipped" is announced once per latch. Clearing it moves focus to the strip's fader. While unlit it is a muted "Clip" label hidden from the accessibility tree.

### Limiter readout
The master strip shows the safety limiter's gain reduction as "Limiter −3.2 dB" while it exceeds 0.5 dB. The deepest reduction holds for 1 s before a lighter one replaces it; the readout is empty otherwise. It is hidden from the accessibility tree; the master chain's safety limiter group in the `Devices` tab carries the reduction in its name, "Safety limiter, always on, gain reduction 0 dB" (`design-patterns.md`, `SAFE-02`).

### Pan knob
The pan knob (`PanKnob.jsx`) is named "Bass pan" or "Master pan" and speaks "Left 20", "Centre" or "Right 20". Typed values accept "L20", "R5", "C", "Left 20" or a bare number on the 0–100 scale. Delete or double-click centres it.

## Sources
- ITU-R BS.1770-5 — https://www.itu.int/rec/R-REC-BS.1770
- EBU R 128 — https://tech.ebu.ch/publications/r128
