'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import { errorText } from '@/design-systems/industrial/classes';
import { savePreset } from '@/lib/presets/store';
import { MAX_PRESET_NAME } from '@/lib/presets/validate';
import { typeLabel } from './labels';

/**
 * Save preset dialog (assignment-3-scope.md, Presets): one Name field with
 * the scope's rules; on error the entered name stays and the message is
 * linked to the field. `device` supplies kind, type, params and a sampler zone.
 */
export default function SavePresetDialog({ open, kind, device, onClose, onSaved, returnFocusRef }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const inputRef = useRef(null);
  const label = typeLabel(kind, device.type);
  const fieldId = `save-preset-${device.id}-name`;

  function close() {
    setName('');
    setError(null);
    setFormError(null);
    onClose();
  }

  function submit(e) {
    e.preventDefault();
    const result = savePreset({ name, kind, type: device.type, typeLabel: label, params: device.params, sampler: device.sampler ?? undefined });
    if (result.ok) {
      setName('');
      setError(null);
      setFormError(null);
      onSaved(result.preset);
      return;
    }
    if (result.error.field === 'name') {
      setError(result.error.message);
      setFormError(null);
    } else setFormError(result.error.message);
    inputRef.current?.focus();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Save ${label} preset`}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          id={fieldId}
          ref={inputRef}
          label="Name"
          description={`1 to ${MAX_PRESET_NAME} characters, unique among ${label} presets.`}
          value={name}
          error={error}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        {formError ? (
          <p role="alert" className={errorText}>
            {formError}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save preset
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
