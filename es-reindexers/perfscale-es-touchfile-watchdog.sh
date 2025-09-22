#!/bin/bash

export TOUCH_DIR="<YOUR_TOUCH_DIR>"
export WEBHOOK_URL="<YOUR_WEBHOOK_URL>"

alerted=0
now=$(date +%s)
threshold=$((14*24*60*60)) # 14 days in seconds

stale_files=()

for file in "$TOUCH_DIR"/*-touch.txt; do
    [ -f "$file" ] || continue
    ts_epoch=$(head -n1 "$file")

    # sanity check (is it a number?)
    if ! [[ "$ts_epoch" =~ ^[0-9]+$ ]]; then
        echo "WARN: Invalid epoch timestamp in $file"
        continue
    fi

    age=$(( now - ts_epoch ))

    if [ $age -gt $threshold ]; then
        stale_files+=("$file")
    fi
done

if [ ${#stale_files[@]} -gt 0 ]; then
    message=":warning: The following jobs seem to be out of sync for a while. Something to look at :eyes-suspicious:\n\`\`\`\n"
    for f in "${stale_files[@]}"; do
        ts_epoch=$(head -n1 "$f")
        job_name=$(basename "$f" -touch.txt) # strip directory and suffix
        last_update=$(date -d @"$ts_epoch")
        message="$message $job_name  (last update: $last_update)\n"
    done
    message="$message\`\`\`"

    curl -s -X POST -H 'Content-type: application/json' \
         --data "{\"text\": \"$message\"}" \
         "$WEBHOOK_URL"

    alerted=1
fi

if [ $alerted -eq 0 ]; then
    echo "All touch files are within 14 days."
fi
