import { GameEngine } from './src/lib/game/engine.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load season data
const seasonPath = join(process.cwd(), 'static', 'seasons', '1976.json');
const data = readFileSync(seasonPath, 'utf-8');
const season = JSON.parse(data);

console.log('Creating game engine...');
const engine = new GameEngine(season, 'CIN', 'HOU');

console.log('Simulating game...');
let plays = 0;
const maxPlays = 200; // Safety limit

while (!engine.isComplete() && plays < maxPlays) {
	engine.simulatePlateAppearance();
	plays++;

	if (plays % 10 === 0) {
		const state = engine.getState();
		console.log(`  Play ${plays}: Inning ${state.inning}, ${state.isTopInning ? 'top' : 'bottom'}, Outs ${state.outs}`);
	}
}

if (plays >= maxPlays) {
	console.log('ERROR: Game did not complete after 200 plays!');
	console.log('Final state:', engine.getState());
} else {
	console.log(`Game completed after ${plays} plays`);
	const state = engine.getState();
	console.log(`Final score:`, state.plays.reduce((acc: any, play) => {
		if (play.isTopInning) acc.away += play.runsScored;
		else acc.home += play.runsScored;
		return acc;
	}, { away: 0, home: 0 }));
}
