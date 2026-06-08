#!/usr/bin/env python3
import argparse
import cgi
import json
import mimetypes
import os
import re
import secrets
import shutil
import time
import math
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse
from urllib.request import Request, urlopen


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_PHOTOS = 30
MAX_ESTIMATED_ORDER_VALUE = 80
LOYALTY_TARGET_ORDERS = 8
ADMIN_SESSION_SECONDS = 12 * 60 * 60
ORDER_CANCEL_WINDOW_SECONDS = 5 * 60
ADMIN_STATUSES = {"new", "deposit_pending", "accepted", "shopping", "delivered", "rejected", "cancelled"}
CUSTOMER_CANCELLABLE_STATUSES = {"new", "deposit_pending", "accepted"}
LOYALTY_INACTIVE_STATUSES = {"rejected", "cancelled"}
SERVICE_ORIGIN_ADDRESS = "Karlstraße 15, 41199 Mönchengladbach"
SERVICE_ORIGIN_LAT = 51.1357675
SERVICE_ORIGIN_LON = 6.4466562
MAX_SERVICE_DISTANCE_KM = 2.0
GEOCODER_URL = "https://photon.komoot.io/api/"
ROUTER_URL = "https://router.project-osrm.org/route/v1/driving/"


def safe_filename(filename):
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", filename or "einkaufszettel.jpg").strip("._")
    return cleaned or "einkaufszettel.jpg"


def safe_order_id(order_id):
    return re.fullmatch(r"[A-Za-z0-9_.-]+", order_id or "") is not None


