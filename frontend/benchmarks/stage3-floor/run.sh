#!/bin/bash
# Stage 3 workstream 3.7 driver: shards the frozen MOA floor cases (cases.json) over N driver processes; each driver runs its jobs one at a time,
# every job in a fresh node process (driver.ts, bench.ts).
#
#   benchmarks/stage3-floor/run.sh <out dir> <shards> [driver.ts options...]
#
# Run from frontend/. Summarize with: npx tsx benchmarks/stage3-floor/summarize.ts <out dir> > benchmarks/stage3-floor/summary.md
OUT=$1; N=$2; shift 2
mkdir -p "$OUT"
cd "$(dirname "$0")/../.." || exit 1
for ((k=0;k<N;k++)); do
  npx tsx benchmarks/stage3-floor/driver.ts --out "$OUT" --shard $k --of "$N" "$@" > "$OUT/driver-$k.log" 2>&1 &
done
wait
echo all done
