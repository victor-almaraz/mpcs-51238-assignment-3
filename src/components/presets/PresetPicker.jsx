'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import { getPresets, subscribePresets } from '@/lib/presets/store';
import SavePresetDialog from './SavePresetDialog';

const DEFAULTS = '__defaults';
const EMPTY = [];

/**
 * Preset picker for one instrument or effect device: "My presets" (the
 * library's presets of this type) above the built-in settings, and "Save
 * preset". `onApply(preset)` receives a library preset, or null for the
 * built-in defaults. `label` names the picker ("Delay preset" inside a chain)
 * and its Save button ("Save Delay preset").
 */
export default function PresetPicker({ kind, device, onApply, disabled, label = 'Preset' }) {
  const all = useSyncExternalStore(subscribePresets, getPresets, () => EMPTY);
  const mine = all.filter((p) => p.type === device.type);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const saveRef = useRef(null);

  const options = [
    { value: '', label: 'Choose a preset…' },
    ...(mine.length > 0 ? [{ group: 'My presets', options: mine.map((p) => ({ value: p.id, label: p.name })) }] : []),
    { group: 'Built-in', options: [{ value: DEFAULTS, label: 'Default settings' }] },
  ];

  function choose(value) {
    if (!value) return;
    if (value === DEFAULTS) {
      onApply(null);
      setMessage('Applied Default settings');
      return;
    }
    const preset = mine.find((p) => p.id === value);
    if (!preset) return;
    onApply(preset);
    setMessage(`Applied ${preset.name}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select id={`preset-${device.id}`} label={label} value="" options={options} disabled={disabled} onChange={choose} />
      <Button ref={saveRef} size="sm" disabled={disabled} aria-label={label === 'Preset' ? undefined : `Save ${label}`} onClick={() => setSaving(true)}>
        Save preset
      </Button>
      <StatusRegion visuallyHidden>{message}</StatusRegion>
      <SavePresetDialog
        open={saving}
        kind={kind}
        device={device}
        returnFocusRef={saveRef}
        onClose={() => setSaving(false)}
        onSaved={(preset) => {
          setSaving(false);
          setMessage(`Saved preset ${preset.name}`);
        }}
      />
    </div>
  );
}