def json_response(handler, status, payload, headers=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    if headers:
        for key, value in headers.items():
            handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


def parse_estimated_value(value):
    if value is None:
        return None

    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def haversine_km(lat1, lon1, lat2, lon2):
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def format_geocoded_address(properties, fallback):
    street_line = " ".join(str(value) for value in [
        properties.get("street"),
        properties.get("housenumber"),
    ] if value).strip()
    city_line = " ".join(str(value) for value in [
        properties.get("postcode"),
        properties.get("city"),
    ] if value).strip()

    if street_line and city_line:
        return f"{street_line}, {city_line}"
    if street_line:
        return street_line

    return fallback


def route_distance_km(lat, lon):
    coordinates = f"{SERVICE_ORIGIN_LON},{SERVICE_ORIGIN_LAT};{lon},{lat}"
    url = ROUTER_URL + coordinates + "?" + urlencode({"overview": "false"})
    request = Request(url, headers={"User-Agent": "Besorgly/1.0"})

    try:
        with urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None

    routes = data.get("routes") or []
    if data.get("code") != "Ok" or not routes:
        return None

    return routes[0].get("distance", 0) / 1000.0


def geocode_address(address):
    query = (address or "").strip()
    if not query:
        return None

    if "mönchengladbach" not in query.lower() and "moenchengladbach" not in query.lower():
        query = f"{query}, Mönchengladbach, Deutschland"

    url = GEOCODER_URL + "?" + urlencode({"q": query, "limit": 1})
    request = Request(url, headers={"User-Agent": "Besorgly/1.0"})

    try:
        with urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None

    features = data.get("features") or []
    if not features:
        return None

    feature = features[0]
    coordinates = feature.get("geometry", {}).get("coordinates") or []
    if len(coordinates) < 2:
        return None

    lon, lat = coordinates[:2]
    properties = feature.get("properties", {})
    suggested_address = format_geocoded_address(properties, query)
    return {
        "lat": lat,
        "lon": lon,
        "label": suggested_address,
        "suggestedAddress": suggested_address,
    }


def service_area_check(address):
    result = geocode_address(address)
    if result is None:
        return {
            "ok": False,
            "error": "address_not_found",
            "originAddress": SERVICE_ORIGIN_ADDRESS,
            "maxDistanceKm": MAX_SERVICE_DISTANCE_KM,
        }

    straight_distance_km = haversine_km(SERVICE_ORIGIN_LAT, SERVICE_ORIGIN_LON, result["lat"], result["lon"])
    driving_distance_km = route_distance_km(result["lat"], result["lon"])
    distance_km = driving_distance_km if driving_distance_km is not None else straight_distance_km
    return {
        "ok": True,
        "originAddress": SERVICE_ORIGIN_ADDRESS,
        "maxDistanceKm": MAX_SERVICE_DISTANCE_KM,
        "distanceKm": round(distance_km, 3),
        "distanceMeters": round(distance_km * 1000),
        "distanceMode": "driving" if driving_distance_km is not None else "straight_line",
        "withinServiceArea": distance_km <= MAX_SERVICE_DISTANCE_KM,
        "resolvedAddress": result["label"],
        "suggestedAddress": result["suggestedAddress"],
        "lat": result["lat"],
        "lon": result["lon"],
    }


def public_coverage_response(coverage):
    return {
        "ok": coverage.get("ok", False),
        "error": coverage.get("error"),
        "withinServiceArea": coverage.get("withinServiceArea", False),
        "resolvedAddress": coverage.get("resolvedAddress"),
        "suggestedAddress": coverage.get("suggestedAddress"),
    }


def normalize_phone(value):
    digits = re.sub(r"\D+", "", value or "")
    if digits.startswith("0049"):
        return "0" + digits[4:]
    if digits.startswith("49") and len(digits) > 10:
        return "0" + digits[2:]
    return digits


def normalize_name(value):
    normalized = (value or "").strip().lower()
    normalized = normalized.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def normalize_address(value):
    normalized = (value or "").strip().lower()
    normalized = normalized.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def customer_key(customer):
    phone = normalize_phone(customer.get("phone"))
    address = normalize_address(customer.get("address"))
    if not phone or not address:
        return None
    return f"{phone}|{address}"


def customer_identity_key(customer):
    name = normalize_name(customer.get("name"))
    phone = normalize_phone(customer.get("phone"))
    if not name or not phone:
        return None
    return f"{name}|{phone}"


def order_json_paths(storage_dir):
    if not storage_dir.exists():
        return []
    return sorted(storage_dir.glob("*/order.json"))


def read_order_record(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_order_record(storage_dir, record):
    order_id = record.get("orderId", "")
    if not safe_order_id(order_id):
        raise ValueError("invalid_order_id")

    order_dir = storage_dir / order_id
    order_dir.mkdir(parents=True, exist_ok=True)
    (order_dir / "order.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")


def order_path(storage_dir, order_id):
    if not safe_order_id(order_id):
        return None
    return storage_dir / order_id / "order.json"


def get_admin_status(record):
    return record.get("admin", {}).get("status") or "new"


def parse_iso_datetime(value):
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def public_order_status(record):
    created_at = parse_iso_datetime(record.get("createdAt")) or datetime.now(timezone.utc)
    updated_at = parse_iso_datetime(record.get("admin", {}).get("updatedAt")) or created_at
    cancel_until = created_at.timestamp() + ORDER_CANCEL_WINDOW_SECONDS
    remaining_seconds = max(0, int(cancel_until - time.time()))
    status = get_admin_status(record)

    return {
        "orderId": record.get("orderId"),
        "status": status,
        "createdAt": record.get("createdAt"),
        "updatedAt": updated_at.isoformat(),
        "cancelWindowSeconds": ORDER_CANCEL_WINDOW_SECONDS,
        "cancelRemainingSeconds": remaining_seconds,
        "canCancel": remaining_seconds > 0 and status in CUSTOMER_CANCELLABLE_STATUSES,
        "cancelledByCustomer": record.get("admin", {}).get("cancelledBy") == "customer",
        "cancelReason": record.get("admin", {}).get("cancelReason", ""),
    }


def loyalty_stats_for_customer(storage_dir, customer):
    lookup_key = customer_key(customer)
    if lookup_key is None:
        return {
            "successfulOrderCount": 0,
            "paidOrderCount": 0,
            "freeShippingUsedCount": 0,
            "availableFreeShipCount": 0,
            "stampCount": 0,
            "targetOrders": LOYALTY_TARGET_ORDERS,
            "ordersUntilReward": LOYALTY_TARGET_ORDERS,
            "freeShipAvailable": False,
        }

    successful_order_count = 0
    paid_order_count = 0
    free_shipping_used_count = 0

    for path in order_json_paths(storage_dir):
        record = read_order_record(path)
        if not record:
            continue

        payload = record.get("payload", {})
        if customer_key(payload.get("customer", {})) != lookup_key:
            continue

        status = get_admin_status(record)
        free_shipping_used = payload.get("loyalty", {}).get("freeShippingUsed")

        if status in LOYALTY_INACTIVE_STATUSES:
            continue

        if free_shipping_used:
            free_shipping_used_count += 1

        successful_order_count += 1
        if not free_shipping_used:
            paid_order_count += 1

    earned_free_ship_count = paid_order_count // LOYALTY_TARGET_ORDERS
    available_free_ship_count = max(0, earned_free_ship_count - free_shipping_used_count)
    stamp_count = LOYALTY_TARGET_ORDERS if available_free_ship_count else paid_order_count % LOYALTY_TARGET_ORDERS
    orders_until_reward = 0 if available_free_ship_count else LOYALTY_TARGET_ORDERS - stamp_count

    return {
        "successfulOrderCount": successful_order_count,
        "paidOrderCount": paid_order_count,
        "freeShippingUsedCount": free_shipping_used_count,
        "availableFreeShipCount": available_free_ship_count,
        "stampCount": stamp_count,
        "targetOrders": LOYALTY_TARGET_ORDERS,
        "ordersUntilReward": orders_until_reward,
        "freeShipAvailable": available_free_ship_count > 0,
    }


def customer_history_for_identity(storage_dir, customer):
    lookup_key = customer_identity_key(customer)
    if lookup_key is None:
        return {
            "matchedOrderCount": 0,
            "isReturningCustomer": False,
            "depositRequired": False,
        }

    matched_order_count = 0
    last_order_at = None

    for path in order_json_paths(storage_dir):
        record = read_order_record(path)
        if not record:
            continue

        if get_admin_status(record) in LOYALTY_INACTIVE_STATUSES:
            continue

        payload = record.get("payload", {})
        if customer_identity_key(payload.get("customer", {})) != lookup_key:
            continue

        matched_order_count += 1
        created_at = record.get("createdAt")
        if created_at and (last_order_at is None or created_at > last_order_at):
            last_order_at = created_at

    return {
        "matchedOrderCount": matched_order_count,
        "lastOrderAt": last_order_at,
        "isReturningCustomer": matched_order_count > 0,
        "depositRequired": False,
    }


def load_admin_password(password_file):
    password = os.environ.get("EINKAUFSSERVICE_ADMIN_PASSWORD", "").strip()
    if password:
        return password

    try:
        return password_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def read_json_body(handler):
    content_length = int(handler.headers.get("Content-Length", "0") or "0")
    if content_length <= 0:
        return {}
    body = handler.rfile.read(content_length)
    if not body:
        return {}
    return json.loads(body.decode("utf-8"))


def admin_cookie_header(token, max_age=ADMIN_SESSION_SECONDS):
    return f"admin_session={token}; HttpOnly; SameSite=Lax; Path=/api/admin; Max-Age={max_age}"


def expired_admin_cookie_header():
    return "admin_session=; HttpOnly; SameSite=Lax; Path=/api/admin; Max-Age=0"


def order_summary(record):
    payload = record.get("payload", {})
    customer = payload.get("customer", {})
    admin = record.get("admin", {})
    fees = payload.get("fees", {})
    photos = record.get("photos", [])
    items = payload.get("items", [])
    shopping_list_text = str(payload.get("shoppingListText", "") or "").strip()
    shopping_list_preview = re.sub(r"\s+", " ", shopping_list_text)[:140]
    supermarkets = []
    for item in items:
        supermarket = str(item.get("supermarket", "") or "").strip() or "Egal"
        if supermarket not in supermarkets:
            supermarkets.append(supermarket)

    if not supermarkets:
        supermarkets = ["Per Foto / noch klären"]

    return {
        "orderId": record.get("orderId"),
        "createdAt": record.get("createdAt"),
        "status": admin.get("status", "new"),
        "adminNote": admin.get("note", ""),
        "customerName": customer.get("name", ""),
        "phone": customer.get("phone", ""),
        "address": customer.get("address", ""),
        "deliveryTime": customer.get("deliveryTime", ""),
        "entryMode": payload.get("entryMode", "photo"),
        "supermarkets": supermarkets,
        "estimatedOrderValue": customer.get("estimatedOrderValue", ""),
        "itemCount": len(items),
        "photoCount": len(photos),
        "hasShoppingListText": bool(shopping_list_text),
        "shoppingListPreview": shopping_list_preview,
        "cheapestPreference": bool(payload.get("cheapestPreference")),
        "serviceFee": fees.get("totalServiceFee"),
        "freeShippingUsed": payload.get("loyalty", {}).get("freeShippingUsed", False),
    }


def order_detail(storage_dir, record):
    order_id = record.get("orderId", "")
    order_dir = storage_dir / order_id
    try:
        order_text = (order_dir / "order.txt").read_text(encoding="utf-8")
    except OSError:
        order_text = ""

    detail = dict(record)
    detail.setdefault("admin", {"status": "new", "note": ""})
    detail["orderText"] = order_text
    detail["photos"] = [
        {
            **photo,
            "url": f"/api/admin/orders/{quote(order_id)}/photos/{quote(photo.get('filename', ''))}",
        }
        for photo in record.get("photos", [])
    ]
    detail["loyaltyStats"] = loyalty_stats_for_customer(storage_dir, record.get("payload", {}).get("customer", {}))
    return detail


class UploadHandler(BaseHTTPRequestHandler):
    storage_dir = Path("/var/lib/besorgly/orders")
    admin_password_file = Path("/var/lib/besorgly/admin-password.txt")
    admin_sessions = {}

    def log_message(self, fmt, *args):
        print(f"{datetime.now(timezone.utc).isoformat()} {self.client_address[0]} {fmt % args}", flush=True)

    def get_cookie_value(self, name):
        cookie_header = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except Exception:
            return ""
        morsel = cookie.get(name)
        return morsel.value if morsel else ""

    def authenticated_admin(self):
        token = self.get_cookie_value("admin_session")
        if not token:
            return False

        now = time.time()
        expired_tokens = [
            session_token
            for session_token, session in self.admin_sessions.items()
            if session.get("expiresAt", 0) <= now
        ]
        for session_token in expired_tokens:
            self.admin_sessions.pop(session_token, None)

        session = self.admin_sessions.get(token)
        if not session:
            return False

        session["expiresAt"] = now + ADMIN_SESSION_SECONDS
        return True

    def require_admin(self):
        if self.authenticated_admin():
            return True
        json_response(self, 401, {"ok": False, "error": "admin_login_required"})
        return False

    def do_GET(self):
        parsed_url = urlparse(self.path)

        if parsed_url.path.startswith("/admin/"):
            self.handle_admin_get(parsed_url)
            return

        if parsed_url.path == "/health":
            json_response(self, 200, {"ok": True})
            return

        if parsed_url.path == "/loyalty":
            query = parse_qs(parsed_url.query)
            customer = {
                "phone": query.get("phone", [""])[0],
                "address": query.get("address", [""])[0],
            }

            if not customer["phone"] or not customer["address"]:
                json_response(self, 400, {"error": "phone_and_address_required"})
                return

            json_response(self, 200, {
                "ok": True,
                "loyalty": loyalty_stats_for_customer(self.storage_dir, customer),
            })
            return

        if parsed_url.path == "/coverage":
            query = parse_qs(parsed_url.query)
            address = query.get("address", [""])[0]
            if not address:
                json_response(self, 400, {"ok": False, "error": "address_required"})
                return

            coverage = service_area_check(address)
            json_response(
                self,
                200 if coverage.get("ok") else 404,
                {"ok": coverage.get("ok", False), "coverage": public_coverage_response(coverage)},
            )
            return

        if parsed_url.path == "/customer-history":
            query = parse_qs(parsed_url.query)
            customer = {
                "name": query.get("name", [""])[0],
                "phone": query.get("phone", [""])[0],
            }
            if not customer["name"] or not customer["phone"]:
                json_response(self, 400, {"ok": False, "error": "name_and_phone_required"})
                return

            json_response(self, 200, {
                "ok": True,
                "customerHistory": customer_history_for_identity(self.storage_dir, customer),
            })
            return

        status_match = re.fullmatch(r"/orders/([^/]+)/status", parsed_url.path)
        if status_match:
            self.handle_public_order_status(unquote(status_match.group(1)))
            return

        json_response(self, 404, {"error": "not_found"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        parsed_url = urlparse(self.path)

        if parsed_url.path.startswith("/admin/"):
            self.handle_admin_post(parsed_url)
            return

        cancel_match = re.fullmatch(r"/orders/([^/]+)/cancel", parsed_url.path)
        if cancel_match:
            self.handle_public_order_cancel(unquote(cancel_match.group(1)))
            return

        if parsed_url.path != "/orders":
            json_response(self, 404, {"error": "not_found"})
            return

        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0:
            json_response(self, 400, {"error": "empty_request"})
            return
        if content_length > MAX_UPLOAD_BYTES:
            json_response(self, 413, {"error": "too_large", "maxBytes": MAX_UPLOAD_BYTES})
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            json_response(self, 400, {"error": "multipart_required"})
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(content_length),
            },
        )

        order_text = form.getfirst("orderText", "").strip()
        payload_raw = form.getfirst("payload", "{}").strip() or "{}"

        try:
            payload = json.loads(payload_raw)
        except json.JSONDecodeError:
            json_response(self, 400, {"error": "invalid_payload"})
            return

        estimated_value = parse_estimated_value(payload.get("customer", {}).get("estimatedOrderValue"))
        if estimated_value is not None and estimated_value > MAX_ESTIMATED_ORDER_VALUE:
            json_response(self, 400, {
                "error": "estimated_order_value_too_high",
                "maxEstimatedOrderValue": MAX_ESTIMATED_ORDER_VALUE,
            })
            return

        customer = payload.get("customer", {})
        coverage = service_area_check(customer.get("address", ""))
        if not coverage.get("ok"):
            json_response(self, 400, {"error": "address_not_found", "coverage": public_coverage_response(coverage)})
            return
        if not coverage.get("withinServiceArea"):
            json_response(self, 400, {"error": "outside_service_area", "coverage": public_coverage_response(coverage)})
            return
        payload["coverage"] = coverage

        if not order_text:
            json_response(self, 400, {"error": "order_text_required"})
            return

        customer_history = customer_history_for_identity(self.storage_dir, customer)
        payload["customerHistory"] = customer_history
        payload["deposit"] = {
            "required": False,
            "reason": "deposit_not_required",
        }

        loyalty_before = loyalty_stats_for_customer(self.storage_dir, customer)
        free_shipping_used = loyalty_before["availableFreeShipCount"] > 0
        payload["loyalty"] = {
            "targetOrders": LOYALTY_TARGET_ORDERS,
            "freeShippingUsed": free_shipping_used,
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "statsBeforeOrder": loyalty_before,
        }

        order_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}"
        order_dir = self.storage_dir / order_id
        photo_dir = order_dir / "photos"
        photo_dir.mkdir(parents=True, exist_ok=False)

        saved_photos = []
        photo_fields = form["photos"] if "photos" in form else []
        if not isinstance(photo_fields, list):
            photo_fields = [photo_fields]

        for index, photo in enumerate(photo_fields[:MAX_PHOTOS], start=1):
            if not getattr(photo, "filename", None):
                continue

            content_type = getattr(photo, "type", "") or "application/octet-stream"
            if not content_type.startswith("image/"):
                continue

            filename = f"{index:02d}-{safe_filename(photo.filename)}"
            destination = photo_dir / filename
            with destination.open("wb") as output:
                shutil.copyfileobj(photo.file, output)

            saved_photos.append({
                "filename": filename,
                "contentType": content_type,
                "size": destination.stat().st_size,
            })

        now = datetime.now(timezone.utc).isoformat()
        initial_status = "new"
        order_record = {
            "orderId": order_id,
            "createdAt": now,
            "payload": payload,
            "photos": saved_photos,
            "admin": {
                "status": initial_status,
                "note": "",
                "updatedAt": now,
            },
        }

        (order_dir / "order.txt").write_text(order_text + "\n", encoding="utf-8")
        (order_dir / "order.json").write_text(json.dumps(order_record, ensure_ascii=False, indent=2), encoding="utf-8")

        loyalty_after = loyalty_stats_for_customer(self.storage_dir, customer)

        json_response(self, 201, {
            "ok": True,
            "orderId": order_id,
            "photoCount": len(saved_photos),
            "orderStatus": public_order_status(order_record),
            "loyalty": loyalty_after,
            "customerHistory": customer_history,
            "depositRequired": customer_history["depositRequired"],
            "freeShippingUsedOnThisOrder": free_shipping_used,
        })

    def handle_public_order_status(self, order_id):
        path = order_path(self.storage_dir, order_id)
        if not path or not path.exists():
            json_response(self, 404, {"ok": False, "error": "order_not_found"})
            return

        record = read_order_record(path)
        if not record:
            json_response(self, 500, {"ok": False, "error": "order_cannot_be_read"})
            return

        json_response(self, 200, {"ok": True, "order": public_order_status(record)})

    def handle_public_order_cancel(self, order_id):
        path = order_path(self.storage_dir, order_id)
        if not path or not path.exists():
            json_response(self, 404, {"ok": False, "error": "order_not_found"})
            return

        record = read_order_record(path)
        if not record:
            json_response(self, 500, {"ok": False, "error": "order_cannot_be_read"})
            return

        current_status = public_order_status(record)
        if not current_status["canCancel"]:
            json_response(self, 409, {"ok": False, "error": "cancel_not_allowed", "order": current_status})
            return

        now = datetime.now(timezone.utc).isoformat()
        record["admin"] = {
            **record.get("admin", {}),
            "status": "cancelled",
            "note": record.get("admin", {}).get("note", ""),
            "cancelledBy": "customer",
            "cancelReason": "Vom Kunden innerhalb von 5 Minuten storniert.",
            "updatedAt": now,
        }
        write_order_record(self.storage_dir, record)
        json_response(self, 200, {"ok": True, "order": public_order_status(record)})

    def handle_admin_get(self, parsed_url):
        if parsed_url.path == "/admin/session":
            json_response(self, 200, {"ok": True, "authenticated": self.authenticated_admin()})
            return

        if not self.require_admin():
            return

        if parsed_url.path == "/admin/orders":
            self.handle_admin_orders_list(parsed_url)
            return

        photo_match = re.fullmatch(r"/admin/orders/([^/]+)/photos/(.+)", parsed_url.path)
        if photo_match:
            self.handle_admin_photo(unquote(photo_match.group(1)), unquote(photo_match.group(2)))
            return

        detail_match = re.fullmatch(r"/admin/orders/([^/]+)", parsed_url.path)
        if detail_match:
            self.handle_admin_order_detail(unquote(detail_match.group(1)))
            return

        json_response(self, 404, {"ok": False, "error": "not_found"})

    def handle_admin_post(self, parsed_url):
        if parsed_url.path == "/admin/login":
            self.handle_admin_login()
            return

        if parsed_url.path == "/admin/logout":
            token = self.get_cookie_value("admin_session")
            if token:
                self.admin_sessions.pop(token, None)
            json_response(self, 200, {"ok": True}, {"Set-Cookie": expired_admin_cookie_header()})
            return

        if not self.require_admin():
            return

        status_match = re.fullmatch(r"/admin/orders/([^/]+)/status", parsed_url.path)
        if status_match:
            self.handle_admin_status_update(unquote(status_match.group(1)))
            return

        json_response(self, 404, {"ok": False, "error": "not_found"})

    def handle_admin_login(self):
        try:
            data = read_json_body(self)
        except json.JSONDecodeError:
            json_response(self, 400, {"ok": False, "error": "invalid_json"})
            return

        configured_password = load_admin_password(self.admin_password_file)
        if not configured_password:
            json_response(self, 503, {"ok": False, "error": "admin_password_not_configured"})
            return

        password = str(data.get("password", ""))
        if not secrets.compare_digest(password, configured_password):
            json_response(self, 401, {"ok": False, "error": "invalid_password"})
            return

        token = secrets.token_urlsafe(32)
        self.admin_sessions[token] = {"createdAt": time.time(), "expiresAt": time.time() + ADMIN_SESSION_SECONDS}
        json_response(self, 200, {"ok": True}, {"Set-Cookie": admin_cookie_header(token)})

    def handle_admin_orders_list(self, parsed_url):
        query = parse_qs(parsed_url.query)
        search = query.get("search", [""])[0].strip().lower()
        status_filter = query.get("status", ["all"])[0]
        orders = []

        for path in order_json_paths(self.storage_dir):
            record = read_order_record(path)
            if not record:
                continue

            summary = order_summary(record)
            if status_filter != "all" and summary.get("status") != status_filter:
                continue

            if search:
                haystack = json.dumps(summary, ensure_ascii=False).lower()
                if search not in haystack:
                    continue

            orders.append(summary)

        orders.sort(key=lambda order: order.get("createdAt") or "", reverse=True)
        json_response(self, 200, {"ok": True, "orders": orders})

    def handle_admin_order_detail(self, order_id):
        path = order_path(self.storage_dir, order_id)
        if not path or not path.exists():
            json_response(self, 404, {"ok": False, "error": "order_not_found"})
            return

        record = read_order_record(path)
        if not record:
            json_response(self, 500, {"ok": False, "error": "order_cannot_be_read"})
            return

        json_response(self, 200, {"ok": True, "order": order_detail(self.storage_dir, record)})

    def handle_admin_photo(self, order_id, filename):
        path = order_path(self.storage_dir, order_id)
        if not path or not path.exists():
            json_response(self, 404, {"ok": False, "error": "order_not_found"})
            return

        record = read_order_record(path)
        if not record:
            json_response(self, 500, {"ok": False, "error": "order_cannot_be_read"})
            return

        allowed_filenames = {photo.get("filename") for photo in record.get("photos", [])}
        if filename not in allowed_filenames:
            json_response(self, 404, {"ok": False, "error": "photo_not_found"})
            return

        photo_path = self.storage_dir / order_id / "photos" / filename
        if not photo_path.exists():
            json_response(self, 404, {"ok": False, "error": "photo_not_found"})
            return

        content_type = mimetypes.guess_type(photo_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(photo_path.stat().st_size))
        self.end_headers()
        with photo_path.open("rb") as photo_file:
            shutil.copyfileobj(photo_file, self.wfile)

    def handle_admin_status_update(self, order_id):
        path = order_path(self.storage_dir, order_id)
        if not path or not path.exists():
            json_response(self, 404, {"ok": False, "error": "order_not_found"})
            return

        try:
            data = read_json_body(self)
        except json.JSONDecodeError:
            json_response(self, 400, {"ok": False, "error": "invalid_json"})
            return

        status = str(data.get("status", "new"))
        note = str(data.get("note", ""))[:3000]
        if status not in ADMIN_STATUSES:
            json_response(self, 400, {"ok": False, "error": "invalid_status"})
            return

        record = read_order_record(path)
        if not record:
            json_response(self, 500, {"ok": False, "error": "order_cannot_be_read"})
            return

        record["admin"] = {
            "status": status,
            "note": note,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        write_order_record(self.storage_dir, record)
        json_response(self, 200, {"ok": True, "order": order_detail(self.storage_dir, record)})


def main():
    parser = argparse.ArgumentParser(description="Besorgly upload API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18082)
    parser.add_argument("--storage", default="/var/lib/besorgly/orders")
    parser.add_argument("--admin-password-file", default="/var/lib/besorgly/admin-password.txt")
    args = parser.parse_args()

    UploadHandler.storage_dir = Path(args.storage)
    UploadHandler.admin_password_file = Path(args.admin_password_file)
    UploadHandler.storage_dir.mkdir(parents=True, exist_ok=True)
    UploadHandler.admin_password_file.parent.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer((args.host, args.port), UploadHandler)
    print(f"Upload API listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
