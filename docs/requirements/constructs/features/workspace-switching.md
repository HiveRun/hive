# Workspace Discovery & Switching

## Goal
Allow users to easily manage multiple workspaces and switch between them within Synthetic.

## Key Requirements
- On first launch, prompt the operator to choose a directory; if it contains a `synthetic.config.ts`, register it immediately.
- When a directory contains multiple subdirectories, scan only the immediate children for `synthetic.config.ts` and offer those as registrable workspaces.
- Persist registrations in a global workspace registry (e.g., `~/.synthetic/workspaces.json`) and surface all entries via the sidebar or command menu so switching is a single action.
- Switching workspaces updates the active repo context, constructs list, and services in-place.
- Because Synthetic runs as a single instance, it can coordinate port assignments and avoid collisions automatically.
- Construct templates, histories, and artifacts remain isolated to their workspace; Synthetic never mixes constructs across projects.