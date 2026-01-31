<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# research to most accurate baseball batter pitcher matchup statistical model (probably using baysean statistics)... I'm making a baseball game and I want the most accurate statistical simulation possible, based on all the research that's been done on statistical modeling

For current research, the most accurate batter–pitcher matchup models are hierarchical Bayesian “log5-style” models, not plain generalized log5.[^1][^2][^3]

## Core model you should target

The current best-supported approach for PA-outcome probabilities is:

- A **Bayesian hierarchical log5 model** that:
    - Starts from standard/generalized log5 structure (batter, pitcher, league rates).[^4][^1]
    - Treats batter and pitcher “true talents” as latent parameters with priors centered on league/role averages (partial pooling).[^2][^5][^1]
    - Learns coefficients (exponents / weights on batter vs pitcher vs league), instead of fixing them at 1,1,−1 as in classic log5.[^1][^2]
    - Optionally includes a **fourth variable** for team defense (e.g., DER) in on‑base models.[^2][^1]

This Bayesian hierarchical log5 model has been shown to beat:

- Standard log5.
- Generalized log5 with fixed coefficients.
on out‑of‑sample matchup prediction error.[^1][^2]

For your game, that’s the “gold standard” template if you want log5-like interpretability with modern accuracy.

## Key references and what they imply

- **Haechrel – “Matchup Probabilities in Major League Baseball” (SABR)**
    - Introduces **generalized log5** for multiple outcomes (out, 1B, 2B, 3B, HR, BB, HBP) using batter, pitcher, league event rates.[^6][^4]
    - Validates it on tens of thousands of PAs; great baseline, but coefficients are still fixed and non-Bayesian.
- **Healey et al. – “Modeling the probability of a batter/pitcher matchup event” (PLOS ONE, 2018)**
    - Proposes a **Bayesian hierarchical log5** model for “reaches base safely” using only batter+pitcher data and league background.[^2][^1]
    - Shows it outperforms both standard and generalized log5 in MSE on real data.[^1][^2]
    - Extends it to a **four‑variable** model adding team defensive ability (DER), which further lowers prediction error.[^2][^1]
- **Recent thesis on complex matchup models (2024)**
    - Builds **progressively complex hierarchical Bayesian models** for full plate‑appearance outcome vectors, combining pitcher and batter attributes, handedness, recency, and league rates.[^3]
    - Uses NUTS/HMC to fit posterior distributions and then simulate outcomes from posterior means.[^3]

Together these say: “hierarchical Bayesian > generalized log5 > standard log5” for matchup realism, especially with sparse data.

## How to structure your simulation model

Given the above, a practical architecture for your game looks like:

1. **Outcome space**
    - At minimum: {out, 1B, 2B, 3B, HR, BB/HBP}. Haechrel uses 7 outcomes.[^4][^6]
    - You can refine later (e.g., K vs other outs, BB vs HBP, GB vs FB vs LD) using the same framework.
2. **Base (non-Bayesian) structure**
    - Use the generalized log5 multiplicative form you already implemented:
        - For each outcome $i$, combine batter_rate\_i, pitcher_rate\_i, league_rate\_i via a log5-style formula (you already have this from Haechrel / our prior chat).
    - This is your **likelihood shape** or deterministic “mean model”.
3. **Bayesian hierarchy around those rates/weights**
    - Treat batter and pitcher event rates (or log-odds) as latent parameters:
        - Batter $b$: θ\_{b,i} ~ Normal(league_mean\_i, league_sd\_i) (shrink toward league/prior).[^5][^1][^2]
        - Pitcher $p$: φ\_{p,i} ~ Normal(league_mean\_i, league_sd\_i).[^1][^2]
    - Put priors on the log5 coefficients β (how strongly batter vs pitcher vs league matter) instead of fixing them.[^2][^1]
    - Fit with MCMC (Stan, PyMC, Turing, etc.) on your historical data (Retrosheet/baseball.computer).[^7][^1][^2]
4. **Defensive and context variables**
    - Include **team defensive efficiency (DER)** or similar as an extra predictor for “reach base” type events as in the four‑variable model.[^1][^2]
    - Optionally include:
        - Handedness interactions (L/R platoon).[^8][^2][^1]
        - Park factors (HR, hits).
        - Recency weights or aging curves (the 2024 work uses recent data emphasis).[^3]
5. **Using the model in-game**
    - Offline: fit the hierarchical model on your historical seasons.
    - For each batter–pitcher pair in your sim:
        - Extract posterior means (or sample from the posterior for extra variance) of the relevant θ, φ, β, defense, etc.[^3][^2][^1]
        - Compute the outcome probability vector via your generalized log5 formula.
        - Sample an outcome from that categorical distribution, then pass to your baserunning / fielding submodels (which you can also build with matchup-style log5 or hierarchical logistic models for steals, advancement, throws, etc.).[^9][^3]

## Why this is a good fit for you

- You already have:
    - Generalized log5 working.
    - Retrosheet / Project Scoresheet data and/or baseball.computer pipelines.[^10][^7]
- The Bayesian hierarchical log5 work literally takes generalized log5 and **wraps it in a Bayesian hierarchy**, solving:
    - Sparse data for rarely-seen matchups (shrinkage).
    - Better calibrated probabilities overall.[^5][^3][^2][^1]

If you want, next step I can sketch explicit model equations and a concrete PyMC / Stan structure tailored to your existing generalized log5 implementation and data schema.
<span style="display:none">[^11][^12][^13][^14][^15][^16][^17][^18][^19]</span>

<div align="center">⁂</div>

[^1]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6192592/

[^2]: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0204874

[^3]: https://arxiv.org/html/2511.17733v1

[^4]: https://sabr.org/journal/article/matchup-probabilities-in-major-league-baseball/

[^5]: https://bayesball.github.io/BLOG/Multilevel.html

[^6]: https://www.baseballprospectus.com/news/article/59993/singlearity-using-a-neural-network-to-predict-the-outcome-of-plate-appearances/

[^7]: https://www.perplexity.ai/search/e03e0341-b864-4539-af3f-99dadd7a5536

[^8]: https://www.reddit.com/r/Sabermetrics/comments/i9kp3e/how_specific_should_you_get_for_an_optimal_log5/

[^9]: https://www.perplexity.ai/search/aef8addb-6592-4c30-9c6a-179832a4bd59

[^10]: interests.web_tools.baseball_computer

[^11]: https://www.perplexity.ai/search/9c146a27-36fc-413d-b781-1b425c8c8e09

[^12]: https://sabr.org/journal/article/does-the-home-team-batting-last-affect-game-outcomes-evidence-from-relocated-games/

[^13]: https://repositories.lib.utexas.edu/bitstreams/88eb5af3-a824-487c-829e-46def421a869/download

[^14]: https://walksaber.blogspot.com/2015/04/reinventing-wheel-now-with-win.html?m=1

[^15]: https://retrosheet.org/Research/Pavitt/retrosheet-d-z.pdf

[^16]: https://ideas.repec.org/a/plo/pone00/0204874.html

[^17]: https://pages.pomona.edu/~jsh04747/Student Theses/GuyStevens13.pdf

[^18]: https://wsb.wharton.upenn.edu/wp-content/uploads/2020/02/Journal-of-Quantitative-Analysis-in-Sports-A-hierarchical-Bayesian-model-of-pitch-framing.pdf

[^19]: https://seam.stat.illinois.edu/seam.pdf

