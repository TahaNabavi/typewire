import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entries: the library surface consumers import (`defineConfig`)
  // and the executable `bin`, which must stay a separate chunk so importing the
  // former never runs the latter.
  entry: { index: 'src/index.ts', bin: 'src/bin.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
})
