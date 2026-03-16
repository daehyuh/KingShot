import hashlib
import json
import time
from urllib import error, request

API_URL = "https://kingshot-giftcode.centurygame.com/api/player"
SECRET = "mN4!pQs6JrYwV9"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
BASE_BACKOFF_SECONDS = 0.8
MAX_BACKOFF_SECONDS = 8.0
MAX_RETRIES = 6


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None

    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None

    return max(0.0, seconds)


def _short_detail(detail: str, max_len: int = 180) -> str:
    compact = " ".join(detail.split())
    if len(compact) <= max_len:
        return compact
    return compact[:max_len] + "..."


def _build_http_error_message(status_code: int, detail: str) -> str:
    if status_code == 429:
        return "Rate limited by game API (HTTP 429). Please retry shortly."

    if status_code == 404:
        return "Player endpoint returned HTTP 404."

    summary = _short_detail(detail)
    return f"HTTP error {status_code}: {summary}" if summary else f"HTTP error {status_code}"


def make_signed_form(fid: int) -> tuple[str, int, str]:
    current_time_ms = int(time.time() * 1000)
    base = f"fid={fid}&time={current_time_ms}"
    sign = hashlib.md5((base + SECRET).encode("utf-8")).hexdigest()
    form = f"sign={sign}&{base}"
    return sign, current_time_ms, form


def fetch_player(fid: int) -> dict:
    for attempt in range(MAX_RETRIES + 1):
        sign, current_time_ms, form = make_signed_form(fid)
        body = form.encode("utf-8")

        req = request.Request(
            API_URL,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "Mozilla/5.0",
            },
        )

        try:
            with request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")

            if e.code in RETRYABLE_STATUS_CODES and attempt < MAX_RETRIES:
                retry_after = _parse_retry_after(e.headers.get("Retry-After"))
                backoff = (
                    retry_after
                    if retry_after is not None
                    else min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * (2**attempt))
                )
                time.sleep(backoff)
                continue

            raise RuntimeError(_build_http_error_message(e.code, detail)) from e
        except error.URLError as e:
            if attempt < MAX_RETRIES:
                backoff = min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * (2**attempt))
                time.sleep(backoff)
                continue
            raise RuntimeError(f"Network error: {e.reason}") from e

        if isinstance(result, dict):
            result.setdefault("_request", {})
            if isinstance(result["_request"], dict):
                result["_request"]["fid"] = fid
                result["_request"]["time"] = current_time_ms
                result["_request"]["sign"] = sign

        return result

    raise RuntimeError("Failed to fetch player after multiple retries")


def extract_player_data(result: object) -> dict:
    if not isinstance(result, dict):
        return {}

    data = result.get("data", {})
    if isinstance(data, dict):
        return data

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                return item
        return {}

    return {}
