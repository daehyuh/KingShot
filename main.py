import argparse
import json

from player_api import extract_player_data, fetch_player


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch player data from Kingshot API")
    parser.add_argument("--fid", type=int, default=254813172, help="Player FID")
    args = parser.parse_args()

    result = fetch_player(args.fid)

    print("Raw response:")
    print(json.dumps(result, ensure_ascii=False, indent=2))

    data = extract_player_data(result)
    code = result.get("code") if isinstance(result, dict) else None
    msg = result.get("msg") if isinstance(result, dict) else None
    err_code = result.get("err_code") if isinstance(result, dict) else None

    print("\nKey values:")
    print(f"code: {code}")
    print(f"msg: {msg}")
    print(f"err_code: {err_code}")
    print(f"fid: {data.get('fid')}")
    print(f"nickname: {data.get('nickname')}")
    print(f"kid: {data.get('kid')}")
    print(f"town_center_lv: {data.get('stove_lv')}")
    print(f"avatar_image: {data.get('avatar_image')}")


if __name__ == "__main__":
    main()
