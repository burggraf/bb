-- Get position appearances for each player by year
SELECT 
    SUBSTR(g.date::VARCHAR, 1, 4) AS year,
    gfa.player_id,
    gfa.fielding_position,
    COUNT(*) AS appearances,
    -- Calculate innings played (approximate from event count)
    SUM(CASE WHEN e.inning IS NOT NULL THEN 1 ELSE 0 END) AS innings_played
FROM game.game_fielding_appearances gfa
JOIN game.games g ON gfa.game_id = g.game_id
LEFT JOIN event.events e ON e.game_id = g.game_id 
    AND e.event_id >= gfa.start_event_id 
    AND e.event_id < gfa.end_event_id
WHERE CAST(SUBSTR(g.date::VARCHAR, 1, 4) AS INTEGER) = 1976
GROUP BY year, gfa.player_id, gfa.fielding_position
ORDER BY gfa.player_id, appearances DESC
LIMIT 50;
