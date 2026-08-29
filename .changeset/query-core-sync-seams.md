---
"@tahanabavi/typefetch-query-core": minor
---

Add four additive seams for cross-tab sync and offline replay: a fetch `gate`
that wraps every fetch and mutation, a `sources` resolver (`collectSources` plus
`client.resolveSource`), an optional `{ updatedAt }` on `setQueryData` /
`query.setData`, and a `reason` (`"gc"` | `"explicit"`) on the `removed` cache
event. All are opt-in — with none configured the engine behaves byte-for-byte as
before.
