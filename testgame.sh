echo "testgame.sh <year> ($1) <number_if_games> ($2)"
pnpm -C app exec tsx test-game-sim.ts --year $1 --verbose $2
