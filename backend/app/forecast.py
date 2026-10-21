"""Consumption forecast for electricity and gas from meter readings.

A small, explainable model that runs locally (no data leaves the server):

1. Start from a typical seasonal profile: the share of the yearly consumption that falls
   into each month (heating dominates gas in winter, household electricity varies little).
2. Fit the yearly consumption to the readings. Each period between two readings is compared
   with the share of the year the profile expects for exactly those days, so a reading taken
   in January isn't simply extrapolated to the whole year.
3. Learn the household's own profile. With readings covering most of a year, every month gets
   a correction factor from the periods that overlap it, pulled towards the typical profile
   while data is scarce (more readings -> more trust in the household's own pattern).
4. The spread between the periods gives a range instead of a single, falsely precise number.
"""

import calendar
import statistics
from datetime import date, timedelta

# Share of the yearly consumption per month (January ... December), each summing to 1.
PROFILES = {
    # Gas heating incl. hot water: strongly seasonal.
    "heating": [0.160, 0.140, 0.120, 0.080, 0.045, 0.025, 0.020, 0.020, 0.035, 0.080, 0.115, 0.160],
    # Household electricity (standard load profile H0, monthly totals).
    "household": [0.095, 0.085, 0.088, 0.080, 0.078, 0.074, 0.075, 0.076, 0.077, 0.085, 0.090, 0.097],
}
PRIOR_STRENGTH = 0.08  # one month of data weighs as much as the typical profile
MIN_COVERAGE_TO_LEARN = 0.8  # share of a year the readings must cover before learning
DEFAULT_GAS_FACTOR = 10.0  # kWh per m³ (calorific value × z-number), printed on every gas bill


def profile_for(category: str, attributes: dict | None) -> tuple[str, list[float]]:
    attrs = attributes or {}
    if category == "gas":
        return "heating", PROFILES["heating"]
    if attrs.get("heating"):  # heat pump / night storage heating
        mixed = [0.3 * h + 0.7 * g for h, g in zip(PROFILES["household"], PROFILES["heating"], strict=True)]
        return "heat_pump", mixed
    return "household", PROFILES["household"]


def gas_factor(attributes: dict | None) -> float:
    try:
        value = float((attributes or {}).get("gas_factor") or DEFAULT_GAS_FACTOR)
    except (TypeError, ValueError):
        value = DEFAULT_GAS_FACTOR
    return value if 5 <= value <= 15 else DEFAULT_GAS_FACTOR


def _month_days(start: date, end: date) -> dict[int, tuple[int, int]]:
    """Days per month (0-11) for start < d <= end, with the length of that month."""
    out: dict[int, tuple[int, int]] = {}
    day = start + timedelta(days=1)
    while day <= end:
        days_in_month = calendar.monthrange(day.year, day.month)[1]
        last = min(end, date(day.year, day.month, days_in_month))
        days = (last - day).days + 1
        m = day.month - 1
        prev = out.get(m, (0, days_in_month))[0]
        out[m] = (prev + days, days_in_month)
        day = last + timedelta(days=1)
    return out


def month_weights(profile: list[float], start: date, end: date) -> dict[int, float]:
    """Expected share of the yearly consumption per month (0-11) for the days start < d <= end."""
    return {m: profile[m] * days / length for m, (days, length) in _month_days(start, end).items()}


def _periods(readings: list[tuple[date, float]]) -> list[dict]:
    out = []
    for (d0, v0), (d1, v1) in zip(readings, readings[1:], strict=False):
        consumed = v1 - v0
        if (d1 - d0).days <= 0 or consumed < 0:  # same day or meter replaced/reset
            continue
        months = _month_days(d0, d1)
        out.append(
            {
                "consumed": consumed,
                "time": {m: days / 365 for m, (days, _len) in months.items()},  # share of a year per month
                "fraction": {m: days / length for m, (days, length) in months.items()},  # share of each month
            }
        )
    return out


def _expected(period: dict, profile: list[float]) -> float:
    return sum(profile[m] * f for m, f in period["fraction"].items())


def _fit(periods: list[dict], profile: list[float]) -> float:
    expected = sum(_expected(p, profile) for p in periods)
    return sum(p["consumed"] for p in periods) / expected if expected else 0.0


def _learn(profile: list[float], periods: list[dict], iterations: int = 25) -> list[float]:
    """Adapt the monthly shares to the readings (iterative proportional fitting).

    Each round compares every period with its prediction and moves the months it covers towards
    the observed ratio, weighted by how much of the month the period covers. Months without data
    keep the typical share; PRIOR_STRENGTH damps each step so a single odd reading can't dominate.
    """
    learned = list(profile)
    for _ in range(iterations):
        annual = _fit(periods, learned)
        num = [0.0] * 12
        den = [0.0] * 12
        for p in periods:
            expected = annual * _expected(p, learned)
            ratio = p["consumed"] / expected if expected else 1.0
            for m, t in p["time"].items():
                num[m] += t * ratio
                den[m] += t
        learned = [learned[m] * (num[m] + PRIOR_STRENGTH) / (den[m] + PRIOR_STRENGTH) for m in range(12)]
        total = sum(learned)
        learned = [v / total for v in learned]
    return learned


def forecast(readings: list[tuple[date, float]], category: str, attributes: dict | None = None) -> dict | None:
    """Yearly consumption (kWh) with range from meter readings; None with fewer than two usable readings."""
    if category == "gas":
        factor = gas_factor(attributes)
        readings = [(d, v * factor) for d, v in readings]
    readings = sorted(readings)
    kind, profile = profile_for(category, attributes)
    periods = _periods(readings)
    if not periods:
        return None
    # Share of a typical year's consumption the readings cover (each calendar month counted once).
    seen = [0.0] * 12
    for p in periods:
        for m, f in p["fraction"].items():
            seen[m] = min(1.0, seen[m] + f)
    coverage = sum(profile[m] * seen[m] for m in range(12))
    learned = False
    if coverage >= MIN_COVERAGE_TO_LEARN and len(periods) >= 4:
        profile = _learn(profile, periods)
        learned = True
    annual = _fit(periods, profile)

    # Uncertainty: how much the periods disagree, plus how much of the year is still unseen.
    ratios = [
        p["consumed"] / (annual * _expected(p, profile)) for p in periods if annual and _expected(p, profile) > 0.005
    ]
    # ~90 % range: statistical error of the fit plus a generous allowance for the unseen months,
    # where a household may differ a lot from the typical profile.
    spread = 1.65 * statistics.pstdev(ratios) / len(ratios) ** 0.5 if len(ratios) >= 3 else 0.0
    rel = min(0.6, max(spread, 0.05) + 0.5 * max(0.0, 1 - coverage))
    return {
        "annual_kwh": round(annual),
        "low_kwh": round(annual * (1 - rel)),
        "high_kwh": round(annual * (1 + rel)),
        "relative_uncertainty": round(rel, 3),
        "monthly_kwh": [round(annual * s, 1) for s in profile],
        "profile": kind,
        "learned": learned,
        "coverage": round(min(coverage, 1.0), 2),
        "periods": len(periods),
        "gas_factor": gas_factor(attributes) if category == "gas" else None,
    }
