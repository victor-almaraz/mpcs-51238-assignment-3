'use client';

import { Fragment, groupHeading, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import Field from '@/components/ui/Field';
import Select from '@/components/ui/Select';
import Slider from '@/components/ui/Slider';
import IconToggle from '@/components/ui/IconToggle';
import { faderText } from '@/components/mixer/TrackStrip';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { dbToGain, gainToDb } from '@/dsp/core/math';
import {
  CLIP_GAIN_MAX_DB,
  CLIP_GAIN_MIN_DB,
  COLORS,
  DEFAULT_AUDIO_RATE,
  addEnvelopePoint,
  audioTempo,
  removeEnvelopePoint,
  renameClip,
  setClipColor,
  setClipGain,
  setEnvelopePoint,
  setFade,
  visibleEnvelope,
} from '@/lib/project/clip-commands';

const CURVES = [
  { value: 'linear', label: 'Linear' },
  { value: 'equalPower', label: 'Equal power' },
  { value: 'exp', label: 'Exponential' },
];
/** Longest fade the sliders offer, ms. */
const MAX_FADE_MS = 30000;
/** Envelope point gain range, dB; the minimum means −∞. */
const POINT_MIN_DB = -60;
const POINT_MAX_DB = 6;

const msText = (ms) => `${Math.round(ms)} ms`;
/** Slider column: every slider of the card shares this width, so the rows line up. */
const ROWS = 'grid grid-cols-[minmax(0,22rem)_auto] items-center gap-x-4 gap-y-2';

/** "1:02.500" for a frame count at `rate`. */
function timeText(frames, rate) {
  const s = frames / rate;
  const m = Math.floor(s / 60);
  return `${m}:${(s - 60 * m).toFixed(3).padStart(6, '0')}`;
}

/**
 * Properties of one clip (the clip properties panel): name, colour and mute;
 * for audio clips also the storage status, clip gain, fades with curves and
 * the gain envelope (the points inside the clip; points outside it anchor
 * segments that cross its edges). The card is as wide as its controls: the
 * sliders share one column, the curve menus and point buttons another.
 * Every change goes through the clip
 * commands; point rows are keyed by point ID, so a slider keeps focus while
 * its point moves.
 */
export default function ClipProperties({ project, clip, status, editCursor, onEdit, readOnly, nameRef }) {
  const [name, setName] = useState(clip.name);
  const [nameError, setNameError] = useState(null);
  const [lastClip, setLastClip] = useState(clip);
  if (lastClip.id !== clip.id || lastClip.name !== clip.name) {
    setLastClip(clip);
    setName(clip.name);
    setNameError(null);
  }
  const rate = project.audioRate ?? DEFAULT_AUDIO_RATE;
  const toMs = (frames) => (frames / rate) * 1000;
  const toFrames = (ms) => Math.round((ms / 1000) * rate);
  const apply = (result) => {
    if (result.ok) onEdit(result.doc);
  };

  function commitName() {
    if (name === clip.name) return;
    const result = renameClip(project, clip.id, name);
    if (result.ok) {
      setNameError(null);
      onEdit(result.doc);
    } else setNameError(result.error.message);
  }

  const audio = clip.kind === 'audio';
  const lengthMs = audio ? toMs(clip.sourceLength) : 0;
  const cursorFrame = audio ? audioTempo(project).frameAt(editCursor) - audioTempo(project).frameAt(clip.start) : -1;
  const cursorInside = cursorFrame >= 0 && cursorFrame < clip.sourceLength;
  const id = `clip-${clip.id}`;
  const points = audio ? visibleEnvelope(clip) : [];

  return (
    <section aria-labelledby={`${id}-heading`} className="flex w-fit max-w-full flex-col gap-3 rounded-ds border border-border-strong bg-surface p-3">
      <h3 id={`${id}-heading`} className={groupHeading}>
        Clip properties: {clip.name}
      </h3>
      {audio ? <p className="text-sm">{status}</p> : null}
      <Field
        id={`${id}-name`}
        ref={nameRef}
        label="Clip name"
        className="max-w-[22rem]"
        value={name}
        error={nameError}
        disabled={readOnly}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName();
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          id={`${id}-color`}
          label="Clip colour"
          value={COLORS.some((c) => c.value === clip.color) ? clip.color : ''}
          options={[{ value: '', label: 'Track colour' }, ...COLORS]}
          disabled={readOnly}
          onChange={(value) => onEdit(value ? setClipColor(project, clip.id, value).doc : { ...project, clips: { ...project.clips, [clip.id]: { ...clip, color: undefined } } })}
        />
        <IconToggle icon="volume-x" label="Mute clip" pressed={clip.muted} disabled={readOnly} onClick={() => onEdit({ ...project, clips: { ...project.clips, [clip.id]: { ...clip, muted: !clip.muted } } })} />
      </div>
      {audio ? (
        <>
          <div className={ROWS}>
            <Slider
              id={`${id}-gain`}
              className="col-start-1"
              label="Clip gain"
              min={CLIP_GAIN_MIN_DB}
              max={CLIP_GAIN_MAX_DB}
              step={0.5}
              value={clip.gainDb}
              valueText={faderText(clip.gainDb)}
              disabled={readOnly}
              onChange={(db) => apply(setClipGain(project, clip.id, db))}
              onReset={() => apply(setClipGain(project, clip.id, 0))}
            />
            {['fadeIn', 'fadeOut'].map((which) => {
              const label = which === 'fadeIn' ? 'Fade-in' : 'Fade-out';
              const fade = clip[which];
              return (
                <Fragment key={which}>
                  <Slider
                    id={`${id}-${which}`}
                    className="col-start-1"
                    label={`${label} length`}
                    min={0}
                    max={Math.max(1, Math.min(MAX_FADE_MS, Math.floor(lengthMs)))}
                    step={1}
                    value={Math.round(toMs(fade.length))}
                    valueText={msText(toMs(fade.length))}
                    disabled={readOnly}
                    onChange={(ms) => apply(setFade(project, clip.id, which, toFrames(ms), fade.curve))}
                    onReset={() => apply(setFade(project, clip.id, which, 0, fade.curve))}
                  />
                  <Select
                    id={`${id}-${which}-curve`}
                    label={`${label} curve`}
                    value={fade.curve}
                    options={CURVES}
                    disabled={readOnly}
                    onChange={(curve) => apply(setFade(project, clip.id, which, fade.length, curve))}
                  />
                </Fragment>
              );
            })}
          </div>
          <section aria-labelledby={`${id}-env`} className="flex flex-col gap-2">
            <h4 id={`${id}-env`} className={groupHeading}>
              Gain envelope
            </h4>
            {points.length === 0 ? <p className="text-sm">No envelope points. The clip plays at its clip gain.</p> : null}
            <ol className="flex flex-col gap-2">
              {points.map((point, i) => {
                const db = point.gain <= dbToGain(POINT_MIN_DB) ? POINT_MIN_DB : gainToDb(point.gain);
                return (
                  <li key={point.id ?? i} className={ROWS}>
                    <Slider
                      id={`${id}-pt${i}-time`}
                      className="col-start-1"
                      label={`Point ${i + 1} time`}
                      min={0}
                      max={Math.max(1, Math.floor(lengthMs))}
                      value={Math.round(toMs(point.frame))}
                      valueText={timeText(point.frame, rate)}
                      disabled={readOnly}
                      onChange={(ms) => apply(setEnvelopePoint(project, clip.id, point.id, toFrames(ms), point.gain))}
                    />
                    <Slider
                      id={`${id}-pt${i}-gain`}
                      className="col-start-1"
                      label={`Point ${i + 1} gain`}
                      min={POINT_MIN_DB}
                      max={POINT_MAX_DB}
                      step={0.5}
                      value={Math.round(db * 2) / 2}
                      valueText={faderText(db)}
                      disabled={readOnly}
                      onChange={(v) => apply(setEnvelopePoint(project, clip.id, point.id, point.frame, v <= POINT_MIN_DB ? 0 : dbToGain(v)))}
                    />
                    <IconButton icon="x" label={`Remove point ${i + 1}`} size="sm" className="col-start-2 row-start-1 justify-self-start" disabled={readOnly} onClick={() => apply(removeEnvelopePoint(project, clip.id, point.id))} />
                  </li>
                );
              })}
            </ol>
            <div>
              <IconButton icon="plus" label="Add point at edit cursor" disabled={readOnly || !cursorInside} onClick={() => apply(addEnvelopePoint(project, clip.id, cursorFrame, 1))} />
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
