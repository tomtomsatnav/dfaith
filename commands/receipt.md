---
description: Show the receipt for the latest session (claims vs reality, automaton path, stamp)
allowed-tools: Bash(node:*)
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/receipts.mjs" check --latest --write` and show the output to the user verbatim in a code block. Do not interpret or soften the stamp. If the stamp is DO NOT MERGE, say in one line what a human needs to look at, quoting the receipt.
