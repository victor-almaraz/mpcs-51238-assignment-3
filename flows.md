# User flows

The main task, as one sentence:

> I open an example or start a project → I add notes and clips and play them back → I come back later, and the project opens where I left it.

Each flowchart describes one Wrack user flow. Rounded nodes are entry and exit points, rectangles are screens and actions, diamonds are decisions, and double-bordered nodes link to another flow. Text in curly quotes is interface copy.

## First visit

A first visit is a visit with no Wrack keys in `localStorage`.

```mermaid
flowchart TD
  fv_start(["Open Wrack with no Wrack keys in localStorage"]) --> fv_home["Home (/)<br/>One-sentence description of Wrack<br/>Create, Load, Examples"]
  fv_home --> fv_pick{"Choose a starting point"}
  fv_pick -->|"Example card: Beat, Ambient or Pluck melody"| fv_copy["Create an unsaved copy of the example"]
  fv_pick -->|"“New project”"| fv_create[["Create project"]]
  fv_pick -->|"“Open .wrack file”"| fv_open[["Open a .wrack file"]]
  fv_copy --> fv_editor["Editor (/projects/[id]), transport stopped<br/>Play is the highlighted primary action<br/>“Press Play to hear this example”"]
  fv_editor --> fv_act{"Next action"}
  fv_act -->|"Play"| fv_notice[["Volume notice"]]
  fv_notice --> fv_plays["The example plays"]
  fv_plays --> fv_act
  fv_act -->|"First edit"| fv_saved["Save the copy as the user's project<br/>The example itself never changes"]
  fv_saved --> fv_autosave(["Later edits save 500 ms after the last edit"])
  fv_act -->|"Leave without an edit"| fv_leave(["No project is saved"])
```

## Create project

```mermaid
flowchart TD
  cp_start(["Select “New project” on Home or in the header"]) --> cp_form["New project form (/new)<br/>Name: “Untitled project N”, lowest unused N<br/>Tempo: 120<br/>Time signature: 4/4"]
  cp_form --> cp_edit["Edit the fields"]
  cp_edit -->|"Blur an edited field"| cp_blur{"Field valid?"}
  cp_blur -->|"Yes"| cp_edit
  cp_blur -->|"No"| cp_ferr["Show the error below the field<br/>Set aria-invalid=true and aria-describedby"]
  cp_ferr --> cp_edit
  cp_edit -->|"Submit"| cp_check{"All fields valid?"}
  cp_check -->|"No"| cp_errs["Show each error below its field<br/>Keep the entered values<br/>Focus the first invalid field"]
  cp_errs --> cp_edit
  cp_check -->|"Yes"| cp_store["Write wrack:v1:project:#lt;id#gt; and wrack:v1:index"]
  cp_store --> cp_quota{"Write succeeded?"}
  cp_quota -->|"No: QuotaExceededError"| cp_full["“This device's browser storage is full. Save a .wrack file, then delete unused projects.”<br/>Keep the entered values"]
  cp_full --> cp_edit
  cp_quota -->|"Yes"| cp_editor(["Editor (/projects/[id]) with one empty instrument track<br/>Piano roll with step input on<br/>“Press a key or click the grid to add a note” and the keyboard map<br/>Add › “Audio file…” in the clip toolbar"])
```

| Field | Rule | Error text |
|---|---|---|
| Name | 1–60 characters after trimming | “Enter a project name.” / “Use 60 characters or fewer.” |
| Tempo | Integer 40–240 | “Enter a whole-number tempo from 40 to 240.” |
| Time signature | 2/4, 3/4, 4/4 or 6/8 | — |

## Return visit

A return visit is a visit with at least one saved project.

