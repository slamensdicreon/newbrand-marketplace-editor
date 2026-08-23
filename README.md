# Sitecore Workflow Operations

A workflow command center for Sitecore content teams. It runs inside the
Sitecore Marketplace (SitecoreAI) and uses the Marketplace host session as its
only identity — the app has **no login of its own** and never stores Sitecore
credentials, tokens, or secrets in the browser.

- Preview path: `/home-editor/` (kept for compatibility with the original
  registration; the product name is Sitecore Workflow Operations).
- Frontend: React + Vite (`artifacts/home-editor`).
- No app backend: live data flows through the Marketplace bridge
  (`xmc.authoring.graphql`) with the host-verified `sitecoreContextId`.

## Runtime modes

The app is always usable and always labels where its data comes from:

1. **Connecting (demo)** — the UI renders immediately with clearly labeled
   in-memory demo workflow data while the Marketplace SDK handshake runs in
   parallel (only when actually embedded in a trusted Sitecore host).
2. **Live** — once the handshake and API-resource access are verified, the app
   atomically switches to live Sitecore workflow data. Demo caches and local
   demo drafts are dropped on handoff; demo edits can never be saved to
   Sitecore (host-generation cache keys + editor remount enforce this).
3. **Standalone demo** — outside a Sitecore host (e.g. the Replit preview),
   the app stays in demo mode. Demo edits are in-memory only.
4. **Sitecore unavailable (demo + retry)** — if the handshake fails, the app
   remains usable on demo data and offers a Retry action.

## Identity and authorization

The Sitecore Marketplace host context is the sole source of identity and
authorization. There is no sign-in, sign-up, password, token storage, or
direct credential flow in this app. The previous Clerk-based editor
authentication was removed when the app became Marketplace-hosted.

## Routes

- `/` — workflow command center (big-number metrics, queues, workflow list)
- `/workflows/:id` — workflow detail with visual diagram
- `/workflows/:id/states/:stateId` — review queue with workflow commands
- `/builder` — canvas-first workflow builder
- `/content` — compatibility path: the earlier New Brand homepage content
  editor (same host rules; demo edits stay in-memory)
- `/sections/:id` — homepage section editor (compatibility)

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
