
import Database from 'better-sqlite3';

async function testBias() {
  const db = new Database('app/static/seasons/1976.sqlite', { readonly: true });
  
  // Load league averages
  const keys = ['single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch', 'strikeout', 'ground_out', 'fly_out', 'line_out', 'pop_out', 'sacrifice_fly', 'sacrifice_bunt', 'fielders_choice', 'reached_on_error', 'catcher_interference'];
  
  // Just pick some random batters and pitchers
  const batters = db.prepare("SELECT * FROM batters WHERE pa > 100 LIMIT 50").all() as any[];
  const pitchers = db.prepare("SELECT * FROM pitchers WHERE innings_pitched > 50 LIMIT 50").all() as any[];
  
  // Get rates for them
  const batterRatesMap = new Map();
  for (const b of batters) {
    const rates = db.prepare("SELECT * FROM batter_rates WHERE batter_id = ?").all(b.id) as any[];
    const splitMap = {} as any;
    for (const r of rates) {
      splitMap[r.split] = {};
      for (const k of keys) {
        const camelK = k.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        splitMap[r.split][camelK] = r[k];
      }
    }
    batterRatesMap.set(b.id, splitMap);
  }
  
  const pitcherRatesMap = new Map();
  for (const p of pitchers) {
    const rates = db.prepare("SELECT * FROM pitcher_rates WHERE pitcher_id = ?").all(p.id) as any[];
    const splitMap = {} as any;
    for (const r of rates) {
      splitMap[r.split] = {};
      for (const k of keys) {
        const camelK = k.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        splitMap[r.split][camelK] = r[k];
      }
    }
    pitcherRatesMap.set(p.id, splitMap);
  }
  
  // League avg
  const leagueRates = {
    vsLeft: {} as any,
    vsRight: {} as any
  } as any;
  
  for (const split of ['vsLHP', 'vsRHP']) {
    const targetSplit = split === 'vsLHP' ? 'vsLeft' : 'vsRight';
    for (const k of keys) {
      const camelK = k.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      const val = (db.prepare(`SELECT AVG(${k}) as avg FROM batter_rates WHERE split = ?`).get(split) as any).avg;
      leagueRates[targetSplit][camelK] = val;
    }
  }
  
  let totalSum = 0;
  let count = 0;
  
  for (const b of batters) {
    for (const p of pitchers) {
      const bSplits = batterRatesMap.get(b.id);
      const pSplits = pitcherRatesMap.get(p.id);
      
      const batterHandedness = b.bats === 'S' ? (p.throws === 'L' ? 'R' : 'L') : b.bats;
      const pitcherHandedness = p.throws;
      
      const batter = pitcherHandedness === 'L' ? bSplits.vsLHP : bSplits.vsRHP;
      const pitcher = batterHandedness === 'L' ? pSplits.vsLHB : pSplits.vsRHB;
      const league = pitcherHandedness === 'L' ? leagueRates.vsLeft : leagueRates.vsRight;
      
      if (!batter || !pitcher) continue;

      let sum = 0;
      for (const outcome of keys) {
        const camelK = outcome.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        const prob = (batter[camelK] * pitcher[camelK]) / (league[camelK] || 1e-6);
        sum += prob;
      }
      totalSum += sum;
      count++;
    }
  }
  
  console.log(`Average rawProb sum: ${(totalSum / count).toFixed(4)}`);
}

testBias();
