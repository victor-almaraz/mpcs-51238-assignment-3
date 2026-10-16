'use client';

import { useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Toggle from '@/components/ui/Toggle';
import StoredAudio from './StoredAudio';
import PresetList from '@/components/presets/PresetList';
import { errorText, sectionHeading } from '@/design-systems/industrial/classes';
import {
  getRemember,
  getSettings,
  getSettingsError,
  setRemember,
  subscribeSettings,
  updateSettings,
} from '@/lib/settings/store';
import {
  STORAGE_QUOTA_BYTES,
  STORAGE_WARNING_BYTES,
  estimateUsage,
  subscribe as subscribeStorage,
} from '@/lib/storage/storage';

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

/** Saved settings and estimated storage use (assignment-3-scope.md, /settings). */
export default function SettingsPanel() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, () => null);
  const remember = useSyncExternalStore(subscribeSettings, getRemember, () => true);
  const settingsError = useSyncExternalStore(subscribeSettings, getSettingsError, () => null);
  const usage = useSyncExternalStore(subscribeStorage, estimateUsage, () => null);

  return (
    <>
      <Card as="section" aria-labelledby="settings-saved">
        <h2 id="settings-saved" className={sectionHeading}>
          Saved settings
        </h2>
        <p className="text-sm">
          Master volume, keyboard octave, default export format, metronome and the volume notice choice.
        </p>
        <div>
          <Toggle pressed={remember} onClick={() => setRemember(!remember)}>
            Remember settings on this device
          </Toggle>
        </div>
        {settingsError ? (
          <p role="alert" className={errorText}>
            {settingsError}
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <div>
            <Button
              disabled={!settings?.volumeNoticeDismissed}
              onClick={() => updateSettings({ volumeNoticeDismissed: false })}
            >
              Show the volume notice again
            </Button>
          </div>
          <p className="text-sm text-muted">
            {settings?.volumeNoticeDismissed
              ? 'The volume notice is turned off on this device.'
              : 'The volume notice shows before the first sound of each visit.'}
          </p>
        </div>
      </Card>

      <Card as="section" aria-labelledby="settings-storage">
        <h2 id="settings-storage" className={sectionHeading}>
          Storage
        </h2>
        {usage === null ? null : (
          <p>
            Projects, presets and settings use about {kib(usage)} of {mib(STORAGE_QUOTA_BYTES)} browser storage.
          </p>
        )}
        {usage !== null && usage > STORAGE_WARNING_BYTES ? (
          <p role="alert" className={errorText}>
            Browser storage is nearly full. Save .wrack files, then delete unused projects.
          </p>
        ) : null}
      </Card>

      <PresetList />

      <StoredAudio />
    </>
  );
}
