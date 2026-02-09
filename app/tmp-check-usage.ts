import { getGameDatabase } from './src/lib/game-results/database.js';

async function main() {
  const db = await getGameDatabase();
  const stmt = db.prepare('SELECT player_id, replay_current_total, actual_season_total, percentage_of_actual, status FROM player_usage WHERE player_id = ?');
  stmt.bind(['lis-j101']);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    console.log(JSON.stringify(row, null, 2));
  } else {
    console.log('Player not found in usage table');
  }
  stmt.free();
}
main();
