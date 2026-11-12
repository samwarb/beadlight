# /brag-slim for Beadlight

This folder vendors the single-file `brag-slim` agent skill from [latent-spaces/brag](https://github.com/latent-spaces/brag/tree/main/skills/brag-slim) (MIT licensed). It is automatically discoverable by compatible agents when this repository is checked out.

To install the **full** `/brag` skill into Codex (requires Hyperframes, Node.js 22+ and FFmpeg), use:

```bash
codex plugin marketplace add latent-spaces/brag
codex plugin add brag@brag
```

The lightweight skill does not depend on Hyperframes. It generates launch videos locally using tools available to the agent. To invoke it, say `/brag-slim https://beadlight.app --format vertical --tone polished`.
