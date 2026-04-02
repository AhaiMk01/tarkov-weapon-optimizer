# Custom HiGHS WASM Build

Built from [lovasoa/highs-js](https://github.com/lovasoa/highs-js) with increased WASM memory
to handle large LP models (>230KB) that the stock npm package cannot solve.

## Changes from upstream

In `build.sh`, changed:
```
-s INITIAL_MEMORY=67108864    # 64MB (was default ~16MB)
-s ALLOW_TABLE_GROWTH=1       # Allow function table to grow
-s STACK_SIZE=8388608          # 8MB stack (was 4MB)
```

## Rebuild instructions

```bash
git clone --recursive https://github.com/lovasoa/highs-js.git
cd highs-js
# Apply the build.sh changes above
# Install emscripten: https://emscripten.org/docs/getting_started/downloads.html
bash build.sh
cp build/highs.js build/highs.wasm /path/to/frontend/vendor/highs/
```
