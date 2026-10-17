'use client';

import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import { cx, fieldLabel, focusRing, panelShadow } from '@/design-systems/industrial/classes';
import { getEngine } from '@/lib/audio/engine-client';
import { applyPreset, getPresets, presetLabel, subscribePresets } from '@/lib/presets/store';
import ProjectContext from './ProjectContext';
import SavePresetDialog from './SavePresetDialog';

const DEFAULTS = '__defaults';
const EMPTY = [];

/** One-bar audition phrases (LIB-03), one note per beat. */
const DRUM_PHRASE = [36, 42, 38, 42];
const PITCHED_PHRASE = [60, 64, 67, 72];

/** Picker entries: My presets (when non-empty) above Built-in, each { id, label, group, preset }. */
function entriesFor(mine) {
  return [
    ...mine.map((p) => ({ id: p.id, label: p.name, group: 'My presets', preset: p })),
    { id: DEFAULTS, label: 'Default settings', group: 'Built-in', preset: null },
  ];
}

const matches = (entry, query) => entry.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

/**
 * Preset picker for one instrument or effect device (LIB-01, LIB-03): a
 * combobox over "My presets" (the library's presets of this type) and the
 * built-in settings. Typing filters; Up and Down move through the matches
 * without applying; Enter or a click applies. "Preview" auditions the
 * highlighted preset: a one-bar phrase through the track chain and the
 * safety limiter, with the project left unchanged; it stops on Escape, on
 * another choice and after the bar. `onApply(preset)` receives a library
 * preset, or null for the built-in defaults. `label` names the picker
 * ("Delay preset" inside a chain); `owner` extends the Save button's name
 * ("Save preset: Delay") so it keeps the visible text.
 */
export default function PresetPicker({ kind, device, onApply, disabled, label = 'Preset', owner = null }) {
  const engine = getEngine();
  const project = useContext(ProjectContext);
  const all = useSyncExternalStore(subscribePresets, getPresets, () => EMPTY);
  const mine = all.filter((p) => p.type === device.type);
  const entries = entriesFor(mine);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [highlighted, setHighlighted] = useState(null); // entry id kept after the list closes, for Preview
  const [previewing, setPreviewing] = useState(null); // entry id
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const saveRef = useRef(null);
  const audition = useRef(null); // { timers }
  const projectRef = useRef(project);
  const listId = useId();
  const inputId = `preset-${device.id}`;

  const shown = entries.filter((e) => matches(e, query));
  const current = Math.min(active, Math.max(0, shown.length - 1));
  const target = (open ? shown[current] : null) ?? entries.find((e) => e.id === highlighted) ?? null;

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  function stopPreview() {
    const a = audition.current;
    if (!a) return;
    audition.current = null;
    a.timers.forEach(clearTimeout);
    if (projectRef.current) engine.setProject(projectRef.current);
    setPreviewing(null);
  }

  // A preview ends with the picker and when the device changes.
  useEffect(() => stopPreview, [device.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function startPreview(entry) {
    stopPreview();
    const doc = projectRef.current;
    if (!doc || !doc.devices[device.id]) return;
    const { numerator, denominator } = doc.meter[0];
    const beatMs = (60_000 / doc.tempo[0].bpm) * (4 / denominator);
    const phrase = device.type === 'drums' ? DRUM_PHRASE : PITCHED_PHRASE;
    audition.current = { timers: [] };
    setPreviewing(entry.id);
    // The first audition passes through the volume notice (SAFE-01).
    engine.requestSound(() => {
      const a = audition.current;
      if (!a) return;
      engine.setProject(applyPreset(doc, device.id, entry.preset));
      for (let i = 0; i < numerator; i++) a.timers.push(setTimeout(() => engine.preview(phrase[i % phrase.length], 100), i * beatMs));
      a.timers.push(setTimeout(stopPreview, numerator * beatMs + 300));
    });
  }

  function choose(entry) {
    if (!entry) return;
    stopPreview();
    setOpen(false);
    setQuery('');
    setHighlighted(entry.id);
    onApply(entry.preset);
    setMessage(`Applied ${entry.label}`);
  }

  function move(i) {
    const next = Math.max(0, Math.min(shown.length - 1, i));
    setActive(next);
    if (shown[next]) setHighlighted(shown[next].id);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      move(current + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(shown[current]);
    } else if (e.key === 'Escape') {
      if (open || audition.current) e.preventDefault();
      stopPreview();
      setOpen(false);
      setQuery('');
    }
  }

  const optionId = (entry) => `${listId}-${entry.id}`;
  const groups = ['My presets', 'Built-in'].map((g) => [g, shown.filter((e) => e.group === g)]).filter(([, list]) => list.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={inputId} className={cx(fieldLabel, 'w-auto')}>
          {label}
        </label>
        <div className="relative">
          <input
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown[current] ? optionId(shown[current]) : undefined}
            autoComplete="off"
            placeholder="Choose a preset…"
            disabled={disabled}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            className={cx('min-h-8 w-48 min-w-0 rounded-ds border border-border-strong bg-surface px-2 text-sm text-fg placeholder:text-muted disabled:opacity-40', focusRing)}
          />
          {open ? (
            <div
              id={listId}
              role="listbox"
              aria-label={`${label} list`}
              className={cx('absolute top-full left-0 z-40 mt-1 flex max-h-64 w-56 flex-col overflow-y-auto rounded-ds border border-border-strong bg-surface p-1 text-sm', panelShadow)}
            >
              {groups.length === 0 ? <p className="px-2 py-1 text-muted">No matching presets.</p> : null}
              {groups.map(([group, list]) => (
                <ul key={group} role="group" aria-labelledby={`${listId}-${group.replace(' ', '-')}`}>
                  <li role="presentation" id={`${listId}-${group.replace(' ', '-')}`} className="px-2 pt-1 text-[0.6875rem] font-bold text-muted uppercase">
                    {group}
                  </li>
                  {list.map((entry) => {
                    const selected = shown[current]?.id === entry.id;
                    return (
                      <li
                        key={entry.id}
                        id={optionId(entry)}
                        role="option"
                        aria-selected={selected}
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerMove={() => move(shown.indexOf(entry))}
                        onClick={() => choose(entry)}
                        className={cx('flex min-h-8 cursor-pointer items-center rounded-ds px-2', selected ? 'bg-selected text-selected-fg' : '')}
                      >
                        {entry.label}
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <Toggle
        size="sm"
        pressed={target !== null && previewing === target.id}
        disabled={disabled || !target || !project}
        aria-label={`${target ? `Preview ${target.label}` : 'Preview a preset'}${owner ? ` for ${owner}` : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (previewing === target.id ? stopPreview() : startPreview(target))}
        data-help="Preview: plays one bar with the highlighted preset at the track's level; nothing changes until you choose it."
      >
        Preview
      </Toggle>
      <Button ref={saveRef} size="sm" disabled={disabled} aria-label={owner ? `Save preset: ${owner}` : undefined} onClick={() => setSaving(true)}>
        Save preset
      </Button>
      <span className="text-sm">Preset: {presetLabel(device) ?? 'none'}</span>
      <StatusRegion visuallyHidden>{message}</StatusRegion>
      <SavePresetDialog
        open={saving}
        kind={kind}
        device={device}
        returnFocusRef={saveRef}
        onClose={() => setSaving(false)}
        onSaved={(preset) => {
          setSaving(false);
          onApply(preset); // the device now uses the saved preset
          setMessage(`Saved preset ${preset.name}`);
        }}
      />
    </div>
  );
}
