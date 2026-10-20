# Basic Pitch (empacotado)

`basic-pitch.js` é um pacote ESM gerado com esbuild a partir de `@spotify/basic-pitch@1.0.1` e
`@tensorflow/tfjs-core`, `-converter`, `-backend-webgl` e `-backend-cpu` 3.21.0 (licença Apache-2.0).
`model.json` e `group1-shard1of1.bin` são o modelo original do Basic Pitch.

Para gerar de novo:

```js
// entry.js
import '@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops';
import * as tf from '@tensorflow/tfjs-core';
export { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch/esm/index.js';
export { tf };

// tfshim.js (substitui '@tensorflow/tfjs')
import '@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops';
export * from '@tensorflow/tfjs-core';
export { loadGraphModel } from '@tensorflow/tfjs-converter';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
```

```bash
npx esbuild entry.js --bundle --format=esm --minify --alias:@tensorflow/tfjs=./tfshim.js --outfile=basic-pitch.js
```
