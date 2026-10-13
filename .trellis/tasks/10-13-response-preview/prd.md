# PRD: Render the login response HTML as a preview

## Background

The CAS login response is a full HTML page (e.g. "Log In Successful"). The
panel currently shows its source in a textarea, but the user wants to see the
page rendered.

## Goal

Under the request body: keep the response source in a code block, and add a
rendered preview of the response HTML.

## Requirements

- R1 The response source stays available (code block, copyable) as today.
- R2 A preview area renders the response HTML so the page is visible.
- R3 The preview must be sandboxed: no access to the LuCI page (no
  `allow-same-origin`, no top navigation) and no external network dependency
  required to render.
- R4 Empty response renders neither the code block nor the preview.
- R5 Localized labels (zh, zh-TW, en) for the preview.
- R6 The preview must not break the surrounding form; it is a fixed-height
  scrollable box.

## Acceptance criteria

- After a login, the response appears both as source and as a rendered preview
  showing the page's own title/text.
- With no response, nothing extra is rendered.
- Verified on the Kwrt router.

## Out of scope

- Interpreting the response semantics.
