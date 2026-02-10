#!/bin/bash

# Default to 1976 if no year provided
YEAR=${1:-1976}

echo "=================================================="
echo "⚾  Starting MLB Season Replay for $YEAR"
echo "=================================================="

# Check if season data exists
SEASON_FILE="app/static/seasons/$YEAR.sqlite"
if [ ! -f "$SEASON_FILE" ]; then
    echo "❌ Error: Season data for $YEAR not found at $SEASON_FILE"
    echo "You may need to export it first using data-prep tools."
    exit 1
fi

# Run the simulation using tsx
# We run from the app directory so paths resolve correctly
cd app && pnpm exec tsx run-season-replay.ts "$YEAR"

# Return to root
cd ..

echo ""
echo "✅ Replay complete."
echo "You can inspect the results database shown above using:"
echo "sqlite3 <path_to_db>"
