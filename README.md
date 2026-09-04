# WorkFLO

A workflow command center for Sitecore content teams. It runs inside the
Sitecore Marketplace (SitecoreAI) and uses the Marketplace host session as its
only identity — the app has **no login of its own** and never stores Sitecore
credentials, tokens, or secrets in the browser.

- Preview path: `/home-editor/` (kept for compatibility with the original
  registration; the product name is WorkFLO).
- Frontend: React + Vite (`artifacts/home-editor`).
- No app backend: live data flows through the Marketplace bridge
  (`xmc.authoring.graphql`) with the host-verified `sitecoreContextId`.

## Runtime modes

The app is always usable and always labels where its data comes from:

1. **Connecting (demo)** — the UI renders immediately with clearly labeled
   in-memory demo workflow data while the Marketplace SDK handshake runs in
   parallel (only when actually embedded in a trusted Sitecore host).
2. **Live** — once the handshake and API-resource access are verified, the app
   atomically switches to live Sitecore workflow data. Demo caches are dropped
   on handoff, and host-generation cache keys plus routed-tree remounting keep
   operations composed against one host from being submitted through another.
3. **Standalone demo** — outside a Sitecore host (e.g. the Replit preview),
   the app stays in demo mode with in-memory workflow and content fixtures.
4. **Sitecore unavailable (demo + retry)** — if the handshake fails, the app
   remains usable on demo data and offers a Retry action.

## Identity and authorization

The Sitecore Marketplace host context is the sole source of identity and
authorization. There is no sign-in, sign-up, password, token storage, or
direct credential flow in this app. The previous Clerk-based editor
authentication was removed when the app became Marketplace-hosted.

## Required Marketplace access

The Marketplace registration for this app must grant access to:

- **XM Cloud Authoring API** (`xmc.authoring.graphql`) — workflow queues,
  commands, history, and gathering item text for reviews.
- **XM Cloud Sites API** (`xmc.sites.listSites`) — resolving the brand kit
  connected to the environment's sites.
- **Sitecore AI skills — Brand Review** (`ai.skills.generateBrandReview`,
  Marketplace SDK `@sitecore-marketplace-sdk/ai`) — advisory AI quality
  checks. Requires a Stream subscription and a brand kit connected to a
  site. Update the existing app installation after adding this grant.

AI results are **advisory only**: they inform the reviewer and are shown in
approval confirmations, but they never execute, block, or override workflow
commands, and the app never lets AI approve, reject, publish, or rewrite
content. Review requests submit only the item's own text (plus direct
datasource text), bounded by size limits.

## Routes

- `/` — workflow command center (big-number metrics, queues, workflow list)
- `/workflows/:workflowId` — workflow detail with visual diagram
- `/workflows/:workflowId/states/:stateId` — review queue with workflow commands
- `/workflows/:workflowId/apply` — guarded content browser and workflow assignment
- `/builder` — canvas-first workflow builder

## Local development

```bash
pnpm install
pnpm --filter @workspace/home-editor run dev   # or the workspace workflow
pnpm --filter @workspace/home-editor run test  # vitest (jsdom + node)
pnpm --filter @workspace/home-editor run typecheck
```

The Marketplace release of this app is published from the separate release
repository configured in SitecoreAI; keep that registration unchanged when
renaming visible copy.
