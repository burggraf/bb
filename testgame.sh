echo "testgame.sh <year> <number_if_games>"
pnpm -C app exec tsx test-game-sim.ts --year $1 --verbose $2
