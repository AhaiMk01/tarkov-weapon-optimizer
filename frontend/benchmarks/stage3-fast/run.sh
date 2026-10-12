#!/bin/bash
# Stage 3 workstream 3.4 driver: shards bench.ts over N processes (one JSONL file and one log per shard, see bench.ts).
#
#   benchmarks/stage3-fast/run.sh <out dir> <shards> [bench.ts options...]
#
# Run from frontend/. Summarize with: npx tsx benchmarks/stage3-fast/summarize.ts <out dir> > benchmarks/stage3-fast/tables.md
OUT=$1; N=$2; shift 2
mkdir -p "$OUT"
cd "$(dirname "$0")/../.." || exit 1
for ((k=0;k<N;k++)); do
  npx tsx benchmarks/stage3-fast/bench.ts --out "$OUT" --shard $k --of "$N" "$@" > "$OUT/s3fast-$k.log" 2>&1 &
done
wait
echo all done
