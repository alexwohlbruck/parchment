# WhatFreeWords

Local what3words conversion. `index.ts` is a TypeScript port of the
WhatFreeWords JavaScript library, a compatible reimplementation of the
what3words algorithm published anonymously in 2019. Mirror of the original:
https://github.com/LakesideMiners/WhatFreeWords

English only: the original recovered one word list.

## Data

Both files are loaded on first use with `fetch(new URL(..., import.meta.url))`:
a `file:` URL under Bun, an emitted asset under Vite. The web service worker
precaches them so three-word addresses work offline.

- `whatfreewords-words.txt` is the 40,000-word list, one per line, in index
  order. It is WhatFreeWords' `word_data`, LZ-decompressed.
- `whatfreewords-regions.bin` is the grid's region table, re-encoded to
  about half the size of the original (gzip ~570 KB vs ~1.2 MB).

The original region table (`region_data`) is LZ-compressed base64 of binary
records: 313,614 runs of `uint16le x, uint16le y, uint16le length`. Their
order matters, because square numbers accumulate along it. The re-encoding
keeps that order and stores:

1. the run count, as a varint
2. a column of row deltas `y - previous y`, zigzag varints
3. a column of gaps `x - (previous x + previous length)`, zigzag varints
4. a column of run lengths, varints

Varints are little-endian base 128. Zigzag maps `0, -1, 1, -2…` to `0, 1, 2, 3…`.
`decodeRegions` in `index.ts` reverses this.
