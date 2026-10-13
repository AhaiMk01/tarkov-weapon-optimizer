#!/bin/bash
# Measurement 1 of docs/stage3/ted-tolerance-and-overhead.md: Precise on the 172 pinned guns, TrueErgo and TrueErgo + Prevent Overswing, 60 s, 12
# processes, at the default tolerance and three looser ones, with the opt-in stage timing on (it only reads the clock).
#
#   benchmarks/phase210m2/run-tedmeasure.sh [out dir, default benchmarks/phase210m2/results/tedmeasure] [tolerances, default "1e-5 1e-1 1e-2 1e-3"]
cd "$(dirname "$0")/../.." || exit 1
R=${1:-$(pwd)/benchmarks/phase210m2/results/tedmeasure}
TOLS=${2:-"1e-5 1e-1 1e-2 1e-3"}
mkdir -p "$R"
for t in $TOLS; do
  echo "start $t $(date -Iseconds)" >> "$R/progress.txt"
  bash benchmarks/phase210m2/run.sh . "$R" "tol$t" 12 --profiles trueErgo,trueErgoPO --tolerance "$t" --timing on --limit-ms 60000
  echo "done $t $(date -Iseconds)" >> "$R/progress.txt"
done
