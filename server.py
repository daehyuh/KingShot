import argparse
import json
import mimetypes
import sqlite3
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from player_api import extract_player_data, fetch_player

LEGION_1 = "legion1"
LEGION_2 = "legion2"
LEGIONS = {LEGION_1, LEGION_2}
BULK_USER_REQUEST_DELAY_SECONDS = 0.35


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


def init_db(db_path: str) -> None:
    with db_connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                fid INTEGER PRIMARY KEY,
                nickname TEXT,
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
        conn.commit()


def get_user(db_path: str, fid: int) -> dict[str, Any] | None:
    with db_connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                fid,
                nickname,
                kid,
                stove_lv,
                stove_lv_content,
                avatar_image,
                total_recharge_amount,
                created_at,
                updated_at
            FROM users
            WHERE fid = ?
            """,
            (fid,),
        ).fetchone()

    return dict(row) if row else None


def list_users(db_path: str) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                fid,
                nickname,
                kid,
                stove_lv,
                stove_lv_content,
                avatar_image,
                total_recharge_amount,
                created_at,
                updated_at
            FROM users
            ORDER BY
                CASE WHEN nickname IS NULL OR nickname = '' THEN 1 ELSE 0 END,
                nickname COLLATE NOCASE,
                fid ASC
            """
        ).fetchall()

    return [dict(row) for row in rows]


def upsert_user(db_path: str, user: dict[str, Any]) -> str:
    fid = normalize_fid(user.get("fid"))
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        existing = conn.execute(
            "SELECT 1 FROM users WHERE fid = ?",
            (fid,),
        ).fetchone()
        status = "updated" if existing else "added"

        conn.execute(
            """
            INSERT INTO users (
                fid,
                nickname,
                kid,
                stove_lv,
                stove_lv_content,
                avatar_image,
                total_recharge_amount,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fid) DO UPDATE SET
                nickname = excluded.nickname,
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


def fetch_and_save_user(db_path: str, fid: int) -> dict[str, Any]:
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
        status = upsert_user(db_path, normalized_user)
    except ValueError as e:
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


def get_event(db_path: str, event_id: int) -> dict[str, Any] | None:
    with db_connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name, created_at FROM events WHERE id = ?",
            (event_id,),
        ).fetchone()

    return dict(row) if row else None


def create_event(db_path: str, name: str) -> dict[str, Any]:
    now = utc_now_iso()

    with db_connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO events (name, created_at) VALUES (?, ?)",
            (name, now),
        )
        event_id = cur.lastrowid
        conn.commit()

    event = get_event(db_path, int(event_id))
    if not event:
        raise RuntimeError("failed to create event")

    return event


def list_events(db_path: str) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                e.id,
                e.name,
                e.created_at,
                SUM(CASE WHEN em.legion = 'legion1' THEN 1 ELSE 0 END) AS legion1_count,
                SUM(CASE WHEN em.legion = 'legion2' THEN 1 ELSE 0 END) AS legion2_count
            FROM events e
            LEFT JOIN event_members em ON em.event_id = e.id
            GROUP BY e.id, e.name, e.created_at
            ORDER BY e.id DESC
            """
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
        event_row = conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event_row:
            raise LookupError("event not found")

        user_row = conn.execute("SELECT 1 FROM users WHERE fid = ?", (fid,)).fetchone()
        if not user_row:
            raise LookupError("user not found")

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
                u.kid,
                u.stove_lv,
                u.stove_lv_content,
                u.avatar_image,
                u.total_recharge_amount,
                em.assigned_at,
                em.legion
            FROM event_members em
            JOIN users u ON u.fid = em.fid
            WHERE em.event_id = ? AND em.legion = ?
            ORDER BY
                CASE WHEN u.nickname IS NULL OR u.nickname = '' THEN 1 ELSE 0 END,
                u.nickname COLLATE NOCASE,
                u.fid ASC
            """,
            (event_id, legion),
        ).fetchall()

    return [dict(row) for row in rows]


def list_event_unassigned_users(db_path: str, event_id: int) -> list[dict[str, Any]]:
    with db_connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                u.fid,
                u.nickname,
                u.kid,
                u.stove_lv,
                u.stove_lv_content,
                u.avatar_image,
                u.total_recharge_amount,
                u.created_at,
                u.updated_at
            FROM users u
            LEFT JOIN event_members em
                ON em.fid = u.fid
                AND em.event_id = ?
            WHERE em.fid IS NULL
            ORDER BY
                CASE WHEN u.nickname IS NULL OR u.nickname = '' THEN 1 ELSE 0 END,
                u.nickname COLLATE NOCASE,
                u.fid ASC
            """,
            (event_id,),
        ).fetchall()

    return [dict(row) for row in rows]


def get_event_board(db_path: str, event_id: int) -> dict[str, Any] | None:
    event = get_event(db_path, event_id)
    if not event:
        return None

    legion1 = list_event_legion_members(db_path, event_id, LEGION_1)
    legion2 = list_event_legion_members(db_path, event_id, LEGION_2)
    unassigned = list_event_unassigned_users(db_path, event_id)

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

        if path == "/users":
            users = list_users(self.db_path)
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
            events = list_events(self.db_path)
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
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            result = fetch_and_save_user(self.db_path, fid)
            status_code = 200 if result.get("status") != "error" else 400
            payload = {
                "code": 0 if status_code == 200 else 1,
                "msg": "success" if status_code == 200 else "failed",
                "data": result,
            }
            self._send_json(status_code, payload)
            return

        if path == "/users/bulk":
            try:
                fids = normalize_fids(body.get("fids"))
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            results: list[dict[str, Any]] = []
            for idx, fid in enumerate(fids):
                results.append(fetch_and_save_user(self.db_path, fid))
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
            except ValueError as e:
                self._send_json(400, {"code": 1, "msg": str(e)})
                return

            event = create_event(self.db_path, name)
            self._send_json(200, {"code": 0, "msg": "success", "data": event})
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
                except LookupError as e:
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
