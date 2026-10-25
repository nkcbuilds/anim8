# Bubble sort reference scene

This scene sorts `[5, 1, 4, 2]` into ascending order using explicit adjacent swaps.

## Demonstrates

- Stable object identity: the rectangles represent values, not array slots.
- Concurrent `move` actions on two different objects to perform a swap.
- `arc-up` and `arc-down` motion paths so crossing values remain visually legible.
- Multiple non-overlapping moves on the same object across successive passes.
- Final `fill` actions to mark the sorted result.

## Current limitations

- SceneDocument 1.0 has no compare/swap or loop primitive; only the swaps are encoded, not executable bubble-sort logic.
- No conditional action exists for comparisons that do not swap, so those comparisons are not animated here.
- Array positions are hand-authored coordinates; there is no built-in array layout in the scene format.
- The timeline cannot derive the next swap from the current values; an author/model must produce the sequence.
