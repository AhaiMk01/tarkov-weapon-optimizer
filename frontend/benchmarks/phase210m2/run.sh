#!/bin/bash
# Phase 2.10 milestone 2 measurement driver: shards bench.ts over N processes (one JSONL file per shard, see bench.ts).
#
#   benchmarks/phase210m2/run.sh <frontend dir> <out dir> <label> <shards> [bench.ts options...]
#
# The frontend dir may be another checkout (the BEFORE run used the tip 5191d2e exported to a scratch directory); the pinned snapshot is read from
# $SNAPSHOT (default: this checkout's benchmarks/snapshot.json). Summarize with: npx tsx benchmarks/phase210m2/summarize.ts <out dir> before,after
FE=$1; OUT=$2; LABEL=$3; N=$4; shift 4
SNAPSHOT=${SNAPSHOT:-$(cd "$(dirname "$0")/.." && pwd)/snapshot.json}
mkdir -p "$OUT"
cd "$FE" || exit 1
for ((k=0;k<N;k++)); do
  npx tsx benchmarks/phase210m2/bench.ts --out "$OUT" --label "$LABEL" --shard $k --of "$N" --snapshot "$SNAPSHOT" "$@" > "$OUT/$LABEL-$k.log" 2>&1 &
done
wait
echo all done
