#!/bin/bash

# Show usage if no parameter provided
if [ -z "$1" ]; then
    echo "Usage: $0 <season>"
    echo "Example: $0 1976"
    exit 1
fi

npx tsx app/run-season-replay.ts "$1"
