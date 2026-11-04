#!/usr/bin/env python3
"""Gera os arquivos de dados do dashboard Meu Time.

Uso:
    python3 tools/build_data.py --xlsx "/caminho/arquivo.xlsx"
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ASSETS_DIR = ROOT / "assets"
DEFAULT_XLSX = (
    "/Users/adrianomartins/Downloads/"
    "report_Dados_Cadastrais_dos_Colaboradores--epiusebras--153071018_99--"
    "_e70d9098-f3b5-4304-97fb-a4c1d8f1e4d0 (1).xlsx"
)
REFERENCE_DATE = date(2026, 8, 3)
SNAPSHOT_LABEL = "03/08/2026"

REGIONS = [
    {"key": "Sudeste", "label": "Sudeste", "color": "#0F9B8E"},
    {"key": "Sul", "label": "Sul", "color": "#2E7DD1"},
    {"key": "Nordeste", "label": "Nordeste", "color": "#D69A2D"},
    {"key": "Centro-Oeste", "label": "Centro-Oeste", "color": "#7C6BC4"},
    {"key": "Norte", "label": "Norte", "color": "#C25E7A"},
    {"key": "Internacional", "label": "Internacional", "color": "#5B7185"},
    {"key": "Não informado", "label": "Não informado", "color": "#94A3B8"},
]
REGION_ORDER = {r["key"]: i for i, r in enumerate(REGIONS)}

LOB_ALIASES = {
    "service now": "SERVICENOW",
}
LOB_LABELS = {
    "HR AMS": "HR AMS",
    "TECHNICAL": "Technical",
    "HR CORE": "HR Core",
    "ERP AMS": "ERP AMS",
    "ERP": "ERP",
    "HR EC": "HR EC",
    "HR TALENT": "HR Talent",
    "Stratview": "Stratview",
    "STRATVIEW": "Stratview",
    "BACKOFFICE": "Backoffice",
    "Solution Advisory": "Solution Advisory",
    "PMO": "PMO",
    "STRATEGIC ALLOCATION UNIT": "Strategic Allocation",
    "HR EVOLUTION": "HR Evolution",
    "Sales": "Sales",
    "SERVICENOW": "ServiceNow",
    "ERP PROJECTS": "ERP Projects",
    "People": "People",
    "MARKETING": "Marketing",
    "PROCESS EXCELLENCE": "Process Excellence",
    "DIRETORIA": "Diretoria",
    "HR TALENT/HR EVOLUTION": "HR Talent / HR Evolution",
    "EUGS": "EUGS",
    "ERP T&M": "ERP T&M",
    "DSA": "DSA",
    "HR": "HR",
    "-": "Não informado",
}

FOREIGN_PLACES = {
    "barcelona": ("Barcelona", "Espanha"),
    "terrassa": ("Terrassa", "Espanha"),
    "lisboa": ("Lisboa", "Portugal"),
}

CITY_ALIASES = {
    "gama": "brasilia",
    "balneario camburiu": "balneario camboriu",
    "rio janeiro": "rio de janeiro",
}

NAME_FIXES = [
    ("Andr\ufffd", "André"),
    ("Jos\ufffd", "José"),
    ("Magalh\ufffd", "Magalhã"),
    ("Gon\ufffd", "Gonç"),
    ("Coordinator\ufffd", "Coordinator"),
]

CONNECTORS = {"de", "da", "do", "das", "dos", "e", "d"}

NAME_ACCENTS = {
    "Andre": "André",
    "Antonio": "Antônio",
    "Cesar": "César",
    "Fabio": "Fábio",
    "Goncalves": "Gonçalves",
    "Guimaraes": "Guimarães",
    "Joao": "João",
    "Jose": "José",
    "Lucio": "Lúcio",
    "Magalhaes": "Magalhães",
    "Mauricio": "Maurício",
    "Rogerio": "Rogério",
    "Sergio": "Sérgio",
    "Simoes": "Simões",
    "Valeria": "Valéria",
}


def clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value)
    for old, new in NAME_FIXES:
        text = text.replace(old, new)
    text = text.replace("\ufffd", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def norm_key(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def pretty_name(value: str | None) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    words = []
    for i, word in enumerate(text.split()):
        lower = word.lower()
        if i > 0 and lower in CONNECTORS:
            words.append(lower)
        else:
            words.append(NAME_ACCENTS.get(word, word))
    return " ".join(words)


def pretty_city(value: str | None) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    if text.isupper():
        text = text.title()
    words = []
    for i, word in enumerate(text.split()):
        lower = word.lower()
        if i > 0 and lower in CONNECTORS:
            words.append(lower)
        elif lower == "d'oeste":
            words.append("d'Oeste")
        else:
            words.append(word[:1].upper() + word[1:].lower() if word.isupper() else word)
    return " ".join(words)


def iso_date(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def idstr(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text or None


def join_name(first, middle, last) -> str:
    parts = [clean_text(p) for p in (first, middle, last) if clean_text(p)]
    return " ".join(parts)


def load_reference_data():
    with (DATA_DIR / "estados.csv").open(encoding="utf-8-sig") as fh:
        estados = list(csv.DictReader(fh))
    with (DATA_DIR / "municipios.csv").open(encoding="utf-8-sig") as fh:
        municipios = list(csv.DictReader(fh))

    uf_by_code = {e["codigo_uf"]: e for e in estados}
    uf_by_key = {}
    for e in estados:
        uf_by_key[norm_key(e["nome"])] = e
        uf_by_key[norm_key(e["uf"])] = e

    by_city_uf = {}
    by_city = defaultdict(list)
    for m in municipios:
        estado = uf_by_code[m["codigo_uf"]]
        item = {
            "name": clean_text(m["nome"]),
            "uf": estado["uf"],
            "uf_name": clean_text(estado["nome"]),
            "region": clean_text(estado["regiao"]),
            "lat": float(m["latitude"]),
            "lon": float(m["longitude"]),
        }
        by_city_uf[(norm_key(item["name"]), item["uf"])] = item
        by_city[norm_key(item["name"])].append(item)

    return estados, uf_by_code, uf_by_key, by_city_uf, by_city


def build_geo(estados):
    raw = json.loads((DATA_DIR / "brazil-states.geojson").read_text(encoding="utf-8"))
    by_code = {e["codigo_uf"]: e for e in estados}

    def densify(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 4), round(coords[1], 4)]
        return [densify(c) for c in coords]

    features = []
    for feature in raw["features"]:
        code = str(feature["properties"]["codarea"])
        estado = by_code.get(code)
        if not estado:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "code": code,
                    "uf": estado["uf"],
                    "name": clean_text(estado["nome"]),
                    "region": clean_text(estado["regiao"]),
                },
                "geometry": {
                    "type": feature["geometry"]["type"],
                    "coordinates": densify(feature["geometry"]["coordinates"]),
                },
            }
        )
    features.sort(key=lambda f: f["properties"]["uf"])
    geo = {"type": "FeatureCollection", "features": features}
    (ASSETS_DIR / "geo.js").write_text(
        "window.BR_GEO = " + json.dumps(geo, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def load_rows(xlsx_path: Path):
    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit("Instale openpyxl: python3 -m pip install openpyxl") from exc

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [clean_text(h) for h in rows[0]]
    records = [dict(zip(header, r)) for r in rows[1:]]
    return records


def build(xlsx_path: Path):
    estados, uf_by_code, uf_by_key, by_city_uf, by_city = load_reference_data()
    build_geo(estados)

    records = load_rows(xlsx_path)
    total_raw = len(records)
    inactive = 0
    excluded_admin = 0

    real_by_email = {}
    excluded_ids = set()
    for row in records:
        empresa = clean_text(row.get("Empresa"))
        emp_id = idstr(row.get("ID do sistema do usuário"))
        email = (clean_text(row.get("E-mail")) or "").lower()
        if empresa == "Z-ADMIN":
            if emp_id:
                excluded_ids.add(emp_id)
        elif not row.get("Data de Rescisão") and email and emp_id:
            real_by_email[email] = emp_id

    admin_remap = {}
    for row in records:
        if clean_text(row.get("Empresa")) != "Z-ADMIN":
            continue
        admin_id = idstr(row.get("ID do sistema do usuário"))
        email = (clean_text(row.get("E-mail")) or "").lower()
        if admin_id and email in real_by_email:
            admin_remap[admin_id] = real_by_email[email]

    employees = []
    for row in records:
        empresa = clean_text(row.get("Empresa"))
        if empresa == "Z-ADMIN":
            excluded_admin += 1
            continue
        if row.get("Data de Rescisão"):
            inactive += 1
            continue

        emp_id = idstr(row.get("ID do sistema do usuário"))
        manager_id = idstr(row.get("ID do sistema do usuário do gerente"))
        if manager_id in excluded_ids:
            manager_id = admin_remap.get(manager_id)
        name = pretty_name(join_name(row.get("Nome"), row.get("Nome do meio"), row.get("Sobrenome")))
        if not name:
            continue

        lob_raw = clean_text(row.get("Centro de Responsabilidade/LOB")) or "Não informado"
        if lob_raw.lower() in LOB_ALIASES:
            lob_raw = LOB_ALIASES[lob_raw.lower()]
        if lob_raw.upper() in LOB_LABELS and lob_raw.upper() not in ("STRATVIEW",):
            lob_key = lob_raw.upper() if lob_raw.isupper() else lob_raw
        else:
            lob_key = lob_raw
        if lob_key.upper() in LOB_LABELS:
            lob_label = LOB_LABELS[lob_key.upper()]
        else:
            lob_label = LOB_LABELS.get(lob_key, lob_key)
        if lob_key == "-":
            lob_key, lob_label = "Não informado", "Não informado"

        raw_city = clean_text(row.get("Cidade"))
        raw_state = clean_text(row.get("Estado"))
        city_key = norm_key(raw_city)
        state_key = norm_key(raw_state)

        city = None
        uf = None
        state_name = None
        region = None
        country = "Brasil"
        lat = lon = None
        mapped = False

        foreign = FOREIGN_PLACES.get(city_key) or FOREIGN_PLACES.get(state_key)
        if foreign:
            city, country = foreign
            region = "Internacional"
            state_name = country
            mapped = False
        else:
            city_alias = CITY_ALIASES.get(city_key, city_key)
            uf_info = uf_by_key.get(state_key) if state_key else None
            chosen = None
            if uf_info and city_alias:
                chosen = by_city_uf.get((city_alias, uf_info["uf"]))
            if chosen is None and city_alias:
                candidates = by_city.get(city_alias, [])
                if len(candidates) == 1:
                    chosen = candidates[0]
                elif uf_info:
                    same_region = [c for c in candidates if c["region"] == clean_text(uf_info["regiao"])]
                    if len(same_region) == 1:
                        chosen = same_region[0]
            if chosen:
                city = chosen["name"]
                uf = chosen["uf"]
                state_name = chosen["uf_name"]
                region = chosen["region"]
                lat = chosen["lat"]
                lon = chosen["lon"]
                mapped = True
            else:
                city = pretty_city(raw_city)
                if uf_info:
                    uf = uf_info["uf"]
                    state_name = clean_text(uf_info["nome"])
                    region = clean_text(uf_info["regiao"])
                elif city:
                    city = city
                if city_key in FOREIGN_PLACES:
                    region = "Internacional"
                    country = FOREIGN_PLACES[city_key][1]

        if region is None:
            region = "Não informado"
            country = None
        elif region != "Internacional" and not mapped:
            country = "Brasil"

        manager_name = pretty_name(
            join_name(row.get("Gerente Nome"), None, row.get("Gerente Sobrenome"))
        )
        manager_email = clean_text(row.get("Gerente E-mail"))
        if manager_email:
            manager_email = manager_email.lower()

        company_raw = empresa or ""
        if company_raw.upper() == "STRATVIEW":
            company = "Stratview"
        else:
            company = "EPI-USE"

        employees.append(
            {
                "id": emp_id,
                "name": name,
                "first": pretty_name(clean_text(row.get("Nome"))) or name.split(" ")[0],
                "role": clean_text(row.get("Cargo")) or "Não informado",
                "lob": lob_key,
                "lobLabel": lob_label,
                "city": city,
                "uf": uf,
                "state": state_name,
                "region": region,
                "country": country,
                "lat": lat,
                "lon": lon,
                "mapped": mapped,
                "managerId": manager_id,
                "managerName": manager_name,
                "managerEmail": manager_email,
                "hire": iso_date(row.get("Data de contratação")),
                "email": (clean_text(row.get("E-mail")) or "").lower() or None,
                "company": company,
            }
        )

    by_id = {e["id"]: e for e in employees if e["id"]}

    children = defaultdict(list)
    for emp in employees:
        if emp["managerId"] and emp["managerId"] != emp["id"]:
            children[emp["managerId"]].append(emp["id"])

    def descendants(mid, seen=None):
        seen = set() if seen is None else seen
        out = []
        for child in children.get(mid, []):
            if child in seen:
                continue
            seen.add(child)
            out.append(child)
            out.extend(descendants(child, seen))
        return out

    # Nome do gestor: registro do próprio gestor quando existir, senão o nome
    # que aparece nas linhas dos liderados.
    manager_meta = {}
    for mid in children:
        record = by_id.get(mid)
        if record:
            manager_meta[mid] = {
                "id": mid,
                "name": record["name"],
                "email": record["email"],
                "role": record["role"],
                "lob": record["lob"],
                "lobLabel": record["lobLabel"],
                "direct": len(children[mid]),
                "total": len(descendants(mid)),
            }
        else:
            sample = next((e for e in employees if e["managerId"] == mid), None)
            manager_meta[mid] = {
                "id": mid,
                "name": sample["managerName"] if sample else "Gestor",
                "email": sample["managerEmail"] if sample else None,
                "role": "Gestor",
                "lob": sample["lob"] if sample else None,
                "lobLabel": sample["lobLabel"] if sample else None,
                "direct": len(children[mid]),
                "total": len(descendants(mid)),
            }

    managers = sorted(manager_meta.values(), key=lambda m: (norm_key(m["name"]), m["id"]))
    for m in managers:
        if m["name"] == "Adriano Martins":
            default_manager = m["id"]
    default_manager = next(
        (m["id"] for m in managers if m["email"] == "adriano.martins@epiuse.com.br"),
        managers[0]["id"] if managers else None,
    )

    # Nomes completos dos gestores nos registros dos colaboradores.
    for emp in employees:
        mid = emp["managerId"]
        if mid and mid in manager_meta:
            emp["managerName"] = manager_meta[mid]["name"]
            emp["managerEmail"] = manager_meta[mid]["email"]

    lob_counts = Counter(e["lob"] for e in employees)
    lob_labels = {e["lob"]: e["lobLabel"] for e in employees}
    lobs = [
        {"key": key, "label": lob_labels[key], "count": count}
        for key, count in sorted(
            lob_counts.items(), key=lambda kv: (-kv[1], norm_key(lob_labels[kv[0]]))
        )
    ]

    mapped = [e for e in employees if e["mapped"]]
    region_counts = Counter(e["region"] for e in employees)
    city_counts = Counter((e["city"], e["uf"]) for e in mapped)
    state_counts = Counter(e["uf"] for e in mapped)

    payload = {
        "meta": {
            "snapshot": SNAPSHOT_LABEL,
            "referenceDate": REFERENCE_DATE.isoformat(),
            "source": "Dados Cadastrais dos Colaboradores",
            "totalRaw": total_raw,
            "total": len(employees),
            "inactive": inactive,
            "excludedAdmin": excluded_admin,
            "mapped": len(mapped),
            "international": sum(1 for e in employees if e["region"] == "Internacional"),
            "unknown": sum(1 for e in employees if e["region"] == "Não informado"),
            "cities": len(city_counts),
            "states": len(state_counts),
            "regions": sum(
                1 for r in REGIONS if r["key"] not in ("Internacional", "Não informado") and region_counts.get(r["key"])
            ),
            "lobs": len(lobs),
            "managers": len(managers),
            "defaultManager": default_manager,
        },
        "regions": REGIONS,
        "regionCounts": {r["key"]: region_counts.get(r["key"], 0) for r in REGIONS},
        "lobs": lobs,
        "managers": managers,
        "employees": employees,
    }

    (ROOT / "data.js").write_text(
        "window.EPI_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    print(f"Colaboradores ativos: {len(employees)} (de {total_raw} linhas)")
    print(f"Contas administrativas excluídas: {excluded_admin} | desligados: {inactive}")
    print(f"Mapeados: {len(mapped)} | Internacional: {payload['meta']['international']} | Sem localização: {payload['meta']['unknown']}")
    print(f"Cidades: {len(city_counts)} | Estados: {len(state_counts)} | Gestores: {len(managers)} | LOBs: {len(lobs)}")
    print(f"Gestor padrão: {default_manager}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gera data.js e geo.js para o dashboard Meu Time.")
    parser.add_argument("--xlsx", type=Path, default=Path(DEFAULT_XLSX), help="Planilha de origem")
    args = parser.parse_args()
    if not args.xlsx.exists():
        raise SystemExit(f"Planilha não encontrada: {args.xlsx}")
    build(args.xlsx)
