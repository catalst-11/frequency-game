#!/usr/bin/env python3
"""CLI checker for Color Recall scoring using CIEDE2000.

Examples:
  python ciede2000_score_check.py --target 120,75,80 --guess 132,70,78
  python ciede2000_score_check.py --rounds-file rounds.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Dict, List, Tuple


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def round_to(value: float, decimals: int) -> float:
    factor = 10 ** decimals
    return round(value * factor) / factor


def parse_hsv_token(raw: str) -> Dict[str, int]:
    try:
        h_raw, s_raw, v_raw = [segment.strip() for segment in str(raw).split(",")]
        h = int(h_raw)
        s = int(s_raw)
        v = int(v_raw)
    except Exception as error:  # pragma: no cover
        raise ValueError(f"Invalid HSV token '{raw}'. Expected 'h,s,v'.") from error

    if not (0 <= h <= 360):
        raise ValueError("Hue must be between 0 and 360.")
    if not (0 <= s <= 100):
        raise ValueError("Saturation must be between 0 and 100.")
    if not (0 <= v <= 100):
        raise ValueError("Brightness must be between 0 and 100.")
    return {"h": h, "s": s, "v": v}


def normalize_hsv_obj(raw: dict, label: str) -> Dict[str, int]:
    if not isinstance(raw, dict):
        raise ValueError(f"{label} must be an object with h/s/v.")
    try:
        h = int(raw["h"])
        s = int(raw["s"])
        v = int(raw["v"])
    except Exception as error:
        raise ValueError(f"{label} is missing numeric h/s/v fields.") from error
    return parse_hsv_token(f"{h},{s},{v}")


def hsv_to_rgb(h: int, s: int, v: int) -> Dict[str, int]:
    scaled_s = s / 100
    scaled_v = v / 100
    c = scaled_v * scaled_s
    hh = h / 60
    x = c * (1 - abs((hh % 2) - 1))
    r = g = b = 0.0

    if 0 <= hh < 1:
        r, g, b = c, x, 0
    elif hh < 2:
        r, g, b = x, c, 0
    elif hh < 3:
        r, g, b = 0, c, x
    elif hh < 4:
        r, g, b = 0, x, c
    elif hh < 5:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x

    m = scaled_v - c
    return {
        "r": int(round((r + m) * 255)),
        "g": int(round((g + m) * 255)),
        "b": int(round((b + m) * 255)),
    }


def rgb_to_xyz(rgb: Dict[str, int]) -> Dict[str, float]:
    rr = rgb["r"] / 255
    gg = rgb["g"] / 255
    bb = rgb["b"] / 255

    rr = ((rr + 0.055) / 1.055) ** 2.4 if rr > 0.04045 else rr / 12.92
    gg = ((gg + 0.055) / 1.055) ** 2.4 if gg > 0.04045 else gg / 12.92
    bb = ((bb + 0.055) / 1.055) ** 2.4 if bb > 0.04045 else bb / 12.92

    rr *= 100
    gg *= 100
    bb *= 100

    return {
        "x": (rr * 0.4124) + (gg * 0.3576) + (bb * 0.1805),
        "y": (rr * 0.2126) + (gg * 0.7152) + (bb * 0.0722),
        "z": (rr * 0.0193) + (gg * 0.1192) + (bb * 0.9505),
    }


def xyz_to_lab(xyz: Dict[str, float]) -> Dict[str, float]:
    xx = xyz["x"] / 95.047
    yy = xyz["y"] / 100.0
    zz = xyz["z"] / 108.883

    def f(value: float) -> float:
        return value ** (1 / 3) if value > 0.008856 else ((7.787 * value) + (16 / 116))

    xx = f(xx)
    yy = f(yy)
    zz = f(zz)

    return {
        "l": (116 * yy) - 16,
        "a": 500 * (xx - yy),
        "b": 200 * (yy - zz),
    }


def color_to_lab(color: Dict[str, int]) -> Dict[str, float]:
    return xyz_to_lab(rgb_to_xyz(hsv_to_rgb(color["h"], color["s"], color["v"])))


def radians(degrees_value: float) -> float:
    return (degrees_value * math.pi) / 180


def degrees(radians_value: float) -> float:
    return (radians_value * 180) / math.pi


def delta_e_2000(lab1: Dict[str, float], lab2: Dict[str, float]) -> float:
    l1, a1, b1 = lab1["l"], lab1["a"], lab1["b"]
    l2, a2, b2 = lab2["l"], lab2["a"], lab2["b"]

    c1 = math.sqrt((a1**2) + (b1**2))
    c2 = math.sqrt((a2**2) + (b2**2))
    avg_c = (c1 + c2) / 2
    pow25_to_7 = 6103515625
    g = 0.5 * (1 - math.sqrt((avg_c**7) / ((avg_c**7) + pow25_to_7)))

    a1_prime = (1 + g) * a1
    a2_prime = (1 + g) * a2
    c1_prime = math.sqrt((a1_prime**2) + (b1**2))
    c2_prime = math.sqrt((a2_prime**2) + (b2**2))
    avg_c_prime = (c1_prime + c2_prime) / 2

    h1_prime = math.atan2(b1, a1_prime)
    h2_prime = math.atan2(b2, a2_prime)
    if h1_prime < 0:
        h1_prime += 2 * math.pi
    if h2_prime < 0:
        h2_prime += 2 * math.pi

    delta_l_prime = l2 - l1
    delta_c_prime = c2_prime - c1_prime

    delta_h_prime_angle = 0.0
    if c1_prime * c2_prime != 0:
        delta_h_prime_angle = h2_prime - h1_prime
        if delta_h_prime_angle > math.pi:
            delta_h_prime_angle -= 2 * math.pi
        if delta_h_prime_angle < -math.pi:
            delta_h_prime_angle += 2 * math.pi

    delta_h_prime = 2 * math.sqrt(c1_prime * c2_prime) * math.sin(delta_h_prime_angle / 2)
    avg_l_prime = (l1 + l2) / 2

    if c1_prime * c2_prime == 0:
        avg_h_prime = h1_prime + h2_prime
    elif abs(h1_prime - h2_prime) <= math.pi:
        avg_h_prime = (h1_prime + h2_prime) / 2
    elif (h1_prime + h2_prime) < (2 * math.pi):
        avg_h_prime = (h1_prime + h2_prime + (2 * math.pi)) / 2
    else:
        avg_h_prime = (h1_prime + h2_prime - (2 * math.pi)) / 2

    t = (
        1
        - (0.17 * math.cos(avg_h_prime - radians(30)))
        + (0.24 * math.cos(2 * avg_h_prime))
        + (0.32 * math.cos((3 * avg_h_prime) + radians(6)))
        - (0.20 * math.cos((4 * avg_h_prime) - radians(63)))
    )

    delta_theta = radians(30) * math.exp(-(((degrees(avg_h_prime) - 275) / 25) ** 2))
    r_c = 2 * math.sqrt((avg_c_prime**7) / ((avg_c_prime**7) + pow25_to_7))
    s_l = 1 + ((0.015 * ((avg_l_prime - 50) ** 2)) / math.sqrt(20 + ((avg_l_prime - 50) ** 2)))
    s_c = 1 + (0.045 * avg_c_prime)
    s_h = 1 + (0.015 * avg_c_prime * t)
    r_t = -math.sin(2 * delta_theta) * r_c

    lightness_term = delta_l_prime / s_l
    chroma_term = delta_c_prime / s_c
    hue_term = delta_h_prime / s_h

    return math.sqrt(
        (lightness_term**2)
        + (chroma_term**2)
        + (hue_term**2)
        + (r_t * chroma_term * hue_term)
    )


def hue_difference(a: int, b: int) -> int:
    diff = abs(a - b) % 360
    return 360 - diff if diff > 180 else diff


def compute_round_score(target: Dict[str, int], guess: Dict[str, int]) -> Dict[str, float]:
    de = delta_e_2000(color_to_lab(target), color_to_lab(guess))
    base = 10 / (1 + ((de / 38) ** 1.6))
    hue_diff = hue_difference(target["h"], guess["h"])
    vividness = (target["s"] + guess["s"]) / 200
    recovery = ((1 - (hue_diff / 18)) * 1.15 * vividness) if hue_diff <= 18 else 0
    penalty = (((hue_diff - 42) / 138) * 2.2 * vividness) if (hue_diff > 42 and vividness > 0.35) else 0
    round_score = clamp(base + recovery - penalty, 0, 10)
    return {
        "deltaE2000": de,
        "roundScoreRaw": round_score,
        "roundScore": round_to(round_score, 2),
    }


def compute_run(rounds: List[Tuple[Dict[str, int], Dict[str, int]]]) -> Dict[str, object]:
    scored_rounds = []
    total = 0.0
    for index, (target, guess) in enumerate(rounds, start=1):
        scored = compute_round_score(target, guess)
        total += scored["roundScore"]
        scored_rounds.append(
            {
                "round": index,
                "target": target,
                "guess": guess,
                "deltaE2000": round_to(scored["deltaE2000"], 4),
                "score": scored["roundScore"],
            }
        )

    return {
        "roundCount": len(scored_rounds),
        "rounds": scored_rounds,
        "totalScore": round_to(total, 2),
    }


def load_rounds_file(path: Path) -> List[Tuple[Dict[str, int], Dict[str, int]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        items = data.get("rounds", [])
    elif isinstance(data, list):
        items = data
    else:
        raise ValueError("rounds file must be an array or an object with a 'rounds' array.")

    rounds: List[Tuple[Dict[str, int], Dict[str, int]]] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Round #{index} must be an object.")
        target = normalize_hsv_obj(item.get("target"), f"round #{index} target")
        guess = normalize_hsv_obj(item.get("guess"), f"round #{index} guess")
        rounds.append((target, guess))
    return rounds


def main() -> None:
    parser = argparse.ArgumentParser(description="Check Color Recall score using CIEDE2000.")
    parser.add_argument("--target", help="Target HSV as h,s,v")
    parser.add_argument("--guess", help="Guess HSV as h,s,v")
    parser.add_argument("--rounds-file", help="JSON file with round objects containing target + guess")
    args = parser.parse_args()

    if args.rounds_file:
        rounds = load_rounds_file(Path(args.rounds_file))
        payload = compute_run(rounds)
        print(json.dumps(payload, indent=2))
        return

    if args.target and args.guess:
        target = parse_hsv_token(args.target)
        guess = parse_hsv_token(args.guess)
        scored = compute_round_score(target, guess)
        print(
            json.dumps(
                {
                    "target": target,
                    "guess": guess,
                    "deltaE2000": round_to(scored["deltaE2000"], 4),
                    "roundScoreRaw": round_to(scored["roundScoreRaw"], 6),
                    "roundScore": scored["roundScore"],
                },
                indent=2,
            )
        )
        return

    parser.error("Use either --target with --guess, or --rounds-file.")


if __name__ == "__main__":
    main()
