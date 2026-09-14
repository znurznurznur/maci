# Subgraph module

This module is responsible for the deployment of the subgraph for MACI. It automates the deploy
of a subgraph project (`graph codegen` / `graph build` / `graph deploy`) that already exists on
disk — it does not vendor or build that project itself. All its endpoints are protected by the
`AccountSignatureGuard` middleware, which checks the signature of the request against the
`COORDINATOR_ADDRESSES` environment variable.

**`SUBGRAPH_FOLDER`** must point at a subgraph project directory containing `subgraph.yaml`,
`schemas/schema.v1.graphql`, `config/<network>.json`, and `templates/subgraph.template.yaml` —
this coordinator does not ship one. The consuming product owns providing it at deploy time (bind
mount, CI checkout step, or a `COPY` in the coordinator's Docker build stage).

**IMPORTANT:** The Graph Studio UI is a bit confusing. You need the DEPLOY_KEY from "My Dashboard" -> "maci-subgraph" -> "DEPLOY KEY". It is not the API key on the top navbar.