```mermaid
flowchart TD
  rv_start(["Open Wrack with at least one saved project"]) --> rv_home["Home (/)<br/>Recent, Create, Load, Examples"]
  rv_home -->|"“Continue” on a Recent project"| rv_route
  rv_home -->|"Projects in the header"| rv_list["Projects (/projects)<br/>Saved projects with last-edited dates,<br/>tempo, time signature and track count"]
  rv_list -->|"Select a project"| rv_route["Open /projects/[id]"]
  rv_route --> rv_exists{"Project ID in wrack:v1:index?"}
  rv_exists -->|"No"| rv_missing(["“Project not found”<br/>Links to Projects and New project"])
  rv_exists -->|"Yes"| rv_read{"Project JSON readable?"}
  rv_read -->|"No"| rv_bad(["“A saved project could not be read.”"])
  rv_read -->|"Yes"| rv_view["Restore working state from wrack:v1:view:#lt;id#gt;<br/>Playhead, loop range and loop on/off, zoom and scroll,<br/>selected track and clips, open editor panel and its clip,<br/>dock tab and collapse, snap and grid, armed tracks<br/>Transport stopped"]
  rv_view --> rv_audio{"Project has audio clips or sampler zones?"}
  rv_audio -->|"No"| rv_ready(["Editor ready"])
  rv_audio -->|"Yes"| rv_decode["Load sources from IndexedDB and decode them"]
  rv_decode --> rv_all{"Every source available?"}
  rv_all -->|"Yes"| rv_ready
  rv_all -->|"No"| rv_notloaded["Clips without a source show “Audio not loaded”<br/>A banner below the transport shows “Open .wrack file to restore audio”"]
  rv_notloaded --> rv_ready
  rv_notloaded -.->|"“Open .wrack file to restore audio”"| rv_open[["Open a .wrack file"]]
```

## Volume notice

The first sound-producing action of a page session passes through this flow.

```mermaid
flowchart TD
  vn_start(["Sound-producing action: Play, a keyboard or MIDI note, or a preset audition"]) --> vn_stored{"Dismissal stored in wrack:v1:settings?"}
  vn_stored -->|"Yes"| vn_ctx
  vn_stored -->|"No"| vn_session{"“Continue” chosen earlier in this page session?"}
  vn_session -->|"Yes"| vn_ctx
  vn_session -->|"No"| vn_dialog["Volume notice dialog<br/>“Turn your device volume down. Wrack is about to play sound.”<br/>Unchecked checkbox “Don't show this again on this device”"]
  vn_dialog -->|"Cancel"| vn_cancel(["No action is performed"])
  vn_dialog -->|"Continue"| vn_box{"Checkbox checked?"}
  vn_box -->|"Yes"| vn_persist["Store the dismissal in wrack:v1:settings"]
  vn_box -->|"No"| vn_flag["Set the in-memory session flag"]
  vn_persist --> vn_ctx
  vn_flag --> vn_ctx
  vn_ctx["Create and resume the AudioContext and load the worklet, if not done yet"] --> vn_perform(["Perform the action with a 50 ms fade-in"])

  vn_settings(["Settings (/settings)"]) -->|"“Show the volume notice again”<br/>or “Remember settings on this device” turned off"| vn_clear(["Remove the stored dismissal"])
```

## Save preset

```mermaid
flowchart TD
  sp_start(["Select “Save preset” on an instrument or effect in the Devices tab"]) --> sp_dialog["Save preset dialog<br/>Name field"]
  sp_dialog -->|"Escape"| sp_close(["Dialog closes; focus returns to “Save preset”"])
  sp_dialog -->|"Submit"| sp_valid{"Name valid?"}
  sp_valid -->|"No"| sp_err["Show the error below the field<br/>Keep the entered name<br/>Focus the field"]
  sp_err --> sp_dialog
  sp_valid -->|"Yes"| sp_limit{"Library already holds 200 presets?"}
  sp_limit -->|"Yes"| sp_refuse(["“The preset library is full. Delete a preset in Settings to save a new one.”<br/>Keep the entered name"])
  sp_limit -->|"No"| sp_write["Write wrack:v1:presets"]
  sp_write --> sp_quota{"Write succeeded?"}
  sp_quota -->|"No: QuotaExceededError"| sp_full(["“This device's browser storage is full. Save a .wrack file, then delete unused projects.”"])
  sp_quota -->|"Yes"| sp_done["Dialog closes<br/>The preset appears under “My presets” in every project's picker for its type"]
  sp_done --> sp_settings["Settings (/settings): preset list"]
  sp_settings -->|"Rename or delete"| sp_manage(["Write wrack:v1:presets"])
```

