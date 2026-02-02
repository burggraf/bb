-- Calculate average pitch counts for starters and relievers by season
WITH pitcher_game_pitches AS (
    -- Count pitches by pitcher in each game
    SELECT 
        g.date::VARCHAR AS date_str,
        g.game_id,
        g.home_team_id,
        g.away_team_id,
        e.pitcher_id,
        e.fielding_team_id,
        COUNT(*) AS pitches_thrown,
        MIN(e.event_id) AS first_pitch_id
    FROM event.events e
    JOIN game.games g ON e.game_id = g.game_id
    WHERE e.pitcher_id IS NOT NULL
    GROUP BY 
        g.date,
        g.game_id,
        g.home_team_id,
        g.away_team_id,
        e.pitcher_id,
        e.fielding_team_id
),
game_starters AS (
    -- Identify starter for each team in each game (first pitcher to throw a pitch)
    SELECT DISTINCT
        pgp.game_id,
        pgp.fielding_team_id,
        pgp.pitcher_id AS starter_id
    FROM pitcher_game_pitches pgp
    WHERE pgp.first_pitch_id = (
        SELECT MIN(pgp2.first_pitch_id)
        FROM pitcher_game_pitches pgp2
        WHERE pgp2.game_id = pgp.game_id 
        AND pgp2.fielding_team_id = pgp.fielding_team_id
    )
),
starter_reliever_pitches AS (
    SELECT
        SUBSTR(pgp.date_str, 1, 4) AS year,
        pgp.pitches_thrown,
        CASE WHEN gs.starter_id IS NOT NULL THEN 'starter' ELSE 'reliever' END AS role
    FROM pitcher_game_pitches pgp
    LEFT JOIN game_starters gs ON pgp.game_id = gs.game_id 
        AND pgp.pitcher_id = gs.starter_id
        AND pgp.fielding_team_id = gs.fielding_team_id
)
SELECT
    year,
    role,
    COUNT(*) AS num_games,
    ROUND(AVG(pitches_thrown), 1) AS avg_pitches,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pitches_thrown), 1) AS median_pitches,
    ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY pitches_thrown), 1) AS p75_pitches,
    ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY pitches_thrown), 1) AS p90_pitches
FROM starter_reliever_pitches
WHERE CAST(year AS INTEGER) >= 1910
GROUP BY year, role
ORDER BY year DESC, role
LIMIT 60;
