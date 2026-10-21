#!/bin/sh
# Builds Box2D v3 + the Chalkfall bridge to WebAssembly -> src/physics/wasm/box2d.{mjs,wasm}
# Needs Emscripten (emcc) and git. Box2D is MIT licensed (Erin Catto).
set -e
cd "$(dirname "$0")"
BOX2D_TAG=${BOX2D_TAG:-v3.2.0}
if [ ! -d box2d ]; then
  git clone -q --depth 1 --branch "$BOX2D_TAG" https://github.com/erincatto/box2d box2d
fi
OUT=../src/physics/wasm
mkdir -p "$OUT"
emcc -O3 -std=gnu17 -DNDEBUG -DBOX2D_DISABLE_SIMD -ffp-contract=off -fno-fast-math \
  -I box2d/include -I box2d/src box2d/src/*.c api.c \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createBox2D -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 -s FILESYSTEM=0 -s TOTAL_STACK=1048576 \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32","HEAP32"]' \
  -o "$OUT/box2d.mjs"
cp box2d/LICENSE "$OUT/BOX2D-LICENSE.txt"
ls -la "$OUT"