| Field | Rule | Error text |
|---|---|---|
| Name | 1–40 characters after trimming; unique within the instrument or effect type | “Enter a preset name.” / “Use 40 characters or fewer.” / “A preset with this name already exists for &lt;type&gt;. Choose another name.” |

## Import audio

```mermaid
flowchart TD
  ia_start(["Select Add › “Audio file…” in the clip toolbar,<br/>“Add audio file” in an empty timeline,<br/>or the “Add audio file…” command"]) --> ia_pick["Choose one or more files"]
  ia_pick --> ia_first{"First audio import on this device?"}
  ia_first -->|"Yes"| ia_persist["Request navigator.storage.persist()"]
  ia_first -->|"No"| ia_each
  ia_persist --> ia_each["Take the next file<br/>Compute its SHA-256 as sourceId"]
  ia_each --> ia_decode{"decodeAudioData succeeds?"}
  ia_decode -->|"No"| ia_derr["“Could not decode #lt;name#gt;. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG.”"]
  ia_decode -->|"Yes"| ia_limit{"Project decoded audio stays within 20 minutes?"}
  ia_limit -->|"No"| ia_lerr["“#lt;name#gt; was not added. A project can hold up to 20 minutes of audio.”"]
  ia_limit -->|"Yes"| ia_clip["Place a clip at the edit cursor on the selected audio track,<br/>or on a new audio track"]
  ia_clip --> ia_known{"Source with this sourceId already stored?"}
  ia_known -->|"Yes"| ia_saved["Clip shows “Saved on this device”"]
  ia_known -->|"No"| ia_cap{"navigator.storage.estimate() leaves at least 10% of quota free?"}
  ia_cap -->|"No"| ia_session["“This browser could not store #lt;name#gt;. Save a .wrack file to keep this audio.”<br/>Clip shows “Session only”"]
  ia_cap -->|"Yes"| ia_put["Store the original file bytes in IndexedDB wrack, store sources"]
  ia_put --> ia_ok{"Write succeeded?"}
  ia_ok -->|"Yes"| ia_saved
  ia_ok -->|"No"| ia_session
  ia_derr --> ia_more
  ia_lerr --> ia_more
  ia_saved --> ia_more
  ia_session --> ia_more
  ia_more{"More files?"}
  ia_more -->|"Yes"| ia_each
  ia_more -->|"No"| ia_done(["Import results announced in the polite live region"])
```

## Export WAV

```mermaid
flowchart TD
  ex_start(["Select File › “Export WAV…” or press Ctrl/Cmd+Shift+E"]) --> ex_dialog["Export dialog<br/>Range: Whole project or Loop<br/>Format: WAV 16-bit with TPDF dither (default), 24-bit, 32-bit float;<br/>the last format chosen is kept in wrack:v1:settings<br/>Tail: 0–10 s, default 2 s"]
  ex_dialog --> ex_missing{"Clips without loaded audio?"}
  ex_missing -->|"Yes"| ex_list["List the clips; they render as silence"]
  ex_missing -->|"No"| ex_go
  ex_list --> ex_go["Start the export"]
  ex_go --> ex_len{"Range within 10 minutes?"}
  ex_len -->|"No"| ex_lerr["“Export ranges are limited to 10 minutes.”"]
  ex_lerr --> ex_dialog
  ex_len -->|"Yes"| ex_render["Stop the transport<br/>Render in an OfflineAudioContext with the same worklet graph and the safety stage<br/>Focus moves to Cancel"]
  ex_render --> ex_msgs{"Engine progress messages arriving?"}
  ex_msgs -->|"Yes"| ex_det["Determinate progress with percentage and elapsed time"]
  ex_msgs -->|"No"| ex_indet["Indeterminate progress"]
  ex_det --> ex_wav
  ex_indet --> ex_wav
  ex_render -->|"Cancel"| ex_cancel(["Discard the render; nothing downloads"])
  ex_wav["Write the WAV file"] --> ex_ready["“Download (#lt;size#gt;)” receives focus<br/>Nothing downloads by itself"]
  ex_ready -->|"Download"| ex_done(["Save the WAV file: save picker in Chromium, download elsewhere"])
```

