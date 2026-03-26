import argparse
import json
import mimetypes
import sqlite3
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from player_api import extract_player_data, fetch_gift_code, fetch_player

LEGION_1 = "legion1"
LEGION_2 = "legion2"
ALLIANCE_RANKS = ("R5", "R4", "R3", "R2", "R1", "R0")
BULK_USER_REQUEST_DELAY_SECONDS = 0.35
DEFAULT_ALLIANCE_NAME = "Ace"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_fid(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("fid must be an integer")

    try:
        fid = int(value)
    except (TypeError, ValueError) as e:
        raise ValueError("fid must be an integer") from e

    if fid <= 0:
        raise ValueError("fid must be greater than 0")

    return fid


def normalize_event_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("event_id must be an integer")

    try:
        event_id = int(value)
    except (TypeError, ValueError) as e:
        raise ValueError("event_id must be an integer") from e

    if event_id <= 0:
        raise ValueError("event_id must be greater than 0")

    return event_id


def normalize_gift_code_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("gift_code_id must be an integer")

    try:
        gift_code_id = int(value)
    except (TypeError, ValueError) as e:
        raise ValueError("gift_code_id must be an integer") from e

    if gift_code_id <= 0:
        raise ValueError("gift_code_id must be greater than 0")

    return gift_code_id


def normalize_fids(values: Any) -> list[int]:
    if not isinstance(values, list):
        raise ValueError("fids must be a list of integers")

    parsed: list[int] = []
    seen: set[int] = set()

    for value in values:
        fid = normalize_fid(value)
        if fid not in seen:
            parsed.append(fid)
            seen.add(fid)

    if not parsed:
        raise ValueError("fids cannot be empty")

    return parsed


def normalize_event_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("name must be a string")

    name = value.strip()
    if not name:
        raise ValueError("name cannot be empty")

    if len(name) > 120:
        raise ValueError("name is too long")

    return name


def normalize_alliance_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("alliance name must be a string")

    name = " ".join(value.split())
    if not name:
        raise ValueError("alliance name cannot be empty")

    if len(name) > 80:
        raise ValueError("alliance name is too long")

    return name


def normalize_alliance_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("alliance_id must be an integer")

    try:
        alliance_id = int(value)
    except (TypeError, ValueError) as e:
        raise ValueError("alliance_id must be an integer") from e

    if alliance_id <= 0:
        raise ValueError("alliance_id must be greater than 0")

    return alliance_id


def normalize_optional_alliance_id(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return normalize_alliance_id(value)


def normalize_gift_code(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("code must be a string")

    code = value.strip()
    if not code:
        raise ValueError("code cannot be empty")

    if len(code) > 64:
        raise ValueError("code is too long")

    if any(char.isspace() for char in code):
        raise ValueError("code cannot contain spaces")

    return code


def normalize_captcha_code(value: Any) -> str:
    if value is None:
        return ""

    if not isinstance(value, str):
        raise ValueError("captcha_code must be a string")

    captcha_code = value.strip()
    if len(captcha_code) > 64:
        raise ValueError("captcha_code is too long")

    if any(char.isspace() for char in captcha_code):
        raise ValueError("captcha_code cannot contain spaces")

    return captcha_code


def normalize_alliance_rank(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("rank must be a string")

    normalized = value.strip().upper().replace(" ", "")
    if normalized not in ALLIANCE_RANKS:
        raise ValueError("rank must be one of R5, R4, R3, R2, R1, R0")

    return normalized


def normalize_legion(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("legion must be a string")

    key = value.strip().lower().replace(" ", "")

    mapping = {
        "1": LEGION_1,
        "l1": LEGION_1,
        "legion1": LEGION_1,
        "legion-1": LEGION_1,
        "2": LEGION_2,
        "l2": LEGION_2,
        "legion2": LEGION_2,
        "legion-2": LEGION_2,
    }

    normalized = mapping.get(key)
    if not normalized:
        raise ValueError("legion must be Legion1 or Legion2")

    return normalized


def db_connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_or_create_alliance_id_conn(conn: sqlite3.Connection, name: str) -> int:
    normalized_name = normalize_alliance_name(name)
    existing = conn.execute(
        "SELECT id FROM alliances WHERE name = ?",
        (normalized_name,),
    ).fetchone()
    if existing:
        return int(existing["id"])

    now = utc_now_iso()
    cur = conn.execute(
        """
        INSERT INTO alliances (name, created_at, updated_at)
        VALUES (?, ?, ?)
        """,
        (normalized_name, now, now),
    )
    return int(cur.lastrowid)


def ensure_alliance_exists_conn(conn: sqlite3.Connection, alliance_id: int) -> int:
    normalized_alliance_id = normalize_alliance_id(alliance_id)
    row = conn.execute(
        "SELECT id FROM alliances WHERE id = ?",
        (normalized_alliance_id,),
    ).fetchone()
    if not row:
        raise LookupError("alliance not found")
    return int(row["id"])


def migrate_alliances_table_case_sensitive_conn(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        """
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'alliances'
        """
    ).fetchone()

    if not row:
        return

    create_sql = str(row["sql"] or "")
    if "COLLATE NOCASE" not in create_sql.upper():
        return

    conn.execute("DROP TABLE IF EXISTS alliances__case_sensitive")
    conn.execute(
        """
        CREATE TABLE alliances__case_sensitive (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO alliances__case_sensitive (id, name, created_at, updated_at)
        SELECT id, name, created_at, updated_at
        FROM alliances
        ORDER BY id ASC
        """
    )
    conn.execute("DROP TABLE alliances")
    conn.execute("ALTER TABLE alliances__case_sensitive RENAME TO alliances")


def init_db(db_path: str) -> None:
    with db_connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alliances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        migrate_alliances_table_case_sensitive_conn(conn)
        default_alliance_id = get_or_create_alliance_id_conn(conn, DEFAULT_ALLIANCE_NAME)

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                fid INTEGER PRIMARY KEY,
                nickname TEXT,
                alliance_id INTEGER NOT NULL,
                kid INTEGER,
                stove_lv INTEGER,
                stove_lv_content INTEGER,
                avatar_image TEXT,
                total_recharge_amount INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                alliance_id INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS event_members (
                event_id INTEGER NOT NULL,
                fid INTEGER NOT NULL,
                legion TEXT NOT NULL CHECK (legion IN ('legion1', 'legion2')),
                assigned_at TEXT NOT NULL,
                PRIMARY KEY (event_id, fid),
                FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
                FOREIGN KEY(fid) REFERENCES users(fid) ON DELETE CASCADE
            )
            """
        )

        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "alliance_rank" not in user_columns:
            conn.execute(
                """
                ALTER TABLE users
                ADD COLUMN alliance_rank TEXT NOT NULL DEFAULT 'R0'
                """
            )
        if "alliance_id" not in user_columns:
            conn.execute(
                """
                ALTER TABLE users
                ADD COLUMN alliance_id INTEGER
                """
            )
        conn.execute(
            """
            UPDATE users
            SET alliance_rank = 'R0'
            WHERE alliance_rank IS NULL OR TRIM(alliance_rank) = ''
            """
        )
        conn.execute(
            """
            UPDATE users
            SET alliance_id = ?
            WHERE alliance_id IS NULL
            """,
            (default_alliance_id,),
        )

        event_columns = {row["name"] for row in conn.execute("PRAGMA table_info(events)").fetchall()}
        if "alliance_id" not in event_columns:
            conn.execute(
                """
                ALTER TABLE events
                ADD COLUMN alliance_id INTEGER
                """
            )
        conn.execute(
            """
            UPDATE events
            SET alliance_id = ?
            WHERE alliance_id IS NULL
            """,
            (default_alliance_id,),
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS gift_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_alliance_id ON users(alliance_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_alliance_id ON events(alliance_id)")
        conn.commit()


def get_alliance(db_path: str, alliance_id: int) -> dict[str, Any] | None:
    with db_connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM alliances
            WHERE id = ?
            """,
            (normalize_alliance_id(alliance_id),),
        ).fetchone()

    return dict(row) if row else None


def list_alliances(db_path: str) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM alliances
            ORDER BY name COLLATE NOCASE, id ASC
            """
        ).fetchall()

    return [dict(row) for row in rows]


def create_alliance(db_path: str, name: str) -> dict[str, Any]:
    normalized_name = normalize_alliance_name(name)
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM alliances WHERE name = ?",
            (normalized_name,),
        ).fetchone()

        if existing:
            alliance_id = int(existing["id"])
            status = "exists"
        else:
            cur = conn.execute(
                """
                INSERT INTO alliances (name, created_at, updated_at)
                VALUES (?, ?, ?)
                """,
                (normalized_name, now, now),
            )
            alliance_id = int(cur.lastrowid)
            conn.commit()
            status = "added"

    saved = get_alliance(db_path, alliance_id)
    if not saved:
        raise RuntimeError("failed to save alliance")

    return {
        "status": status,
        "alliance": saved,
    }


def get_user(db_path: str, fid: int) -> dict[str, Any] | None:
    with db_connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                u.fid,
                u.nickname,
                u.alliance_id,
                COALESCE(a.name, '') AS alliance_name,
                u.kid,
                COALESCE(u.alliance_rank, 'R0') AS alliance_rank,
                u.stove_lv,
                u.stove_lv_content,
                u.avatar_image,
                u.total_recharge_amount,
                u.created_at,
                u.updated_at
            FROM users u
            LEFT JOIN alliances a ON a.id = u.alliance_id
            WHERE u.fid = ?
            """,
            (fid,),
        ).fetchone()

    return dict(row) if row else None


def list_users(db_path: str, alliance_id: int | None = None) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        if alliance_id is None:
            rows = conn.execute(
                """
                SELECT
                    u.fid,
                    u.nickname,
                    u.alliance_id,
                    COALESCE(a.name, '') AS alliance_name,
                    u.kid,
                    COALESCE(u.alliance_rank, 'R0') AS alliance_rank,
                    u.stove_lv,
                    u.stove_lv_content,
                    u.avatar_image,
                    u.total_recharge_amount,
                    u.created_at,
                    u.updated_at
                FROM users u
                LEFT JOIN alliances a ON a.id = u.alliance_id
                ORDER BY
                    CASE WHEN u.nickname IS NULL OR u.nickname = '' THEN 1 ELSE 0 END,
                    u.nickname COLLATE NOCASE,
                    u.fid ASC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT
                    u.fid,
                    u.nickname,
                    u.alliance_id,
                    COALESCE(a.name, '') AS alliance_name,
                    u.kid,
                    COALESCE(u.alliance_rank, 'R0') AS alliance_rank,
                    u.stove_lv,
                    u.stove_lv_content,
                    u.avatar_image,
                    u.total_recharge_amount,
                    u.created_at,
                    u.updated_at
                FROM users u
                LEFT JOIN alliances a ON a.id = u.alliance_id
                WHERE u.alliance_id = ?
                ORDER BY
                    CASE WHEN u.nickname IS NULL OR u.nickname = '' THEN 1 ELSE 0 END,
                    u.nickname COLLATE NOCASE,
                    u.fid ASC
                """,
                (normalize_alliance_id(alliance_id),),
            ).fetchall()

    return [dict(row) for row in rows]


def upsert_user(db_path: str, user: dict[str, Any], alliance_id: int | None = None) -> str:
    fid = normalize_fid(user.get("fid"))
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        existing = conn.execute(
            "SELECT alliance_id FROM users WHERE fid = ?",
            (fid,),
        ).fetchone()
        status = "updated" if existing else "added"

        if alliance_id is None:
            if existing and existing["alliance_id"] is not None:
                resolved_alliance_id = normalize_alliance_id(existing["alliance_id"])
            else:
                resolved_alliance_id = get_or_create_alliance_id_conn(conn, DEFAULT_ALLIANCE_NAME)
        else:
            resolved_alliance_id = ensure_alliance_exists_conn(conn, alliance_id)

        conn.execute(
            """
            INSERT INTO users (
                fid,
                nickname,
                alliance_id,
                kid,
                stove_lv,
                stove_lv_content,
                avatar_image,
                total_recharge_amount,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fid) DO UPDATE SET
                nickname = excluded.nickname,
                alliance_id = excluded.alliance_id,
                kid = excluded.kid,
                stove_lv = excluded.stove_lv,
                stove_lv_content = excluded.stove_lv_content,
                avatar_image = excluded.avatar_image,
                total_recharge_amount = excluded.total_recharge_amount,
                updated_at = excluded.updated_at
            """,
            (
                fid,
                user.get("nickname"),
                resolved_alliance_id,
                user.get("kid"),
                user.get("stove_lv"),
                user.get("stove_lv_content"),
                user.get("avatar_image"),
                user.get("total_recharge_amount"),
                now,
                now,
            ),
        )
        conn.commit()

    return status


def delete_user(db_path: str, fid: int) -> bool:
    with db_connect(db_path) as conn:
        cur = conn.execute("DELETE FROM users WHERE fid = ?", (fid,))
        conn.commit()
    return cur.rowcount > 0


def delete_users(db_path: str, fids: list[int]) -> list[int]:
    deleted: list[int] = []

    for fid in fids:
        if delete_user(db_path, fid):
            deleted.append(fid)

    return deleted


def list_user_fids(db_path: str, alliance_id: int | None = None) -> list[int]:
    with db_connect(db_path) as conn:
        if alliance_id is None:
            rows = conn.execute(
                """
                SELECT fid
                FROM users
                ORDER BY fid ASC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT fid
                FROM users
                WHERE alliance_id = ?
                ORDER BY fid ASC
                """,
                (normalize_alliance_id(alliance_id),),
            ).fetchall()

    return [normalize_fid(row["fid"]) for row in rows]


def refresh_users_from_api(db_path: str, fids: list[int] | None = None) -> dict[str, Any]:
    target_fids = list_user_fids(db_path) if fids is None else list(fids)
    if not target_fids:
        return {
            "total": 0,
            "added": 0,
            "updated": 0,
            "failed": 0,
            "failed_fids": [],
            "results": [],
        }

    results: list[dict[str, Any]] = []
    for idx, fid in enumerate(target_fids):
        results.append(fetch_and_save_user(db_path, fid))
        if idx < len(target_fids) - 1:
            # External API applies rate limits; short spacing helps avoid 429 bursts.
            time.sleep(BULK_USER_REQUEST_DELAY_SECONDS)

    added = sum(1 for item in results if item.get("status") == "added")
    updated = sum(1 for item in results if item.get("status") == "updated")
    failed = sum(1 for item in results if item.get("status") == "error")
    failed_fids = [item.get("fid") for item in results if item.get("status") == "error"]

    return {
        "total": len(target_fids),
        "added": added,
        "updated": updated,
        "failed": failed,
        "failed_fids": failed_fids,
        "results": results,
    }


def update_user_rank(db_path: str, fid: int, rank: str) -> dict[str, Any]:
    normalized_fid = normalize_fid(fid)
    normalized_rank = normalize_alliance_rank(rank)
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        user_row = conn.execute("SELECT 1 FROM users WHERE fid = ?", (normalized_fid,)).fetchone()
        if not user_row:
            raise LookupError("user not found")

        conn.execute(
            """
            UPDATE users
            SET alliance_rank = ?, updated_at = ?
            WHERE fid = ?
            """,
            (normalized_rank, now, normalized_fid),
        )
        conn.commit()

    updated_user = get_user(db_path, normalized_fid)
    if not updated_user:
        raise LookupError("user not found")
    return updated_user


def update_user_alliance(db_path: str, fid: int, alliance_id: int) -> dict[str, Any]:
    normalized_fid = normalize_fid(fid)
    normalized_alliance_id = normalize_alliance_id(alliance_id)
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        user_row = conn.execute("SELECT 1 FROM users WHERE fid = ?", (normalized_fid,)).fetchone()
        if not user_row:
            raise LookupError("user not found")

        ensure_alliance_exists_conn(conn, normalized_alliance_id)

        conn.execute(
            """
            UPDATE users
            SET alliance_id = ?, updated_at = ?
            WHERE fid = ?
            """,
            (normalized_alliance_id, now, normalized_fid),
        )
        conn.execute(
            """
            DELETE FROM event_members
            WHERE fid = ?
              AND event_id IN (
                SELECT id
                FROM events
                WHERE alliance_id != ?
              )
            """,
            (normalized_fid, normalized_alliance_id),
        )
        conn.commit()

    updated_user = get_user(db_path, normalized_fid)
    if not updated_user:
        raise LookupError("user not found")
    return updated_user


def fetch_and_save_user(db_path: str, fid: int, alliance_id: int | None = None) -> dict[str, Any]:
    try:
        result = fetch_player(fid)
    except RuntimeError as e:
        return {
            "fid": fid,
            "status": "error",
            "message": str(e),
        }

    if not isinstance(result, dict):
        return {
            "fid": fid,
            "status": "error",
            "message": "invalid API response type",
        }

    if result.get("code") != 0:
        return {
            "fid": fid,
            "status": "error",
            "message": str(result.get("msg") or "API error"),
            "err_code": result.get("err_code"),
        }

    data = extract_player_data(result)
    if not data:
        return {
            "fid": fid,
            "status": "error",
            "message": "player data is empty",
        }

    normalized_user = {
        "fid": data.get("fid", fid),
        "nickname": data.get("nickname"),
        "kid": data.get("kid"),
        "stove_lv": data.get("stove_lv"),
        "stove_lv_content": data.get("stove_lv_content"),
        "avatar_image": data.get("avatar_image"),
        "total_recharge_amount": data.get("total_recharge_amount"),
    }

    try:
        status = upsert_user(db_path, normalized_user, alliance_id=alliance_id)
    except (LookupError, ValueError) as e:
        return {
            "fid": fid,
            "status": "error",
            "message": str(e),
        }

    saved = get_user(db_path, normalize_fid(normalized_user.get("fid")))
    return {
        "fid": normalize_fid(normalized_user.get("fid")),
        "status": status,
        "user": saved,
    }


def redeem_gift_code(fid: int, cdk: str, captcha_code: str) -> dict[str, Any]:
    def build_error_response(
        message: str,
        result: dict[str, Any] | None = None,
        login_refreshed: bool = False,
        initial_response: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "fid": fid,
            "cdk": cdk,
            "captcha_code": captcha_code,
            "status": "error",
            "message": message,
            "login_refreshed": login_refreshed,
        }
        if result:
            payload["err_code"] = result.get("err_code")
            payload["api_code"] = result.get("code")
            payload["response"] = result
        if initial_response is not None:
            payload["initial_response"] = initial_response
        return payload

    def build_success_response(
        result: dict[str, Any],
        login_refreshed: bool = False,
        initial_response: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "fid": fid,
            "cdk": cdk,
            "captcha_code": captcha_code,
            "status": "success",
            "login_refreshed": login_refreshed,
            "response": result,
        }
        if initial_response is not None:
            payload["initial_response"] = initial_response
        return payload

    def needs_login_retry(result: dict[str, Any]) -> bool:
        err_code = result.get("err_code")
        msg = str(result.get("msg") or "").strip().upper()
        return str(err_code) == "40009" or msg == "NOT LOGIN."

    try:
        result = fetch_gift_code(fid, cdk, captcha_code)
    except RuntimeError as e:
        return build_error_response(str(e))

    if not isinstance(result, dict):
        return build_error_response("invalid API response type")

    if result.get("code") == 0:
        return build_success_response(result)

    if not needs_login_retry(result):
        return build_error_response(str(result.get("msg") or "API error"), result=result)

    try:
        player_result = fetch_player(fid)
    except RuntimeError as e:
        return build_error_response(f"login preflight failed: {e}", result=result)

    if not isinstance(player_result, dict):
        return build_error_response("login preflight failed: invalid API response type", result=result)

    if player_result.get("code") != 0:
        login_message = str(player_result.get("msg") or "login preflight API error")
        return build_error_response(
            f"login preflight failed: {login_message}",
            result=result,
        )

    try:
        retried = fetch_gift_code(fid, cdk, captcha_code)
    except RuntimeError as e:
        return build_error_response(
            f"redeem retry failed: {e}",
            result=result,
            login_refreshed=True,
            initial_response=result,
        )

    if not isinstance(retried, dict):
        return build_error_response(
            "redeem retry failed: invalid API response type",
            result=result,
            login_refreshed=True,
            initial_response=result,
        )

    if retried.get("code") != 0:
        return build_error_response(
            str(retried.get("msg") or "API error"),
            result=retried,
            login_refreshed=True,
            initial_response=result,
        )

    return build_success_response(retried, login_refreshed=True, initial_response=result)


def get_event(db_path: str, event_id: int) -> dict[str, Any] | None:
    with db_connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                e.id,
                e.name,
                e.alliance_id,
                COALESCE(a.name, '') AS alliance_name,
                e.created_at
            FROM events e
            LEFT JOIN alliances a ON a.id = e.alliance_id
            WHERE e.id = ?
            """,
            (event_id,),
        ).fetchone()

    return dict(row) if row else None


def get_gift_code(db_path: str, gift_code_id: int) -> dict[str, Any] | None:
    with db_connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, code, created_at, updated_at
            FROM gift_codes
            WHERE id = ?
            """,
            (gift_code_id,),
        ).fetchone()

    return dict(row) if row else None


def list_gift_codes(db_path: str) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, code, created_at, updated_at
            FROM gift_codes
            ORDER BY id DESC
            """
        ).fetchall()

    return [dict(row) for row in rows]


def upsert_gift_code(db_path: str, code: str) -> dict[str, Any]:
    normalized_code = normalize_gift_code(code)
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM gift_codes WHERE code = ? COLLATE NOCASE",
            (normalized_code,),
        ).fetchone()

        status = "exists" if existing else "added"
        if existing:
            gift_code_id = int(existing["id"])
            conn.execute(
                "UPDATE gift_codes SET code = ?, updated_at = ? WHERE id = ?",
                (normalized_code, now, gift_code_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO gift_codes (code, created_at, updated_at)
                VALUES (?, ?, ?)
                """,
                (normalized_code, now, now),
            )
            gift_code_id = int(cur.lastrowid)

        conn.commit()

    saved = get_gift_code(db_path, gift_code_id)
    if not saved:
        raise RuntimeError("failed to save gift code")

    return {
        "status": status,
        "gift_code": saved,
    }


def delete_gift_code(db_path: str, gift_code_id: int) -> bool:
    with db_connect(db_path) as conn:
        cur = conn.execute("DELETE FROM gift_codes WHERE id = ?", (gift_code_id,))
        conn.commit()

    return cur.rowcount > 0


def create_event(db_path: str, name: str, alliance_id: int) -> dict[str, Any]:
    now = utc_now_iso()
    normalized_alliance_id = normalize_alliance_id(alliance_id)

    with db_connect(db_path) as conn:
        ensure_alliance_exists_conn(conn, normalized_alliance_id)
        cur = conn.execute(
            "INSERT INTO events (name, alliance_id, created_at) VALUES (?, ?, ?)",
            (name, normalized_alliance_id, now),
        )
        event_id = cur.lastrowid
        conn.commit()

    event = get_event(db_path, int(event_id))
    if not event:
        raise RuntimeError("failed to create event")

    return event


def list_events(db_path: str, alliance_id: int | None = None) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        if alliance_id is None:
            rows = conn.execute(
                """
                SELECT
                    e.id,
                    e.name,
                    e.alliance_id,
                    COALESCE(a.name, '') AS alliance_name,
                    e.created_at,
                    SUM(CASE WHEN em.legion = 'legion1' THEN 1 ELSE 0 END) AS legion1_count,
                    SUM(CASE WHEN em.legion = 'legion2' THEN 1 ELSE 0 END) AS legion2_count
                FROM events e
                LEFT JOIN alliances a ON a.id = e.alliance_id
                LEFT JOIN event_members em ON em.event_id = e.id
                GROUP BY e.id, e.name, e.alliance_id, a.name, e.created_at
                ORDER BY e.id DESC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT
                    e.id,
                    e.name,
                    e.alliance_id,
                    COALESCE(a.name, '') AS alliance_name,
                    e.created_at,
                    SUM(CASE WHEN em.legion = 'legion1' THEN 1 ELSE 0 END) AS legion1_count,
                    SUM(CASE WHEN em.legion = 'legion2' THEN 1 ELSE 0 END) AS legion2_count
                FROM events e
                LEFT JOIN alliances a ON a.id = e.alliance_id
                LEFT JOIN event_members em ON em.event_id = e.id
                WHERE e.alliance_id = ?
                GROUP BY e.id, e.name, e.alliance_id, a.name, e.created_at
                ORDER BY e.id DESC
                """,
                (normalize_alliance_id(alliance_id),),
            ).fetchall()

    return [dict(row) for row in rows]


def delete_event(db_path: str, event_id: int) -> bool:
    with db_connect(db_path) as conn:
        cur = conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
        conn.commit()

    return cur.rowcount > 0


def assign_user_to_event_legion(db_path: str, event_id: int, fid: int, legion: str) -> dict[str, Any]:
    assigned_at = utc_now_iso()

    with db_connect(db_path) as conn:
        event_row = conn.execute("SELECT alliance_id FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event_row:
            raise LookupError("event not found")

        user_row = conn.execute("SELECT alliance_id FROM users WHERE fid = ?", (fid,)).fetchone()
        if not user_row:
            raise LookupError("user not found")

        event_alliance_id = normalize_alliance_id(event_row["alliance_id"])
        user_alliance_id = normalize_alliance_id(user_row["alliance_id"])
        if user_alliance_id != event_alliance_id:
            raise ValueError("user belongs to a different alliance")

        existing = conn.execute(
            "SELECT legion FROM event_members WHERE event_id = ? AND fid = ?",
            (event_id, fid),
        ).fetchone()

        from_legion = existing["legion"] if existing else None
        status = "assigned" if from_legion is None else "moved" if from_legion != legion else "updated"

        conn.execute(
            """
            INSERT INTO event_members (event_id, fid, legion, assigned_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(event_id, fid) DO UPDATE SET
                legion = excluded.legion,
                assigned_at = excluded.assigned_at
            """,
            (event_id, fid, legion, assigned_at),
        )
        conn.commit()

    return {
        "event_id": event_id,
        "fid": fid,
        "status": status,
        "from_legion": from_legion,
        "to_legion": legion,
        "assigned_at": assigned_at,
    }


def clear_legion(db_path: str, event_id: int, legion: str) -> int:
    with db_connect(db_path) as conn:
        event_row = conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event_row:
            raise LookupError("event not found")

        cur = conn.execute(
            "DELETE FROM event_members WHERE event_id = ? AND legion = ?",
            (event_id, legion),
        )
        conn.commit()

    return int(cur.rowcount)


def remove_event_member(db_path: str, event_id: int, fid: int) -> bool:
    with db_connect(db_path) as conn:
        event_row = conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event_row:
            raise LookupError("event not found")

        cur = conn.execute(
            "DELETE FROM event_members WHERE event_id = ? AND fid = ?",
            (event_id, fid),
        )
        conn.commit()

    return cur.rowcount > 0


def list_event_legion_members(db_path: str, event_id: int, legion: str) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                u.fid,
                u.nickname,
                u.alliance_id,
                COALESCE(a.name, '') AS alliance_name,
                u.kid,
                COALESCE(u.alliance_rank, 'R0') AS alliance_rank,
                u.stove_lv,
                u.stove_lv_content,
                u.avatar_image,
                u.total_recharge_amount,
                em.assigned_at,
                em.legion
            FROM event_members em
            JOIN users u ON u.fid = em.fid
            JOIN events e ON e.id = em.event_id
            LEFT JOIN alliances a ON a.id = u.alliance_id
            WHERE em.event_id = ? AND em.legion = ? AND u.alliance_id = e.alliance_id
            ORDER BY
                CASE WHEN u.nickname IS NULL OR u.nickname = '' THEN 1 ELSE 0 END,
                u.nickname COLLATE NOCASE,
                u.fid ASC
            """,
            (event_id, legion),
        ).fetchall()

    return [dict(row) for row in rows]


def list_event_unassigned_users(db_path: str, event_id: int, alliance_id: int) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                u.fid,
                u.nickname,
                u.alliance_id,
                COALESCE(a.name, '') AS alliance_name,
                u.kid,
                COALESCE(u.alliance_rank, 'R0') AS alliance_rank,
                u.stove_lv,
                u.stove_lv_content,
                u.avatar_image,
                u.total_recharge_amount,
                u.created_at,
                u.updated_at
            FROM users u
            LEFT JOIN alliances a ON a.id = u.alliance_id
            LEFT JOIN event_members em
                ON em.fid = u.fid
                AND em.event_id = ?
            WHERE em.fid IS NULL
              AND u.alliance_id = ?
            ORDER BY
                CASE WHEN u.nickname IS NULL OR u.nickname = '' THEN 1 ELSE 0 END,
                u.nickname COLLATE NOCASE,
                u.fid ASC
            """,
            (event_id, normalize_alliance_id(alliance_id)),
        ).fetchall()

    return [dict(row) for row in rows]


def get_event_board(db_path: str, event_id: int) -> dict[str, Any] | None:
    event = get_event(db_path, event_id)
    if not event:
        return None

    event_alliance_id = normalize_alliance_id(event["alliance_id"])
    legion1 = list_event_legion_members(db_path, event_id, LEGION_1)
    legion2 = list_event_legion_members(db_path, event_id, LEGION_2)
    unassigned = list_event_unassigned_users(db_path, event_id, event_alliance_id)

    return {
        "event": event,
        "legion1": legion1,
        "legion2": legion2,
        "unassigned": unassigned,
        "counts": {
            "legion1": len(legion1),
            "legion2": len(legion2),
            "unassigned": len(unassigned),
        },
    }


class AllianceHandler(BaseHTTPRequestHandler):
    db_path = str(Path(__file__).with_name("alliance_users.db"))
    static_dir = Path(__file__).with_name("static")

    def _send_bytes(self, status_code: int, body: bytes, content_type: str) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status_code, body, "application/json; charset=utf-8")

    def _send_file(self, file_path: Path) -> None:
        if not file_path.exists() or not file_path.is_file():
            self._send_json(404, {"code": 1, "msg": "not found"})
            return

        content_type, _ = mimetypes.guess_type(str(file_path))
        if not content_type:
            content_type = "application/octet-stream"

        body = file_path.read_bytes()
        self._send_bytes(200, body, f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)

    def _normalized_path(self) -> str:
        path = urlparse(self.path).path
        if path != "/" and path.endswith("/"):
            path = path[:-1]
        return path

    def _path_parts(self) -> list[str]:
        path = self._normalized_path()
        return [part for part in path.split("/") if part]

    def _query_param(self, name: str) -> str | None:
        query = parse_qs(urlparse(self.path).query)
        values = query.get(name)
        if not values:
            return None

        value = values[-1]
        return value if value != "" else None

    def _read_json_body(self) -> dict[str, Any]:
        raw_len = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_len)
        except ValueError as e:
            raise ValueError("invalid Content-Length") from e

        if length <= 0:
            return {}

        raw = self.rfile.read(length)
        if not raw:
            return {}

        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError("invalid JSON body") from e

        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")

        return payload

    def _serve_static_path(self, path: str) -> bool:
        if not path.startswith("/static/"):
            return False

        relative = unquote(path[len("/static/") :])
        if not relative:
            self._send_json(404, {"code": 1, "msg": "not found"})
            return True

        base = self.static_dir.resolve()
        requested = (base / relative).resolve()

        if base not in requested.parents and requested != base:
            self._send_json(403, {"code": 1, "msg": "forbidden"})
            return True

        self._send_file(requested)
        return True

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        path = self._normalized_path()
        parts = self._path_parts()

        if path == "/":
            self._send_file(self.static_dir / "index.html")
            return

        if self._serve_static_path(path):
            return

        if path == "/health":
            self._send_json(200, {"code": 0, "msg": "ok"})
            return

        if path == "/alliances":
            alliances = list_alliances(self.db_path)
            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "count": len(alliances),
                    "data": alliances,
                },
            )
            return

        if path == "/users":
            try:
                alliance_id = normalize_optional_alliance_id(self._query_param("alliance_id"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            users = list_users(self.db_path, alliance_id=alliance_id)
            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "count": len(users),
                    "data": users,
                },
            )
            return

        if path == "/events":
            try:
                alliance_id = normalize_optional_alliance_id(self._query_param("alliance_id"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            events = list_events(self.db_path, alliance_id=alliance_id)
            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "count": len(events),
                    "data": events,
                },
            )
            return

        if path == "/gift-codes":
            codes = list_gift_codes(self.db_path)
            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "count": len(codes),
                    "data": codes,
                },
            )
            return

        if len(parts) == 3 and parts[0] == "events" and parts[2] == "board":
            try:
                event_id = normalize_event_id(parts[1])
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            board = get_event_board(self.db_path, event_id)
            if not board:
                self._send_json(404, {"code": 1, "msg": "event not found"})
                return

            self._send_json(200, {"code": 0, "msg": "success", "data": board})
            return

        self._send_json(404, {"code": 1, "msg": "not found"})

    def do_POST(self) -> None:
        path = self._normalized_path()
        parts = self._path_parts()

        try:
            body = self._read_json_body()
        except ValueError as e:
            self._send_json(400, {"code": 1, "msg": str(e)})
            return

        if path == "/users":
            try:
                fid = normalize_fid(body.get("fid"))
                alliance_id = normalize_optional_alliance_id(body.get("alliance_id"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            result = fetch_and_save_user(self.db_path, fid, alliance_id=alliance_id)
            status_code = 200 if result.get("status") != "error" else 400
            payload = {
                "code": 0 if status_code == 200 else 1,
                "msg": "success" if status_code == 200 else "failed",
                "data": result,
            }
            self._send_json(status_code, payload)
            return

        if path == "/alliances":
            try:
                name = normalize_alliance_name(body.get("name"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                result = create_alliance(self.db_path, name)
            except RuntimeError as e:
                self._send_json(500, {"code": 1, "msg": str(e)})
                return

            self._send_json(200, {"code": 0, "msg": "success", "data": result})
            return

        if len(parts) == 3 and parts[0] == "users" and parts[2] == "rank":
            try:
                fid = normalize_fid(parts[1])
                rank = normalize_alliance_rank(body.get("rank"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                updated_user = update_user_rank(self.db_path, fid, rank)
            except LookupError as e:
                self._send_json(404, {"code": 1, "msg": str(e)})
                return

            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {
                        "fid": fid,
                        "rank": rank,
                        "user": updated_user,
                    },
                },
            )
            return

        if len(parts) == 3 and parts[0] == "users" and parts[2] == "alliance":
            try:
                fid = normalize_fid(parts[1])
                alliance_id = normalize_alliance_id(body.get("alliance_id"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                updated_user = update_user_alliance(self.db_path, fid, alliance_id)
            except LookupError as e:
                self._send_json(404, {"code": 1, "msg": str(e)})
                return

            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {
                        "fid": fid,
                        "alliance_id": alliance_id,
                        "user": updated_user,
                    },
                },
            )
            return

        if path == "/users/refresh":
            try:
                raw_fids = body.get("fids", None)
                fids = normalize_fids(raw_fids) if raw_fids is not None else None
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            data = refresh_users_from_api(self.db_path, fids)
            self._send_json(200, {"code": 0, "msg": "success", "data": data})
            return

        if path == "/users/bulk":
            try:
                fids = normalize_fids(body.get("fids"))
                alliance_id = normalize_optional_alliance_id(body.get("alliance_id"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            results: list[dict[str, Any]] = []
            for idx, fid in enumerate(fids):
                results.append(fetch_and_save_user(self.db_path, fid, alliance_id=alliance_id))
                if idx < len(fids) - 1:
                    # External API applies rate limits; short spacing helps avoid 429 bursts.
                    time.sleep(BULK_USER_REQUEST_DELAY_SECONDS)

            added = sum(1 for item in results if item.get("status") == "added")
            updated = sum(1 for item in results if item.get("status") == "updated")
            failed = sum(1 for item in results if item.get("status") == "error")
            failed_fids = [item.get("fid") for item in results if item.get("status") == "error"]

            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {
                        "total": len(fids),
                        "added": added,
                        "updated": updated,
                        "failed": failed,
                        "failed_fids": failed_fids,
                        "results": results,
                    },
                },
            )
            return

        if path == "/users/delete-bulk":
            try:
                fids = normalize_fids(body.get("fids"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            deleted = delete_users(self.db_path, fids)
            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {
                        "requested": len(fids),
                        "deleted_count": len(deleted),
                        "deleted_fids": deleted,
                    },
                },
            )
            return

        if path == "/events":
            try:
                name = normalize_event_name(body.get("name"))
                alliance_id = normalize_alliance_id(body.get("alliance_id"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                event = create_event(self.db_path, name, alliance_id)
            except LookupError as e:
                self._send_json(404, {"code": 1, "msg": str(e)})
                return
            self._send_json(200, {"code": 0, "msg": "success", "data": event})
            return

        if path == "/gift-codes":
            try:
                code = normalize_gift_code(body.get("code"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                result = upsert_gift_code(self.db_path, code)
            except RuntimeError as e:
                self._send_json(500, {"code": 1, "msg": str(e)})
                return

            self._send_json(200, {"code": 0, "msg": "success", "data": result})
            return

        if path in {"/gift-codes/redeem", "/gift-codes/use"}:
            try:
                fid = normalize_fid(body.get("fid"))
                raw_code = body.get("cdk") if "cdk" in body else body.get("code")
                cdk = normalize_gift_code(raw_code)
                captcha_code = normalize_captcha_code(body.get("captcha_code"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            result = redeem_gift_code(fid, cdk, captcha_code)
            status_code = 200 if result.get("status") == "success" else 400
            self._send_json(
                status_code,
                {
                    "code": 0 if status_code == 200 else 1,
                    "msg": "success" if status_code == 200 else "failed",
                    "data": result,
                },
            )
            return

        if len(parts) == 3 and parts[0] == "events" and parts[2] == "assign":
            try:
                event_id = normalize_event_id(parts[1])
                fid = normalize_fid(body.get("fid"))
                legion = normalize_legion(body.get("legion"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                result = assign_user_to_event_legion(self.db_path, event_id, fid, legion)
            except LookupError as e:
                self._send_json(404, {"code": 1, "msg": str(e)})
                return
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            self._send_json(200, {"code": 0, "msg": "success", "data": result})
            return

        if len(parts) == 3 and parts[0] == "events" and parts[2] == "assign-bulk":
            try:
                event_id = normalize_event_id(parts[1])
                fids = normalize_fids(body.get("fids"))
                legion = normalize_legion(body.get("legion"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            results: list[dict[str, Any]] = []
            failed = 0

            for fid in fids:
                try:
                    results.append(assign_user_to_event_legion(self.db_path, event_id, fid, legion))
                except (LookupError, ValueError) as e:
                    failed += 1
                    results.append({"fid": fid, "status": "error", "message": str(e)})

            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {
                        "event_id": event_id,
                        "legion": legion,
                        "total": len(fids),
                        "failed": failed,
                        "results": results,
                    },
                },
            )
            return

        if len(parts) == 3 and parts[0] == "events" and parts[2] == "clear-legion":
            try:
                event_id = normalize_event_id(parts[1])
                legion = normalize_legion(body.get("legion"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                deleted_count = clear_legion(self.db_path, event_id, legion)
            except LookupError as e:
                self._send_json(404, {"code": 1, "msg": str(e)})
                return

            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {
                        "event_id": event_id,
                        "legion": legion,
                        "removed": deleted_count,
                    },
                },
            )
            return

        self._send_json(404, {"code": 1, "msg": "not found"})

    def do_DELETE(self) -> None:
        path = self._normalized_path()
        parts = self._path_parts()

        if len(parts) == 2 and parts[0] == "users":
            try:
                fid = normalize_fid(parts[1])
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            removed = delete_user(self.db_path, fid)
            if not removed:
                self._send_json(404, {"code": 1, "msg": "user not found"})
                return

            self._send_json(200, {"code": 0, "msg": "success", "data": {"deleted_fid": fid}})
            return

        if len(parts) == 2 and parts[0] == "events":
            try:
                event_id = normalize_event_id(parts[1])
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            removed = delete_event(self.db_path, event_id)
            if not removed:
                self._send_json(404, {"code": 1, "msg": "event not found"})
                return

            self._send_json(200, {"code": 0, "msg": "success", "data": {"deleted_event_id": event_id}})
            return

        if len(parts) == 2 and parts[0] == "gift-codes":
            try:
                gift_code_id = normalize_gift_code_id(parts[1])
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            removed = delete_gift_code(self.db_path, gift_code_id)
            if not removed:
                self._send_json(404, {"code": 1, "msg": "gift code not found"})
                return

            self._send_json(
                200,
                {"code": 0, "msg": "success", "data": {"deleted_gift_code_id": gift_code_id}},
            )
            return

        if len(parts) == 4 and parts[0] == "events" and parts[2] == "members":
            try:
                event_id = normalize_event_id(parts[1])
                fid = normalize_fid(parts[3])
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            try:
                removed = remove_event_member(self.db_path, event_id, fid)
            except LookupError as e:
                self._send_json(404, {"code": 1, "msg": str(e)})
                return

            if not removed:
                self._send_json(404, {"code": 1, "msg": "member not found in event"})
                return

            self._send_json(
                200,
                {
                    "code": 0,
                    "msg": "success",
                    "data": {"event_id": event_id, "removed_fid": fid},
                },
            )
            return

        self._send_json(404, {"code": 1, "msg": "not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def run_server(host: str, port: int, db_path: str) -> None:
    init_db(db_path)

    handler_class = type(
        "ConfiguredAllianceHandler",
        (AllianceHandler,),
        {
            "db_path": db_path,
            "static_dir": Path(__file__).with_name("static"),
        },
    )

    server = ThreadingHTTPServer((host, port), handler_class)
    print(f"Server running on http://{host}:{port}")
    print(f"DB path: {db_path}")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Alliance user API server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=8000, help="Bind port")
    default_db = str(Path(__file__).with_name("alliance_users.db"))
    parser.add_argument("--db", default=default_db, help="SQLite DB path")
    args = parser.parse_args()

    run_server(args.host, args.port, args.db)


if __name__ == "__main__":
    main()
