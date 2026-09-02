# Winding Intelligence

Winding Intelligence turns transformer winding sheets and design packets into
separate, reviewable costing data. Work happens locally first and is published
only after explicit approval.

## Document flow

1. The browser uploads one PDF or image to the protected application API.
2. The API submits the file once to Azure Content Understanding analyzer
   `DesignPacketClassifier`.
3. The classifier segments the document into `Winding_Sheet`, `Design_Packet`,
   or `Other` and invokes its linked analyzers within the same Azure operation.
4. Routed fields are read from content paths such as `input1/segment1`; the
   parent `input1` content supplies classification metadata rather than fields.
5. Same-category segment fields are merged and shown in the Design packet and
   Winding result views. `Other` uploads return an unsupported-file message.

There is no second file upload, application analyzer selector, or page-range
resubmission loop.

## Local configuration

Copy `.env.example` to `.env.local` and set the endpoint, shared site password,
and existing Content Understanding API key. The analyzer setting is:

```text
AZURE_CONTENT_UNDERSTANDING_ANALYZER_ID=DesignPacketClassifier
```

The API key remains server-side. Never commit `.env.local` or
`.devcontainer/.env.devcontainer`.

## Local work

```bash
npm install
npm run dev
npm test
```

Normal review happens at `http://localhost:3000`. Source changes are not pushed
or published until an explicit sync request.

## Dev container and optional ngrok review

The Debian/glibc dev container installs dependencies after creation and starts
the local application. Git and GitHub CLI are included for repository access.
See `.devcontainer/DEVCONTAINER_SETUP.md` for setup.

The ngrok tunnel remains dormant during normal work:

```bash
npm run tunnel:start
npm run tunnel:status
npm run tunnel:stop
```

Starting ngrok exposes the current local application temporarily; it does not
publish the Sites project.

## Analyzer definitions

- `document-routing-content-understanding-classifier.json` defines classifier
  categories and linked child analyzers.
- `design-packet-content-understanding-schema.json` defines design-packet
  fields.
- `winding-sheet-content-understanding-schema.json` defines winding fields.
- `WindingSheetReaderFields.md` documents the winding extraction contract.

## Validation

- `npm run build` builds the Vinext/Cloudflare application.
- `node --test tests/rendered-html.test.mjs` runs regression checks.
- `npm test` runs both in sequence.
