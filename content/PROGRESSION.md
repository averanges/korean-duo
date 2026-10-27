# Future content architecture — not implemented levels

The shipped `rounds.json` contains only the approved first round. Append rounds to that array when content is ready. The header, progress dots, duration, carousel action count, answer completion gate, scoring totals, and host Next control derive from content.

| Future round | Content direction | Existing fields |
| --- | --- | --- |
| 2 | More simple actions | New IDs, images, labels and statuses |
| 3 | Actions in specific places | `metadata.location` |
| 4 | Weekdays and dates | `metadata.day`, `metadata.date` |
| 5 | Quantities and several actions in a scene | `metadata.quantity`, `sceneId`, repeated scene image |

Each action is an independently answerable item. To describe multiple actions within one illustration, give multiple action records the same `sceneId` and `image`, with unique action IDs and vocabulary/context describing the intended target. Example:

```json
[
  {
    "id": "park-run",
    "sceneId": "park-monday",
    "label": "달리다",
    "image": "/assets/park.webp",
    "status": "REQUIRED",
    "metadata": { "location": "공원에서", "day": "월요일" }
  },
  {
    "id": "park-drink",
    "sceneId": "park-monday",
    "label": "물을 마시다",
    "image": "/assets/park.webp",
    "status": "FORBIDDEN",
    "metadata": { "quantity": "물 두 잔" }
  }
]
```

This is a schema example, not a playable asset. Current UI shows each answerable action on its own carousel page. A later UI can group pages by `sceneId` or add scene hotspots without changing room management or action-ID scoring. All metadata is public; keep solutions only in `status`.

For additional grammar, retain action IDs and server filtering but introduce a round-level answer-type definition, valid answer values and localized choice labels. Extend the server validator/scorer and choice renderer together. The current binary grammar labels are intentionally fixed for this MVP; arbitrary grammar types are not yet supported.
