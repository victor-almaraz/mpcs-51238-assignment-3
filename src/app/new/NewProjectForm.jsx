'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import TimeSignatureSelect from '@/components/transport/TimeSignatureSelect';
import useHydrated from '@/components/ui/useHydrated';
import { errorText } from '@/design-systems/industrial/classes';
import { DEFAULT_TEMPO, DEFAULT_TIME_SIGNATURE, nextUntitledName } from '@/lib/project/model';
import { createProject, getIndexSnapshot, listProjects, subscribeProjects } from '@/lib/project/store';
import { validateProjectName, validateNewProject, validateTempo } from '@/lib/project/validate';

const VALIDATORS = { name: validateProjectName, tempo: validateTempo };

/**
 * New project form (assignment-3-scope.md, New project form). Validates on
 * submit and on blur of an edited field; errors keep the entered values. A valid
 * submit saves the project and opens it.
 */
export default function NewProjectForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const indexRaw = useSyncExternalStore(subscribeProjects, getIndexSnapshot, () => null);
  const defaultName = useMemo(() => {
    const listed = indexRaw === null ? { ok: true, value: [] } : listProjects();
    return nextUntitledName(listed.ok ? listed.value.map((e) => e.name) : []);
  }, [indexRaw]);

  const [name, setName] = useState(null); // null until edited: shows the prefilled default
  const [tempo, setTempo] = useState(String(DEFAULT_TEMPO));
  const [timeSignature, setTimeSignature] = useState(DEFAULT_TIME_SIGNATURE);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [edited, setEdited] = useState({}); // field → true once the user changed it
  const nameRef = useRef(null);
  const tempoRef = useRef(null);

  const values = { name: name ?? defaultName, tempo };

  const setters = { name: setName, tempo: setTempo };

  function handleChange(e) {
    const field = e.target.name;
    setEdited((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
    setters[field](e.target.value);
  }

  /*
   * A pointer press on the submit button blurs the focused field before the
   * click. Validating that blur would insert an error above the button, move it
   * and lose the click, so blur validation waits; submit validates every field.
   */
  const submitPressed = useRef(false);

  function handleSubmitPointerDown() {
    submitPressed.current = true;
    window.addEventListener('pointerup', () => (submitPressed.current = false), { once: true });
  }

  function handleBlur(e) {
    const field = e.target.name;
    if (submitPressed.current || !edited[field]) return;
    const error = VALIDATORS[field](values[field]);
    setErrors((prev) => ({ ...prev, [field]: error ?? undefined }));
  }

  function submit(e) {
    e.preventDefault();
    setSubmitError(null);
    const result = validateNewProject({ ...values, timeSignature });
    if (!result.ok) {
      setErrors(result.errors);
      (result.errors.name ? nameRef : tempoRef).current?.focus();
      return;
    }
    setErrors({});
    const created = createProject(result.value);
    if (!created.ok) {
      setSubmitError(created.error);
      return;
    }
    router.push(`/projects/${created.value.id}`);
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-5">
      <fieldset disabled={!hydrated} className="contents">
      <Field
        ref={nameRef}
        id="project-name"
        name="name"
        label="Name"
        autoComplete="off"
        value={values.name}
        onChange={handleChange}
        onBlur={handleBlur}
        error={errors.name}
      />
      <Field
        ref={tempoRef}
        id="project-tempo"
        name="tempo"
        label="Tempo (BPM)"
        inputMode="numeric"
        autoComplete="off"
        value={tempo}
        onChange={handleChange}
        onBlur={handleBlur}
        error={errors.tempo}
      />
      <TimeSignatureSelect id="project-time-signature" layout="stacked" value={timeSignature} onChange={setTimeSignature} />
      {submitError ? (
        <p role="alert" className={errorText}>
          <span aria-hidden="true">▲</span>
          <span>{submitError}</span>
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="lg" onPointerDown={handleSubmitPointerDown}>
          Create project
        </Button>
      </div>
      </fieldset>
    </form>
  );
}