## Save a .wrack file

```mermaid
flowchart TD
  sw_start(["Select File › “Save .wrack file” or press Ctrl/Cmd+S"]) --> sw_size{"Archive within 500 MB?"}
  sw_size -->|"No"| sw_big(["“This project is too large to save as one file.”"])
  sw_size -->|"Yes"| sw_build["Assemble project.json and audio/#lt;sourceId#gt;.#lt;ext#gt;<br/>as STORE-only ZIP Blob parts"]
  sw_build --> sw_fsa{"showSaveFilePicker available?"}
  sw_fsa -->|"Yes: Chromium"| sw_picker["Save file picker"]
  sw_fsa -->|"No"| sw_anchor["Download through #lt;a download#gt;"]
  sw_picker -->|"Cancel"| sw_cancel(["No file is written"])
  sw_picker -->|"Save"| sw_mark
  sw_anchor --> sw_mark(["Record the archive-save date in wrack:v1:index<br/>The header shows “Saved to file”"])

  sw_leave(["Leave the page"]) --> sw_newer{"Loaded audio newer than the last archive save?"}
  sw_newer -->|"Yes"| sw_prompt(["beforeunload prompt"])
  sw_newer -->|"No"| sw_exit(["Page closes"])
```

## Open a .wrack file

```mermaid
flowchart TD
  ow_start(["Select “Open .wrack file” on Home, File › “Open .wrack file…” (Ctrl/Cmd+O),<br/>or “Open .wrack file to restore audio” in the editor's missing-audio banner"]) --> ow_choose["Choose a .wrack file"]
  ow_choose --> ow_valid{"Archive passes validation?"}
  ow_valid -->|"No"| ow_errs(["Import nothing<br/>List every validation error"])
  ow_valid -->|"Yes"| ow_match{"Archive project ID matches a saved project?"}
  ow_match -->|"No"| ow_new["Import as a new saved project"]
  ow_match -->|"Yes"| ow_dialog["Dialog: “Restore audio” or “Replace project”"]
  ow_dialog -->|"Restore audio"| ow_restore["Load matching sources by sourceId<br/>Keep current edits"]
  ow_dialog -->|"Replace project"| ow_replace["Replace the saved project with the archive"]
  ow_new --> ow_editor
  ow_restore --> ow_editor
  ow_replace --> ow_editor
  ow_editor["Editor (/projects/[id])"] --> ow_all{"Every referenced source present?"}
  ow_all -->|"Yes"| ow_ready(["Editor ready"])
  ow_all -->|"No"| ow_notloaded(["Clips with a missing source stay “Audio not loaded”"])
```

Validation rejects an archive with any of these properties:
- A `..`, absolute or backslash path.
- More than 1000 entries.
- Duplicate paths, compared case-insensitively.
- A compression method other than 0.
- The encryption flag set.
- Sizes inconsistent with the file.
- A total size above 500 MB.
- A `project.json` above 5 MB or with JSON depth above 64.
- A CRC-32 mismatch.

## Panic

```mermaid
flowchart TD
  pa_button(["Select “Panic”"]) --> pa_send
  pa_key(["Press Escape"]) --> pa_where{"Focus in a text field, or a dialog or menu open?"}
  pa_where -->|"Yes"| pa_normal(["Escape keeps its usual behaviour"])
  pa_where -->|"No"| pa_send["Send panic to the engine"]
  pa_send --> pa_stop["Within 20 ms: stop the transport;<br/>end every voice, one-shot drum hit, preview and audition;<br/>clear effect buffers"]
  pa_stop --> pa_fade["The safety stage applies a 50 ms fade-in to the next sound"]
  pa_fade --> pa_done(["Announce “All sound stopped”"])
```

## Route coverage

| Route | Flows |
|---|---|
| `/` | First visit, Return visit, Open a .wrack file |
| `/new` | First visit, Create project |
| `/projects` | Return visit |
| `/projects/[id]` | First visit, Create project, Return visit, Save preset, Import audio, Export WAV, Save a .wrack file, Open a .wrack file, Panic |
| `/settings` | Volume notice, Save preset |
| Unknown project ID | Return visit |
