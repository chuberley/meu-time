(() => {
  "use strict";

  const DATA = window.EPI_DATA;
  const GEO = window.BR_GEO;

  if (!DATA || !GEO) {
    document.body.innerHTML = "<p style='padding:40px;font-family:sans-serif'>Dados não encontrados. Execute o build de dados novamente.</p>";
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const EMP = DATA.employees;
  const BY_ID = new Map(EMP.map((e) => [e.id, e]));
  const MANAGER_BY_ID = new Map(DATA.managers.map((m) => [m.id, m]));
  const REGION_BY_KEY = new Map(DATA.regions.map((r) => [r.key, r]));
  const BR_REGIONS = ["Sudeste", "Sul", "Nordeste", "Centro-Oeste", "Norte"];
  const REFERENCE = new Date(`${DATA.meta.referenceDate}T00:00:00`);
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NUMBER = new Intl.NumberFormat("pt-BR");
  const MAP_W = 720;
  const MAP_H = 780;
  const MAP_PAD = 24;
  const BASE_VIEW = { x: 0, y: 0, w: MAP_W, h: MAP_H };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const formatNumber = (value) => NUMBER.format(Number(value) || 0);
  const personWord = (count) => (count === 1 ? "pessoa" : "pessoas");
  const cityWord = (count) => (count === 1 ? "cidade" : "cidades");
  const regionColor = (key) => REGION_BY_KEY.get(key)?.color || "#0F9B8E";
  const emptyGeo = () => ({ region: null, uf: null, city: null });
  const hasGeo = (geo) => Boolean(geo?.region || geo?.uf || geo?.city);

  const shade = (hex, percent) => {
    const value = parseInt(String(hex).replace("#", ""), 16);
    if (Number.isNaN(value)) return hex;
    const amount = Math.round(2.55 * percent);
    const red = clamp((value >> 16) + amount, 0, 255);
    const green = clamp(((value >> 8) & 0x00ff) + amount, 0, 255);
    const blue = clamp((value & 0x0000ff) + amount, 0, 255);
    return `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1)}`;
  };

  const avatarBackground = (color) =>
    `linear-gradient(135deg, ${color}, ${shade(color, -18)})`;

  const initials = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  };

  const tenureParts = (hire) => {
    if (!hire) return { label: "—", months: null };
    const date = new Date(`${hire}T00:00:00`);
    if (Number.isNaN(date.getTime())) return { label: "—", months: null };
    let months = (REFERENCE.getFullYear() - date.getFullYear()) * 12 +
      (REFERENCE.getMonth() - date.getMonth());
    if (REFERENCE.getDate() < date.getDate()) months -= 1;
    months = Math.max(0, months);
    const years = Math.floor(months / 12);
    const remainder = months % 12;
    let label;
    if (years === 0) label = `${months} ${months === 1 ? "mês" : "meses"}`;
    else if (remainder === 0) label = `${years}a`;
    else label = `${years}a ${remainder}m`;
    return { label, months };
  };

  const formatDate = (iso) => {
    if (!iso) return "—";
    const date = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("pt-BR");
  };

  const formatPercent = (count, total) => {
    if (!total) return "0%";
    return `${(count / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  };

  const debounce = (fn, wait = 120) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  EMP.forEach((employee) => {
    employee._tenure = tenureParts(employee.hire);
    employee._search = normalize([
      employee.name,
      employee.role,
      employee.lobLabel,
      employee.city,
      employee.uf,
      employee.state,
      employee.region,
      employee.managerName,
      employee.email,
    ].join(" "));
  });

  const childMap = new Map();
  EMP.forEach((employee) => {
    if (!employee.managerId) return;
    if (!childMap.has(employee.managerId)) childMap.set(employee.managerId, []);
    childMap.get(employee.managerId).push(employee.id);
  });

  const teamCache = new Map();
  const descendants = (managerId) => {
    if (teamCache.has(managerId)) return teamCache.get(managerId);
    const result = [];
    const seen = new Set();
    const walk = (id) => {
      for (const child of childMap.get(id) || []) {
        if (seen.has(child)) continue;
        seen.add(child);
        result.push(child);
        walk(child);
      }
    };
    walk(managerId);
    teamCache.set(managerId, result);
    return result;
  };

  const selectedManager = () => (state.managerId === "all" ? null : MANAGER_BY_ID.get(state.managerId));

  const baseTeam = () => {
    if (state.managerId === "all") return EMP;
    const ids = state.scope === "direct"
      ? childMap.get(state.managerId) || []
      : descendants(state.managerId);
    return ids.map((id) => BY_ID.get(id)).filter(Boolean);
  };

  const teamAfterLob = () => {
    const team = baseTeam();
    if (state.lob === "all") return team;
    return team.filter((employee) => employee.lob === state.lob);
  };

  const cityMatchesGeo = (city, geo) => {
    if (!hasGeo(geo)) return true;
    if (geo.city) return city.city === geo.city && (!geo.uf || city.uf === geo.uf);
    if (geo.uf) return city.uf === geo.uf;
    if (geo.region) return city.region === geo.region;
    return true;
  };

  const employeeMatchesGeo = (employee, geo) => {
    if (!hasGeo(geo)) return true;
    if (geo.city) return employee.city === geo.city && (!geo.uf || employee.uf === geo.uf);
    if (geo.uf) return employee.uf === geo.uf;
    if (geo.region) return employee.region === geo.region;
    return true;
  };

  const visibleTeam = () => teamAfterLob().filter((employee) => employeeMatchesGeo(employee, state.geo));

  const aggregateCities = (team) => {
    const map = new Map();
    for (const employee of team) {
      if (!employee.mapped || employee.lat == null || employee.lon == null) continue;
      const key = `${employee.uf}|${employee.city}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          city: employee.city,
          uf: employee.uf,
          region: employee.region,
          lat: employee.lat,
          lon: employee.lon,
          count: 0,
        });
      }
      map.get(key).count += 1;
    }
    return Array.from(map.values()).sort(
      (a, b) => b.count - a.count || a.city.localeCompare(b.city, "pt-BR"),
    );
  };

  const countUnique = (list, selector) => new Set(list.map(selector).filter(Boolean)).size;

  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;

  const eachCoord = (coords, callback) => {
    if (typeof coords[0] === "number") {
      callback(coords);
      return;
    }
    for (const child of coords) eachCoord(child, callback);
  };

  for (const feature of GEO.features) {
    eachCoord(feature.geometry.coordinates, ([lon, lat]) => {
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    });
  }

  lonMin -= 0.2;
  lonMax += 0.2;
  latMin -= 0.2;
  latMax += 0.2;

  const mercator = (lat) => {
    const safe = clamp(lat, -85, 85);
    return Math.log(Math.tan(Math.PI / 4 + (safe * Math.PI) / 360));
  };
  const mercTop = mercator(latMax);
  const mercBottom = mercator(latMin);

  const project = (lon, lat) => [
    MAP_PAD + ((lon - lonMin) / (lonMax - lonMin)) * (MAP_W - MAP_PAD * 2),
    MAP_PAD + ((mercTop - mercator(lat)) / (mercTop - mercBottom)) * (MAP_H - MAP_PAD * 2),
  ];

  const buildShape = (feature) => {
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
    let d = "";
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        ring.forEach((coord, index) => {
          const [x, y] = project(coord[0], coord[1]);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          d += `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        });
        d += "Z";
      }
    }
    return {
      uf: feature.properties.uf,
      name: feature.properties.name,
      region: feature.properties.region,
      d,
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    };
  };

  const STATE_SHAPES = GEO.features.map(buildShape).filter((shape) => shape.uf);
  const STATE_BY_UF = new Map(STATE_SHAPES.map((shape) => [shape.uf, shape]));
  const REGION_BBOX = new Map();

  for (const region of BR_REGIONS) {
    const shapes = STATE_SHAPES.filter((shape) => shape.region === region);
    if (!shapes.length) continue;
    const minX = Math.min(...shapes.map((shape) => shape.bbox.x));
    const minY = Math.min(...shapes.map((shape) => shape.bbox.y));
    const maxX = Math.max(...shapes.map((shape) => shape.bbox.x + shape.bbox.w));
    const maxY = Math.max(...shapes.map((shape) => shape.bbox.y + shape.bbox.h));
    REGION_BBOX.set(region, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }

  const state = {
    managerId: DATA.meta.defaultManager,
    scope: "full",
    lob: "all",
    geo: emptyGeo(),
    search: "",
    sort: "name",
    pageSize: 8,
  };

  if (state.managerId !== "all" && !MANAGER_BY_ID.has(state.managerId)) {
    state.managerId = "all";
  }

  const el = {
    themeBtn: $("#themeBtn"),
    themeIcon: $("#themeIcon"),
    menuBtn: $("#menuBtn"),
    sidebar: $("#sidebar"),
    sidebarOverlay: $("#sidebarOverlay"),
    profileBtn: $("#profileBtn"),
    profilePopover: $("#profilePopover"),
    popoverName: $("#popoverName"),
    popoverChange: $("#popoverChange"),
    headerAvatar: $("#headerAvatar"),
    headerName: $("#headerName"),
    headerRole: $("#headerRole"),
    snapshotLabel: $("#snapshotLabel"),
    heroGreeting: $("#heroGreeting"),
    heroSub: $("#heroSub"),
    heroRole: $("#heroRole"),
    heroCount: $("#heroCount"),
    heroAvatars: $("#heroAvatars"),
    heroCaption: $("#heroCaption"),
    managerSelect: $("#managerSelect"),
    lobSelect: $("#lobSelect"),
    scopeField: $("#scopeField"),
    scopeFullCount: $("#scopeFullCount"),
    scopeDirectCount: $("#scopeDirectCount"),
    resetBtn: $("#resetBtn"),
    kpiPeople: $("#kpiPeople"),
    kpiPeopleSub: $("#kpiPeopleSub"),
    kpiPeopleChip: $("#kpiPeopleChip"),
    kpiCities: $("#kpiCities"),
    kpiCitiesSub: $("#kpiCitiesSub"),
    kpiStates: $("#kpiStates"),
    kpiStatesSub: $("#kpiStatesSub"),
    kpiRegions: $("#kpiRegions"),
    kpiRegionsSub: $("#kpiRegionsSub"),
    kpiLobs: $("#kpiLobs"),
    kpiLobsSub: $("#kpiLobsSub"),
    mapBreadcrumb: $("#mapBreadcrumb"),
    zoomIn: $("#zoomIn"),
    zoomOut: $("#zoomOut"),
    zoomReset: $("#zoomReset"),
    mapCanvas: $("#mapCanvas"),
    brazilMap: $("#brazilMap"),
    mapTooltip: $("#mapTooltip"),
    mapNote: $("#mapNote"),
    mapEmpty: $("#mapEmpty"),
    regionChips: $("#regionChips"),
    mapMeta: $("#mapMeta"),
    mapDrillSummary: $("#mapDrillSummary"),
    mapSeePeople: $("#mapSeePeople"),
    scatterCanvas: $("#scatterCanvas"),
    scatter: $("#scatter"),
    scatterTooltip: $("#scatterTooltip"),
    scatterLegend: $("#scatterLegend"),
    scatterNote: $("#scatterNote"),
    citiesHint: $("#citiesHint"),
    cityList: $("#cityList"),
    peopleTitle: $("#peopleTitle"),
    peopleCount: $("#peopleCount"),
    peopleSub: $("#peopleSub"),
    searchInput: $("#searchInput"),
    searchClear: $("#searchClear"),
    sortSelect: $("#sortSelect"),
    exportBtn: $("#exportBtn"),
    activeFilters: $("#activeFilters"),
    peopleBody: $("#peopleBody"),
    tableScroll: $(".table-scroll"),
    emptyState: $("#emptyState"),
    emptyReset: $("#emptyReset"),
    peopleFootNote: $("#peopleFootNote"),
    loadMore: $("#loadMore"),
    drawer: $("#drawer"),
    drawerBackdrop: $("#drawerBackdrop"),
    drawerClose: $("#drawerClose"),
    drawerContent: $("#drawerContent"),
    toast: $("#toast"),
    footerSnapshot: $("#footerSnapshot"),
    footerNote: $("#footerNote"),
  };

  let mapView = { ...BASE_VIEW };
  let mapAnimation = 0;
  let mapRenderSignature = "";
  let suppressMapClick = false;
  let mapDragging = null;
  let lastFocusedElement = null;
  let toastTimer = 0;
  let searchTimer = 0;
  let drawerCloseTimer = 0;

  const setTheme = (theme, save = true) => {
    document.documentElement.dataset.theme = theme;
    el.themeIcon.setAttribute("href", theme === "dark" ? "#i-sun" : "#i-moon");
    el.themeBtn.setAttribute("aria-label", theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro");
    if (save) {
      try {
        localStorage.setItem("epi-theme", theme);
      } catch {
        /* noop */
      }
    }
  };

  const initialTheme = (() => {
    try {
      return localStorage.getItem("epi-theme")
        || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } catch {
      return "light";
    }
  })();

  const showToast = (message, icon = "#i-check") => {
    clearTimeout(toastTimer);
    el.toast.innerHTML = `<svg><use href="${icon}"/></svg><span>${escapeHtml(message)}</span>`;
    el.toast.classList.add("show");
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2800);
  };

  const populateManagerSelect = () => {
    let html = `<optgroup label="Visão geral"><option value="all">Todos os colaboradores · ${formatNumber(DATA.meta.total)}</option></optgroup>`;
    html += `<optgroup label="Gestores">`;
    for (const manager of DATA.managers) {
      html += `<option value="${escapeHtml(manager.id)}">${escapeHtml(manager.name)} · ${formatNumber(manager.total)}</option>`;
    }
    html += "</optgroup>";
    el.managerSelect.innerHTML = html;
    el.managerSelect.value = state.managerId;
  };

  const populateLobSelect = () => {
    const team = baseTeam();
    const counts = new Map();
    const labels = new Map();
    for (const employee of team) {
      counts.set(employee.lob, (counts.get(employee.lob) || 0) + 1);
      labels.set(employee.lob, employee.lobLabel);
    }
    const entries = Array.from(counts.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return labels.get(a[0]).localeCompare(labels.get(b[0]), "pt-BR");
    });
    if (state.lob !== "all" && !counts.has(state.lob)) state.lob = "all";
    let html = `<option value="all">Todos os centros · ${formatNumber(team.length)}</option>`;
    for (const [key, count] of entries) {
      html += `<option value="${escapeHtml(key)}">${escapeHtml(labels.get(key))} · ${formatNumber(count)}</option>`;
    }
    el.lobSelect.innerHTML = html;
    el.lobSelect.value = state.lob;
  };

  const updateScopeControls = () => {
    const manager = selectedManager();
    el.scopeField.hidden = !manager;
    if (!manager) {
      state.scope = "full";
      return;
    }
    const fullCount = descendants(manager.id).length;
    const directCount = (childMap.get(manager.id) || []).length;
    el.scopeFullCount.textContent = formatNumber(fullCount);
    el.scopeDirectCount.textContent = formatNumber(directCount);
    $$(".segmented button", el.scopeField).forEach((button) => {
      button.classList.toggle("active", button.dataset.scope === state.scope);
    });
  };

  const updateHeader = () => {
    const manager = selectedManager();
    if (!manager) {
      el.headerName.textContent = "EPI-USE Brasil";
      el.headerRole.textContent = "Visão geral";
      el.headerAvatar.textContent = "EP";
      el.headerAvatar.style.background = "linear-gradient(135deg, var(--teal), #0a6d65)";
      el.popoverName.textContent = "EPI-USE Brasil";
      document.title = "Meu time · EPI-USE Brasil";
      return;
    }
    const record = BY_ID.get(manager.id);
    const color = regionColor(record?.region);
    el.headerName.textContent = manager.name;
    el.headerRole.textContent = manager.role;
    el.headerAvatar.textContent = initials(manager.name);
    el.headerAvatar.style.background = avatarBackground(color);
    el.popoverName.textContent = manager.name;
    document.title = `Meu time · ${manager.name} · EPI-USE`;
  };

  const renderHero = () => {
    const manager = selectedManager();
    const team = teamAfterLob();
    const cities = countUnique(team.filter((employee) => employee.mapped), (employee) => `${employee.uf}|${employee.city}`);
    const international = team.filter((employee) => employee.region === "Internacional").length;

    el.heroGreeting.textContent = manager ? `Olá, ${manager.name.split(" ")[0]}.` : "Olá, time.";
    el.heroSub.textContent = manager
      ? "Seu time em um só lugar. Explore o mapa, filtre por centro de responsabilidade e conheça cada pessoa."
      : "Visão geral dos colaboradores ativos da EPI-USE Brasil. Explore por centro de responsabilidade e geografia.";
    el.heroRole.textContent = manager ? manager.role : "EPI-USE Brasil";
    el.heroCount.textContent = `${formatNumber(team.length)} ${personWord(team.length)}`;
    el.heroCaption.textContent = cities
      ? `em ${formatNumber(cities)} ${cityWord(cities)}`
      : international
        ? `${formatNumber(international)} no exterior`
        : "sem localização mapeada";

    const avatars = team.slice(0, 5);
    let avatarsHtml = "";
    for (const employee of avatars) {
      avatarsHtml += `<span class="avatar" title="${escapeHtml(employee.name)}" style="background:${avatarBackground(regionColor(employee.region))}">${escapeHtml(initials(employee.name))}</span>`;
    }
    if (team.length > avatars.length) {
      avatarsHtml += `<span class="avatar more">+${formatNumber(team.length - avatars.length)}</span>`;
    }
    el.heroAvatars.innerHTML = avatarsHtml;
  };

  const animateKpi = (element, value) => {
    const previous = Number(element.dataset.value || 0);
    if (previous === value) {
      element.textContent = formatNumber(value);
      return;
    }
    element.dataset.value = value;
    cancelAnimationFrame(element._kpiFrame);
    if (REDUCED_MOTION) {
      element.textContent = formatNumber(value);
      return;
    }
    const start = performance.now();
    const duration = 560;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatNumber(Math.round(previous + (value - previous) * eased));
      if (progress < 1) element._kpiFrame = requestAnimationFrame(step);
    };
    element._kpiFrame = requestAnimationFrame(step);
  };

  const renderKpis = () => {
    const team = visibleTeam();
    const mapped = team.filter((employee) => employee.mapped);
    const cities = new Set(mapped.map((employee) => `${employee.uf}|${employee.city}`));
    const states = new Set(mapped.map((employee) => employee.uf));
    const regions = new Set(mapped.map((employee) => employee.region).filter((region) => BR_REGIONS.includes(region)));
    const lobCounts = new Map();
    for (const employee of team) {
      lobCounts.set(employee.lobLabel, (lobCounts.get(employee.lobLabel) || 0) + 1);
    }
    const topLob = Array.from(lobCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    const manager = selectedManager();

    animateKpi(el.kpiPeople, team.length);
    animateKpi(el.kpiCities, cities.size);
    animateKpi(el.kpiStates, states.size);
    animateKpi(el.kpiRegions, regions.size);
    animateKpi(el.kpiLobs, lobCounts.size);

    el.kpiPeopleChip.textContent = !manager ? "geral" : state.scope === "direct" ? "direto" : "time";
    el.kpiPeopleSub.textContent = hasGeo(state.geo)
      ? `no recorte · ${geoLabelShort()}`
      : manager
        ? `time de ${manager.name.split(" ")[0]}`
        : "todos os colaboradores ativos";

    el.kpiCitiesSub.textContent = mapped.length
      ? `${formatNumber(mapped.length)} colaboradores mapeados`
      : "sem localização mapeada";

    el.kpiStatesSub.textContent = states.size
      ? `${formatNumber(regions.size)} ${regions.size === 1 ? "região representada" : "regiões representadas"}`
      : "sem localização mapeada";

    const missingRegions = BR_REGIONS.filter((region) => !regions.has(region));
    el.kpiRegionsSub.textContent = regions.size === 0
      ? "sem regiões representadas"
      : missingRegions.length === 0
        ? "todas as 5 regiões do Brasil"
        : missingRegions.length === 1
          ? `${missingRegions[0]} sem colaboradores`
          : `${missingRegions.length} regiões sem colaboradores`;

    el.kpiLobsSub.textContent = topLob
      ? `maior: ${topLob[0]} · ${formatNumber(topLob[1])}`
      : "sem centros no recorte";
  };

  const geoLabelShort = () => {
    const geo = state.geo;
    if (geo.city) return `${geo.city}${geo.uf ? `, ${geo.uf}` : ""}`;
    if (geo.uf) return geo.uf;
    if (geo.region === "Internacional") return "Exterior";
    if (geo.region === "Não informado") return "Sem localização";
    if (geo.region) return geo.region;
    return "Brasil";
  };

  const geoLabelLong = () => {
    const geo = state.geo;
    if (geo.city) return `${geo.city}${geo.uf ? `, ${geo.uf}` : ""}`;
    if (geo.uf) return STATE_BY_UF.get(geo.uf)?.name || geo.uf;
    if (geo.region === "Internacional") return "Exterior";
    if (geo.region === "Não informado") return "Sem localização";
    if (geo.region) return geo.region;
    return "Brasil";
  };

  const renderRegionChips = () => {
    const team = teamAfterLob();
    const counts = new Map();
    for (const employee of team) {
      counts.set(employee.region, (counts.get(employee.region) || 0) + 1);
    }
    let html = "";
    for (const region of BR_REGIONS) {
      const count = counts.get(region) || 0;
      const active = state.geo.region === region;
      html += `<button type="button" class="region-chip ${active ? "active" : ""} ${count === 0 ? "zero" : ""}" data-region="${escapeHtml(region)}" ${count === 0 ? "disabled" : ""} style="--c:${regionColor(region)}">
        <span class="r-dot"></span>
        <span>${escapeHtml(region)}</span>
        <span class="r-count">${formatNumber(count)}</span>
      </button>`;
    }
    el.regionChips.innerHTML = html;

    const international = counts.get("Internacional") || 0;
    const unknown = counts.get("Não informado") || 0;
    let meta = "";
    if (international) {
      meta += `<button type="button" data-special="Internacional" class="${state.geo.region === "Internacional" ? "is-active" : ""}"><svg><use href="#i-globe"/></svg>${formatNumber(international)} no exterior</button>`;
    }
    if (unknown) {
      meta += `<button type="button" data-special="Não informado" class="${state.geo.region === "Não informado" ? "is-active" : ""}"><svg><use href="#i-info"/></svg>${formatNumber(unknown)} sem localização</button>`;
    }
    el.mapMeta.innerHTML = meta;
  };

  const renderBreadcrumb = () => {
    const geo = state.geo;
    const nodes = [];
    const addNode = (label, current, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (current) button.classList.add("is-current");
      if (action) button.addEventListener("click", action);
      else button.disabled = true;
      nodes.push(button);
    };
    const addSeparator = () => {
      const separator = document.createElement("span");
      separator.className = "sep";
      separator.textContent = "›";
      nodes.push(separator);
    };

    addNode("Brasil", !hasGeo(geo), () => setGeoFor(null));
    if (geo.region) {
      addSeparator();
      const label = geo.region === "Internacional"
        ? "Exterior"
        : geo.region === "Não informado"
          ? "Sem localização"
          : geo.region;
      addNode(label, !geo.uf && !geo.city, () => setGeoFor({ region: geo.region }));
    }
    if (geo.uf) {
      addSeparator();
      addNode(geo.uf, !geo.city, () => setGeoFor({ region: geo.region, uf: geo.uf }));
    }
    if (geo.city) {
      addSeparator();
      addNode(geo.city, true, null);
    }

    el.mapBreadcrumb.innerHTML = "";
    for (const node of nodes) el.mapBreadcrumb.appendChild(node);
  };

  const renderMapDrillSummary = () => {
    const team = visibleTeam();
    const cities = countUnique(team.filter((employee) => employee.mapped), (employee) => `${employee.uf}|${employee.city}`);
    let text = `${geoLabelLong()} · ${formatNumber(team.length)} ${personWord(team.length)}`;
    if (cities) text += ` · ${formatNumber(cities)} ${cityWord(cities)}`;
    el.mapDrillSummary.textContent = text;
  };

  const renderMap = () => {
    const team = teamAfterLob();
    const cities = aggregateCities(team);
    const total = team.length;
    const mapped = cities.reduce((sum, city) => sum + city.count, 0);

    const stateData = new Map();
    for (const employee of team) {
      if (!employee.mapped) continue;
      if (!stateData.has(employee.uf)) stateData.set(employee.uf, { count: 0, cities: new Set() });
      const entry = stateData.get(employee.uf);
      entry.count += 1;
      entry.cities.add(employee.city);
    }

    const rect = el.mapCanvas.getBoundingClientRect();
    const canvasWidth = rect.width || 640;
    const canvasHeight = rect.height || 438;
    const screenScale = Math.max(0.2, Math.min(canvasWidth / mapView.w, canvasHeight / mapView.h));
    const toMap = 1 / screenScale;

    const special = state.geo.region === "Internacional" || state.geo.region === "Não informado";

    const stateHtml = STATE_SHAPES.map((shape) => {
      let className = "state-path";
      if (special) {
        className += " is-dim";
      } else if (state.geo.region) {
        if (state.geo.uf === shape.uf) className += " is-selected";
        else if (shape.region === state.geo.region) className += " is-active";
        else className += " is-dim";
      }
      return `<path class="${className}" d="${shape.d}" fill-rule="evenodd" data-uf="${escapeHtml(shape.uf)}" tabindex="0" role="button" aria-label="${escapeHtml(shape.name)}" style="--state-fill:${regionColor(shape.region)};stroke-width:${(1.1 * toMap).toFixed(2)}px"></path>`;
    }).join("");

    const maxCount = cities[0]?.count || 1;
    const signature = `${state.managerId}|${state.scope}|${state.lob}|${team.length}|${cities.length}`;
    const animateBubbles = signature !== mapRenderSignature;
    mapRenderSignature = signature;

    const bubbleHtml = cities.map((city) => {
      const [x, y] = project(city.lon, city.lat);
      const active = state.geo.city === city.city && (!state.geo.uf || state.geo.uf === city.uf);
      const muted = hasGeo(state.geo) && !cityMatchesGeo(city, state.geo);
      const screenRadius = 5.5 + 15 * Math.sqrt(city.count / maxCount);
      const radius = screenRadius * toMap;
      const color = regionColor(city.region);
      const halo = active
        ? `<circle class="city-halo is-active" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius + 5 * toMap).toFixed(2)}" style="--bubble-fill:${color};stroke-width:${(1.7 * toMap).toFixed(2)}px"></circle>`
        : "";
      return `<g>
        ${halo}
        <circle class="city-bubble ${active ? "is-active" : ""} ${muted ? "is-muted" : ""} ${animateBubbles ? "animate" : ""}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" data-city="${escapeHtml(city.city)}" data-uf="${escapeHtml(city.uf)}" data-region="${escapeHtml(city.region)}" data-count="${city.count}" tabindex="0" role="button" aria-label="${escapeHtml(city.city)}: ${city.count} colaboradores" style="--bubble-fill:${color};stroke-width:${(1.3 * toMap).toFixed(2)}px"></circle>
      </g>`;
    }).join("");

    const labelCandidates = cities.filter((city) => !hasGeo(state.geo) || cityMatchesGeo(city, state.geo));
    const maxLabels = mapView.w > 620 ? 7 : mapView.w > 300 ? 13 : 20;
    const placed = [];
    const labelParts = [];
    const addLabel = (city, force = false) => {
      const [x, y] = project(city.lon, city.lat);
      const screenRadius = 5.5 + 15 * Math.sqrt(city.count / maxCount);
      const radius = screenRadius * toMap;
      const fontSize = 10.5 * toMap;
      const textWidth = city.city.length * 5.5 * toMap;
      const textHeight = 11 * toMap;
      const options = [
        { x: x - textWidth / 2, y: y - radius - 4 * toMap - textHeight, w: textWidth, h: textHeight, baseline: y - radius - 4 * toMap },
        { x: x - textWidth / 2, y: y + radius + 4 * toMap, w: textWidth, h: textHeight, baseline: y + radius + 4 * toMap + textHeight * 0.8 },
      ];
      let position = null;
      for (const option of options) {
        const collides = placed.some((box) =>
          option.x < box.x + box.w &&
          option.x + option.w > box.x &&
          option.y < box.y + box.h &&
          option.y + option.h > box.y,
        );
        if (!collides) {
          position = option;
          break;
        }
      }
      if (!position && !force) return;
      if (!position) position = options[0];
      placed.push(position);
      const active = state.geo.city === city.city;
      labelParts.push(`<text class="city-label ${active ? "is-active" : ""}" x="${x.toFixed(2)}" y="${position.baseline.toFixed(2)}" text-anchor="middle" style="font-size:${fontSize.toFixed(2)}px;stroke-width:${(3 * toMap).toFixed(2)}px">${escapeHtml(city.city)}</text>`);
    };

    labelCandidates.slice(0, maxLabels).forEach((city) => addLabel(city));
    if (state.geo.city) {
      const selectedCity = cities.find((city) => city.city === state.geo.city && (!state.geo.uf || city.uf === state.geo.uf));
      if (selectedCity) addLabel(selectedCity, true);
    }

    el.brazilMap.setAttribute("viewBox", `${mapView.x} ${mapView.y} ${mapView.w} ${mapView.h}`);
    el.brazilMap.innerHTML = `
      <g class="states-group">${stateHtml}</g>
      <g class="bubbles-group">${bubbleHtml}</g>
      <g class="labels-group">${labelParts.join("")}</g>
    `;

    const teamSize = team.length;
    const bindState = (path) => {
      const uf = path.dataset.uf;
      const shape = STATE_BY_UF.get(uf);
      if (!shape) return;
      const data = stateData.get(uf) || { count: 0, cities: new Set() };
      const show = (event) => {
        el.mapTooltip.innerHTML = `
          <strong>${escapeHtml(shape.name)}</strong>
          <span class="tip-muted">${escapeHtml(shape.region)}</span>
          <div class="tip-row"><span>Colaboradores</span><b>${formatNumber(data.count)}</b></div>
          <div class="tip-row"><span>Cidades</span><b>${formatNumber(data.cities.size)}</b></div>
        `;
        moveTooltip(el.mapTooltip, event, el.mapCanvas);
      };
      path.addEventListener("pointerenter", show);
      path.addEventListener("pointermove", show);
      path.addEventListener("pointerleave", hideMapTooltip);
      path.addEventListener("click", () => {
        if (suppressMapClick) return;
        let next;
        if (state.geo.uf === uf) {
          next = state.geo.city ? { region: shape.region, uf } : { region: shape.region };
        } else {
          next = { region: shape.region, uf };
        }
        setGeoFor(next);
      });
      path.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const next = state.geo.uf === uf
          ? { region: shape.region }
          : { region: shape.region, uf };
        setGeoFor(next);
      });
    };

    $$(".state-path", el.brazilMap).forEach(bindState);

    $$(".city-bubble", el.brazilMap).forEach((bubble) => {
      const city = cities.find((item) => item.city === bubble.dataset.city && item.uf === bubble.dataset.uf);
      if (!city) return;
      const show = (event) => {
        el.mapTooltip.innerHTML = `
          <strong>${escapeHtml(city.city)}</strong>
          <span class="tip-muted">${escapeHtml(city.region)} · ${escapeHtml(city.uf)}</span>
          <div class="tip-row"><span>Colaboradores</span><b>${formatNumber(city.count)}</b></div>
          <div class="tip-row"><span>Do time</span><b>${formatPercent(city.count, teamSize)}</b></div>
        `;
        moveTooltip(el.mapTooltip, event, el.mapCanvas);
      };
      bubble.addEventListener("pointerenter", show);
      bubble.addEventListener("pointermove", show);
      bubble.addEventListener("pointerleave", hideMapTooltip);
      bubble.addEventListener("click", (event) => {
        event.stopPropagation();
        if (suppressMapClick) return;
        setGeoFor({ region: city.region, uf: city.uf, city: city.city });
      });
      bubble.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setGeoFor({ region: city.region, uf: city.uf, city: city.city });
      });
    });

    el.mapNote.textContent = total
      ? `${formatNumber(mapped)} de ${formatNumber(total)} com localização mapeada`
      : "Sem colaboradores no recorte";
    el.mapEmpty.hidden = mapped > 0;
    renderMapDrillSummary();
  };

  const moveTooltip = (tooltip, event, container) => {
    const rect = container.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 80, Math.max(80, rect.width - 80));
    const y = clamp(event.clientY - rect.top - 8, 58, Math.max(58, rect.height - 8));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.classList.add("visible");
  };

  const hideMapTooltip = () => {
    el.mapTooltip.classList.remove("visible");
  };

  const hideScatterTooltip = () => {
    el.scatterTooltip.classList.remove("visible");
  };

  const aggregateStates = (team) => {
    const map = new Map();
    for (const employee of team) {
      if (!employee.mapped) continue;
      if (!map.has(employee.uf)) {
        map.set(employee.uf, {
          uf: employee.uf,
          name: employee.state,
          region: employee.region,
          count: 0,
          cities: new Set(),
        });
      }
      const entry = map.get(employee.uf);
      entry.count += 1;
      entry.cities.add(employee.city);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.count - a.count || a.uf.localeCompare(b.uf, "pt-BR"),
    );
  };

  const renderScatter = () => {
    const rect = el.scatterCanvas.getBoundingClientRect();
    const width = Math.max(240, Math.floor(rect.width));
    const height = Math.max(140, Math.floor(rect.height));
    const states = aggregateStates(teamAfterLob());

    el.scatter.setAttribute("viewBox", `0 0 ${width} ${height}`);
    el.scatter.setAttribute("width", width);
    el.scatter.setAttribute("height", height);
    el.scatter.setAttribute("aria-label", "Dispersão de colaboradores por estado");

    const left = 34;
    const right = 12;
    const top = 14;
    const bottom = 30;
    const plotWidth = Math.max(30, width - left - right);
    const plotHeight = Math.max(30, height - top - bottom);
    const maxCount = states[0]?.count || 1;
    const logMax = maxCount > 1 ? Math.log10(maxCount) : 0;
    const yFor = (count) => {
      if (maxCount <= 1) return top + plotHeight;
      return top + plotHeight * (1 - Math.log10(Math.max(1, count)) / logMax);
    };
    const xFor = (index) => (states.length <= 1
      ? left + plotWidth / 2
      : left + (index / (states.length - 1)) * plotWidth);

    if (!states.length) {
      el.scatter.innerHTML = `<text class="chart-empty" x="${width / 2}" y="${height / 2}">Sem estados mapeados neste recorte</text>`;
      el.scatterLegend.innerHTML = "";
      el.scatterNote.textContent = "0 estados";
      return;
    }

    let ticks = [1, 3, 10, 30, 100, 300, 1000].filter((tick) => tick <= maxCount);
    if (!ticks.includes(1)) ticks.unshift(1);
    if (!ticks.includes(maxCount) && maxCount > 1) ticks.push(maxCount);
    ticks = Array.from(new Set(ticks)).sort((a, b) => a - b);

    let svg = `<g class="chart-grid">`;
    for (const tick of ticks) {
      const y = yFor(tick);
      svg += `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"></line>`;
    }
    svg += `</g><g class="chart-axis">`;
    for (const tick of ticks) {
      const y = yFor(tick);
      svg += `<text x="${left - 6}" y="${y + 3}" text-anchor="end">${formatNumber(tick)}</text>`;
    }
    states.forEach((item, index) => {
      svg += `<text class="axis-state" x="${xFor(index).toFixed(2)}" y="${height - 9}" text-anchor="middle">${escapeHtml(item.uf)}</text>`;
    });
    svg += `</g>`;

    const dotParts = [];
    const labelParts = [];
    const placedLabels = [];

    states.forEach((item, index) => {
      const x = xFor(index);
      const y = yFor(item.count);
      const radius = 2.8 + 5.2 * Math.sqrt(item.count / maxCount);
      const muted = hasGeo(state.geo) && !(
        state.geo.city
          ? item.uf === state.geo.uf
          : state.geo.uf
            ? item.uf === state.geo.uf
            : state.geo.region
              ? item.region === state.geo.region
              : true
      );
      const active = state.geo.uf === item.uf;
      const color = regionColor(item.region);
      dotParts.push(`<g class="scatter-dot ${muted ? "is-muted" : ""} ${active ? "is-active" : ""}" data-state="${escapeHtml(item.name)}" data-uf="${escapeHtml(item.uf)}" data-region="${escapeHtml(item.region)}" data-count="${item.count}" tabindex="0" role="button" aria-label="${escapeHtml(item.name)}: ${item.count} colaboradores">
        <circle class="scatter-hit" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${Math.max(radius + 5, 9).toFixed(2)}"></circle>
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${color}" fill-opacity="0.86"></circle>
      </g>`);
    });

    for (const item of states.slice(0, 3)) {
      if (item.count < 2) continue;
      const index = states.indexOf(item);
      const x = xFor(index);
      const y = yFor(item.count);
      const radius = 2.8 + 5.2 * Math.sqrt(item.count / maxCount);
      const text = `${item.name} · ${item.count}`;
      const textWidth = text.length * 4.8;
      const options = [
        { x: x + radius + 4, y: y - 4, w: textWidth, h: 10, baseline: y, anchor: "start" },
        { x: x - radius - 4, y: y - 4, w: textWidth, h: 10, baseline: y, anchor: "end" },
        { x: x - textWidth / 2, y: y - radius - 14, w: textWidth, h: 10, baseline: y - radius - 6, anchor: "middle" },
      ];
      let position = null;
      for (const option of options) {
        const collides = placedLabels.some((box) =>
          option.x < box.x + box.w &&
          option.x + option.w > box.x &&
          option.y < box.y + box.h &&
          option.y + option.h > box.y,
        );
        const inside = option.x >= 2 && option.x + option.w <= width - 2;
        if (!collides && inside) {
          position = option;
          break;
        }
      }
      if (!position) continue;
      placedLabels.push(position);
      labelParts.push(`<text class="scatter-label" x="${position.x.toFixed(2)}" y="${position.baseline.toFixed(2)}" text-anchor="${position.anchor}">${escapeHtml(text)}</text>`);
    }

    el.scatter.innerHTML = `${svg}<g class="scatter-dots">${dotParts.join("")}</g><g class="scatter-labels">${labelParts.join("")}</g>`;

    $$(".scatter-dot", el.scatter).forEach((dot) => {
      const item = states.find((entry) => entry.uf === dot.dataset.uf);
      if (!item) return;
      const show = (event) => {
        el.scatterTooltip.innerHTML = `
          <strong>${escapeHtml(item.name)}</strong>
          <span class="tip-muted">${escapeHtml(item.region)} · ${escapeHtml(item.uf)}</span>
          <div class="tip-row"><span>Colaboradores</span><b>${formatNumber(item.count)}</b></div>
          <div class="tip-row"><span>Cidades</span><b>${formatNumber(item.cities.size)}</b></div>
          <div class="tip-row"><span>Do time</span><b>${formatPercent(item.count, teamAfterLob().length)}</b></div>
        `;
        moveTooltip(el.scatterTooltip, event, el.scatterCanvas);
      };
      dot.addEventListener("pointerenter", show);
      dot.addEventListener("pointermove", show);
      dot.addEventListener("pointerleave", hideScatterTooltip);
      dot.addEventListener("click", () => setGeoFor({ region: item.region, uf: item.uf }));
      dot.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setGeoFor({ region: item.region, uf: item.uf });
      });
    });

    const regionsPresent = Array.from(new Set(states.map((item) => item.region)))
      .sort((a, b) => BR_REGIONS.indexOf(a) - BR_REGIONS.indexOf(b));
    el.scatterLegend.innerHTML = regionsPresent.map((region) =>
      `<span><i style="--c:${regionColor(region)}"></i>${escapeHtml(region)}</span>`,
    ).join("");
    el.scatterNote.textContent = `${formatNumber(states.length)} ${states.length === 1 ? "estado" : "estados"}`;
  };

  const renderCities = () => {
    const cities = aggregateCities(teamAfterLob());
    const top = cities.slice(0, 6);
    el.citiesHint.textContent = cities.length > 6
      ? `6 de ${formatNumber(cities.length)}`
      : `${formatNumber(cities.length)} ${cityWord(cities.length)}`;

    if (!top.length) {
      el.cityList.innerHTML = `<li class="city-empty">Sem cidades mapeadas neste recorte.</li>`;
      return;
    }

    const max = top[0].count;
    el.cityList.innerHTML = top.map((city, index) => {
      const active = state.geo.city === city.city && (!state.geo.uf || state.geo.uf === city.uf);
      return `<li class="city-item ${active ? "is-active" : ""}" data-city="${escapeHtml(city.city)}" data-uf="${escapeHtml(city.uf)}" data-region="${escapeHtml(city.region)}" tabindex="0">
        <span class="city-rank">${index + 1}</span>
        <div class="city-body">
          <div class="city-main"><strong>${escapeHtml(city.city)}</strong><small>${escapeHtml(city.uf)}</small></div>
          <div class="city-track"><i style="width:${Math.max(4, (city.count / max) * 100)}%;--c:${regionColor(city.region)}"></i></div>
        </div>
        <span class="city-count">${formatNumber(city.count)}</span>
      </li>`;
    }).join("");
  };

  const searchFiltered = () => {
    const query = normalize(state.search.trim());
    if (!query) return visibleTeam();
    return visibleTeam().filter((employee) => employee._search.includes(query));
  };

  const sortedPeople = () => {
    const list = searchFiltered().slice();
    list.sort((a, b) => {
      if (state.sort === "city") {
        const cityA = a.city || "zzzz";
        const cityB = b.city || "zzzz";
        return cityA.localeCompare(cityB, "pt-BR") || a.name.localeCompare(b.name, "pt-BR");
      }
      if (state.sort === "tenure") {
        const monthsA = a._tenure.months ?? -1;
        const monthsB = b._tenure.months ?? -1;
        return monthsB - monthsA || a.name.localeCompare(b.name, "pt-BR");
      }
      if (state.sort === "role") {
        return a.role.localeCompare(b.role, "pt-BR") || a.name.localeCompare(b.name, "pt-BR");
      }
      return a.name.localeCompare(b.name, "pt-BR");
    });
    return list;
  };

  const peopleTitle = () => {
    const geo = state.geo;
    if (geo.city) return `Pessoas em ${geo.city}`;
    if (geo.uf) return `Pessoas em ${STATE_BY_UF.get(geo.uf)?.name || geo.uf}`;
    if (geo.region === "Internacional") return "Pessoas · Exterior";
    if (geo.region === "Não informado") return "Pessoas · Sem localização";
    if (geo.region) return `Pessoas · ${geo.region}`;
    return "Pessoas do time";
  };

  const peopleSubtitle = () => {
    const manager = selectedManager();
    const parts = [];
    if (!manager) parts.push("Todos os colaboradores ativos");
    else if (state.scope === "direct") parts.push(`Liderados diretos de ${manager.name}`);
    else parts.push(`Time de ${manager.name}`);
    if (state.lob !== "all") {
      const label = teamAfterLob()[0]?.lobLabel;
      if (label) parts.push(label);
    }
    if (hasGeo(state.geo)) parts.push(geoLabelShort());
    if (state.search.trim()) parts.push(`busca por “${state.search.trim()}”`);
    return parts.join(" · ");
  };

  const renderPeople = () => {
    const list = sortedPeople();
    const shown = list.slice(0, state.pageSize);
    const empty = list.length === 0;

    el.peopleTitle.textContent = peopleTitle();
    el.peopleCount.textContent = formatNumber(list.length);
    el.peopleSub.textContent = peopleSubtitle();
    el.tableScroll.hidden = empty;
    el.emptyState.hidden = !empty;
    el.peopleBody.innerHTML = shown.map((employee) => {
      const color = regionColor(employee.region);
      const location = employee.mapped
        ? `${employee.city}, ${employee.uf}`
        : employee.region === "Internacional"
          ? `${employee.city}, ${employee.country}`
          : "Local não informado";
      const locationSub = employee.mapped
        ? employee.region
        : employee.region === "Internacional"
          ? "Internacional"
          : "Sem localização";
      return `<tr data-id="${escapeHtml(employee.id)}" tabindex="0">
        <td>
          <div class="person-cell">
            <span class="avatar" style="background:${avatarBackground(color)}">${escapeHtml(initials(employee.name))}</span>
            <div class="person-meta">
              <strong title="${escapeHtml(employee.name)}">${escapeHtml(employee.name)}</strong>
              <small title="${escapeHtml(employee.role)}">${escapeHtml(employee.role)}</small>
            </div>
          </div>
        </td>
        <td><span class="lob-pill" title="${escapeHtml(employee.lobLabel)}">${escapeHtml(employee.lobLabel)}</span></td>
        <td>
          <div class="loc-cell">
            <span class="region-dot" style="--c:${color}"></span>
            <div class="loc-meta">
              <strong title="${escapeHtml(location)}">${escapeHtml(location)}</strong>
              <small>${escapeHtml(locationSub)}</small>
            </div>
          </div>
        </td>
        <td><span class="tenure-cell">${escapeHtml(employee._tenure.label)}</span></td>
        <td><span class="manager-cell" title="${escapeHtml(employee.managerName || "—")}">${escapeHtml(employee.managerName || "—")}</span></td>
        <td><button type="button" class="row-action" aria-label="Ver detalhes de ${escapeHtml(employee.name)}"><svg><use href="#i-arrow-right"/></svg></button></td>
      </tr>`;
    }).join("");

    if (list.length > state.pageSize) {
      el.peopleFootNote.textContent = `Mostrando ${formatNumber(shown.length)} de ${formatNumber(list.length)}`;
      el.loadMore.hidden = false;
      el.loadMore.textContent = `Mostrar mais (${formatNumber(list.length - shown.length)})`;
    } else {
      el.peopleFootNote.textContent = list.length
        ? `${formatNumber(list.length)} ${personWord(list.length)}`
        : "";
      el.loadMore.hidden = true;
    }
  };

  const renderActiveFilters = () => {
    const chips = [];
    if (state.scope === "direct" && selectedManager()) {
      chips.push({ kind: "scope", label: "Escopo", value: "Direto" });
    }
    if (state.lob !== "all") {
      const label = teamAfterLob()[0]?.lobLabel || state.lob;
      chips.push({ kind: "lob", label: "Centro", value: label });
    }
    if (state.geo.region) {
      const value = state.geo.region === "Internacional"
        ? "Exterior"
        : state.geo.region === "Não informado"
          ? "Sem localização"
          : state.geo.region;
      chips.push({ kind: "region", label: "Região", value });
    }
    if (state.geo.uf) {
      chips.push({ kind: "uf", label: "UF", value: state.geo.uf });
    }
    if (state.geo.city) {
      chips.push({ kind: "city", label: "Cidade", value: state.geo.city });
    }
    if (state.search.trim()) {
      chips.push({ kind: "search", label: "Busca", value: state.search.trim() });
    }

    if (!chips.length) {
      el.activeFilters.innerHTML = `<span class="no-filters">Sem filtros adicionais · todo o time</span>`;
      return;
    }

    el.activeFilters.innerHTML = chips.map((chip) =>
      `<span class="filter-chip"><span>${escapeHtml(chip.label)}</span>${escapeHtml(chip.value)}<button type="button" data-clear="${chip.kind}" aria-label="Remover filtro ${escapeHtml(chip.label)}"><svg><use href="#i-x"/></svg></button></span>`,
    ).join("") + `<button type="button" class="filter-clear" data-clear="all">Limpar tudo</button>`;
  };

  const renderAll = () => {
    updateHeader();
    renderHero();
    updateScopeControls();
    renderKpis();
    renderRegionChips();
    renderBreadcrumb();
    renderMap();
    renderScatter();
    renderCities();
    renderActiveFilters();
    renderPeople();
  };

  const clampView = (view) => {
    let w = clamp(view.w, 85, BASE_VIEW.w);
    let h = w * (BASE_VIEW.h / BASE_VIEW.w);
    if (h > BASE_VIEW.h) {
      h = BASE_VIEW.h;
      w = h * (BASE_VIEW.w / BASE_VIEW.h);
    }
    const x = clamp(view.x, 0, BASE_VIEW.w - w);
    const y = clamp(view.y, 0, BASE_VIEW.h - h);
    return { x, y, w, h };
  };

  const fitBBox = (bbox, factor) => {
    const aspect = BASE_VIEW.w / BASE_VIEW.h;
    let w = Math.max(bbox.w, 1) * factor;
    let h = Math.max(bbox.h, 1) * factor;
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    const centerX = bbox.x + bbox.w / 2;
    const centerY = bbox.y + bbox.h / 2;
    return clampView({ x: centerX - w / 2, y: centerY - h / 2, w, h });
  };

  const viewForGeo = (geo) => {
    if (geo.city) {
      const employee = EMP.find((item) => item.city === geo.city && (!geo.uf || item.uf === geo.uf) && item.lat != null);
      if (employee) {
        const [x, y] = project(employee.lon, employee.lat);
        const w = 115;
        const h = w * (BASE_VIEW.h / BASE_VIEW.w);
        return clampView({ x: x - w / 2, y: y - h / 2, w, h });
      }
    }
    if (geo.uf && STATE_BY_UF.has(geo.uf)) {
      return fitBBox(STATE_BY_UF.get(geo.uf).bbox, 1.5);
    }
    if (geo.region && REGION_BBOX.has(geo.region)) {
      return fitBBox(REGION_BBOX.get(geo.region), 1.12);
    }
    return { ...BASE_VIEW };
  };

  const setViewBox = () => {
    el.brazilMap.setAttribute("viewBox", `${mapView.x} ${mapView.y} ${mapView.w} ${mapView.h}`);
  };

  const animateViewBox = (target, onEnd) => {
    cancelAnimationFrame(mapAnimation);
    const destination = clampView(target);
    if (REDUCED_MOTION) {
      mapView = destination;
      setViewBox();
      onEnd?.();
      return;
    }
    const origin = { ...mapView };
    const delta = Math.abs(origin.x - destination.x) +
      Math.abs(origin.y - destination.y) +
      Math.abs(origin.w - destination.w) +
      Math.abs(origin.h - destination.h);
    if (delta < 1) {
      mapView = destination;
      setViewBox();
      onEnd?.();
      return;
    }
    const start = performance.now();
    const duration = 540;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      mapView = {
        x: origin.x + (destination.x - origin.x) * eased,
        y: origin.y + (destination.y - origin.y) * eased,
        w: origin.w + (destination.w - origin.w) * eased,
        h: origin.h + (destination.h - origin.h) * eased,
      };
      setViewBox();
      if (progress < 1) {
        mapAnimation = requestAnimationFrame(step);
      } else {
        mapView = destination;
        setViewBox();
        onEnd?.();
      }
    };
    mapAnimation = requestAnimationFrame(step);
  };

  const resetMapView = () => {
    cancelAnimationFrame(mapAnimation);
    mapView = { ...BASE_VIEW };
    setViewBox();
  };

  const normalizeGeo = (geo) => {
    if (!geo) return emptyGeo();
    let region = geo.region || null;
    let uf = geo.uf || null;
    let city = geo.city || null;

    if (region === "Internacional" || region === "Não informado") {
      return { region, uf: null, city: null };
    }

    if (uf) {
      const shape = STATE_BY_UF.get(uf);
      if (shape) region = shape.region;
      else uf = null;
    }

    if (city) {
      const employee = EMP.find((item) => item.city === city && (!uf || item.uf === uf));
      if (employee) {
        city = employee.city;
        uf = employee.uf;
        if (employee.region !== "Internacional" && employee.region !== "Não informado") {
          region = employee.region;
        }
      } else {
        city = null;
      }
    }

    if (!region && uf) {
      region = STATE_BY_UF.get(uf)?.region || null;
    }

    return { region, uf, city };
  };

  const setGeoFor = (geo) => {
    state.geo = normalizeGeo(geo);
    state.pageSize = 8;
    hideMapTooltip();
    hideScatterTooltip();
    renderRegionChips();
    renderBreadcrumb();
    renderKpis();
    renderMap();
    renderScatter();
    renderCities();
    renderActiveFilters();
    renderPeople();
    animateViewBox(viewForGeo(state.geo), () => renderMap());
  };

  const setManager = (id) => {
    state.managerId = id === "all" || MANAGER_BY_ID.has(id) ? id : "all";
    state.scope = "full";
    state.lob = "all";
    state.geo = emptyGeo();
    state.search = "";
    state.pageSize = 8;
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    el.managerSelect.value = state.managerId;
    populateLobSelect();
    resetMapView();
    closeProfile();
    renderAll();
  };

  const setScope = (scope) => {
    if (!selectedManager()) return;
    state.scope = scope;
    state.geo = emptyGeo();
    state.search = "";
    state.pageSize = 8;
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    populateLobSelect();
    resetMapView();
    renderAll();
  };

  const setLob = (value) => {
    state.lob = value;
    state.geo = emptyGeo();
    state.search = "";
    state.pageSize = 8;
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    el.lobSelect.value = value;
    resetMapView();
    renderAll();
  };

  const resetFilters = () => {
    state.scope = "full";
    state.lob = "all";
    state.geo = emptyGeo();
    state.search = "";
    state.pageSize = 8;
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    populateLobSelect();
    resetMapView();
    renderAll();
  };

  const clearFilter = (kind) => {
    if (kind === "scope") {
      setScope("full");
      return;
    }
    if (kind === "lob") {
      setLob("all");
      return;
    }
    if (kind === "region") {
      setGeoFor(null);
      return;
    }
    if (kind === "uf") {
      setGeoFor({ region: state.geo.region });
      return;
    }
    if (kind === "city") {
      setGeoFor({ region: state.geo.region, uf: state.geo.uf });
      return;
    }
    if (kind === "search") {
      state.search = "";
      state.pageSize = 8;
      el.searchInput.value = "";
      el.searchClear.hidden = true;
      renderActiveFilters();
      renderPeople();
      return;
    }
    if (kind === "all") resetFilters();
  };

  const zoomBy = (factor) => {
    const centerX = mapView.x + mapView.w / 2;
    const centerY = mapView.y + mapView.h / 2;
    const w = clamp(mapView.w * factor, 85, BASE_VIEW.w);
    const h = w * (BASE_VIEW.h / BASE_VIEW.w);
    animateViewBox({ x: centerX - w / 2, y: centerY - h / 2, w, h }, () => renderMap());
  };

  const exportCsv = () => {
    const list = sortedPeople();
    if (!list.length) {
      showToast("Nenhum registro para exportar.", "#i-info");
      return;
    }
    const header = ["Nome", "Cargo", "Centro de responsabilidade", "Cidade", "UF", "Região", "País", "Gestor", "Admissão", "Tempo de casa", "E-mail"];
    const rows = list.map((employee) => [
      employee.name,
      employee.role,
      employee.lobLabel,
      employee.city || "",
      employee.uf || "",
      employee.region,
      employee.country || "",
      employee.managerName || "",
      formatDate(employee.hire),
      employee._tenure.label,
      employee.email || "",
    ]);
    const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = "\ufeff" + [header, ...rows].map((row) => row.map(quote).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const manager = selectedManager();
    const slug = (manager ? manager.name : "todos")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    link.href = url;
    link.download = `meu-time-${slug}-${DATA.meta.referenceDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${formatNumber(list.length)} registros exportados.`, "#i-check");
  };

  const copyEmail = async (email) => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = email;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast("E-mail copiado.", "#i-check");
  };

  const openDrawer = (employee) => {
    if (!employee) return;
    lastFocusedElement = document.activeElement;
    const color = regionColor(employee.region);
    const location = employee.mapped
      ? `${employee.city}, ${employee.uf}`
      : employee.region === "Internacional"
        ? `${employee.city}, ${employee.country}`
        : "Não informado";
    const locationSub = employee.mapped
      ? `${employee.state} · ${employee.region}`
      : employee.region === "Internacional"
        ? "Internacional"
        : "Localização não mapeada";

    el.drawerContent.innerHTML = `
      <div class="drawer-hero">
        <span class="avatar" style="background:${avatarBackground(color)}">${escapeHtml(initials(employee.name))}</span>
        <h2>${escapeHtml(employee.name)}</h2>
        <p>${escapeHtml(employee.role)}</p>
        <div class="drawer-tags">
          <span class="tag tag-soft">${escapeHtml(employee.lobLabel)}</span>
          <span class="tag">${escapeHtml(employee.region)}</span>
          <span class="tag">${escapeHtml(employee.company)}</span>
        </div>
      </div>
      <div class="drawer-grid">
        <div class="drawer-field wide">
          <label><svg><use href="#i-pin"/></svg>Localização</label>
          <strong>${escapeHtml(location)}</strong>
          <span>${escapeHtml(locationSub)}</span>
        </div>
        <div class="drawer-field">
          <label><svg><use href="#i-layers"/></svg>Centro de responsabilidade</label>
          <strong>${escapeHtml(employee.lobLabel)}</strong>
        </div>
        <div class="drawer-field">
          <label><svg><use href="#i-users"/></svg>Gestor</label>
          <strong>${escapeHtml(employee.managerName || "—")}</strong>
        </div>
        <div class="drawer-field">
          <label><svg><use href="#i-calendar"/></svg>Admissão</label>
          <strong>${escapeHtml(formatDate(employee.hire))}</strong>
        </div>
        <div class="drawer-field">
          <label><svg><use href="#i-briefcase"/></svg>Tempo de casa</label>
          <strong>${escapeHtml(employee._tenure.label)}</strong>
        </div>
        <div class="drawer-field wide">
          <label><svg><use href="#i-mail"/></svg>E-mail</label>
          <span>${escapeHtml(employee.email || "Não informado")}</span>
        </div>
      </div>
      <div class="drawer-actions">
        ${employee.mapped ? `<button type="button" class="btn" id="drawerMap"><svg><use href="#i-pin"/></svg>Ver no mapa</button>` : ""}
        ${employee.email ? `<button type="button" class="btn btn-ghost" id="drawerCopy"><svg><use href="#i-copy"/></svg>Copiar e-mail</button>` : ""}
      </div>
      <p style="margin:16px 0 0;color:var(--muted);font-size:9px">Dados do snapshot de ${escapeHtml(DATA.meta.snapshot)}.</p>
    `;

    el.drawer.hidden = false;
    el.drawerBackdrop.hidden = false;
    requestAnimationFrame(() => {
      el.drawer.classList.add("open");
      el.drawerBackdrop.classList.add("open");
    });
    document.body.classList.add("no-scroll");
    el.drawerClose.focus({ preventScroll: true });

    $("#drawerMap")?.addEventListener("click", () => {
      closeDrawer();
      setGeoFor({ region: employee.region, uf: employee.uf, city: employee.city });
      $("#mapa").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
    });
    $("#drawerCopy")?.addEventListener("click", () => copyEmail(employee.email));
  };

  const closeDrawer = () => {
    el.drawer.classList.remove("open");
    el.drawerBackdrop.classList.remove("open");
    document.body.classList.remove("no-scroll");
    clearTimeout(drawerCloseTimer);
    drawerCloseTimer = setTimeout(() => {
      el.drawer.hidden = true;
      el.drawerBackdrop.hidden = true;
    }, 300);
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus({ preventScroll: true });
    }
  };

  const openProfile = () => {
    el.profilePopover.hidden = false;
    el.profileBtn.setAttribute("aria-expanded", "true");
  };

  const closeProfile = () => {
    el.profilePopover.hidden = true;
    el.profileBtn.setAttribute("aria-expanded", "false");
  };

  const openSidebar = () => {
    el.sidebar.classList.add("open");
    el.sidebarOverlay.hidden = false;
    document.body.classList.add("no-scroll");
  };

  const closeSidebar = () => {
    el.sidebar.classList.remove("open");
    el.sidebarOverlay.hidden = true;
    document.body.classList.remove("no-scroll");
  };

  const bindEvents = () => {
    el.themeBtn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      setTheme(next);
    });

    el.menuBtn.addEventListener("click", openSidebar);
    el.sidebarOverlay.addEventListener("click", closeSidebar);
    $$(".nav-item", el.sidebar).forEach((item) => item.addEventListener("click", () => {
      if (window.innerWidth <= 1024) closeSidebar();
    }));

    el.profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (el.profilePopover.hidden) openProfile();
      else closeProfile();
    });
    el.profilePopover.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", () => closeProfile());
    el.popoverChange.addEventListener("click", () => {
      closeProfile();
      $(".filters").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
      setTimeout(() => el.managerSelect.focus({ preventScroll: true }), 300);
    });

    el.managerSelect.addEventListener("change", () => setManager(el.managerSelect.value));
    el.lobSelect.addEventListener("change", () => setLob(el.lobSelect.value));
    $$(".segmented button", el.scopeField).forEach((button) => {
      button.addEventListener("click", () => setScope(button.dataset.scope));
    });
    el.resetBtn.addEventListener("click", resetFilters);

    el.regionChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-region]");
      if (!button || button.disabled) return;
      const region = button.dataset.region;
      if (state.geo.region === region && !state.geo.uf && !state.geo.city) {
        setGeoFor(null);
      } else {
        setGeoFor({ region });
      }
    });

    el.mapMeta.addEventListener("click", (event) => {
      const button = event.target.closest("[data-special]");
      if (!button) return;
      const region = button.dataset.special;
      if (state.geo.region === region) setGeoFor(null);
      else setGeoFor({ region });
    });

    el.zoomIn.addEventListener("click", () => zoomBy(0.7));
    el.zoomOut.addEventListener("click", () => zoomBy(1.42));
    el.zoomReset.addEventListener("click", () => {
      if (hasGeo(state.geo)) setGeoFor(null);
      else animateViewBox(BASE_VIEW, () => renderMap());
    });

    el.mapSeePeople.addEventListener("click", () => {
      $("#pessoas").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
    });

    el.brazilMap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (mapView.w >= BASE_VIEW.w - 1) return;
      mapDragging = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        view: { ...mapView },
        moved: false,
      };
      el.brazilMap.setPointerCapture(event.pointerId);
      el.brazilMap.classList.add("is-panning");
      hideMapTooltip();
    });

    el.brazilMap.addEventListener("pointermove", (event) => {
      if (!mapDragging) return;
      const dx = event.clientX - mapDragging.startX;
      const dy = event.clientY - mapDragging.startY;
      if (!mapDragging.moved && Math.hypot(dx, dy) < 4) return;
      mapDragging.moved = true;
      const rect = el.brazilMap.getBoundingClientRect();
      const scale = Math.max(mapDragging.view.w / rect.width, mapDragging.view.h / rect.height);
      const x = clamp(mapDragging.view.x - dx * scale, 0, BASE_VIEW.w - mapView.w);
      const y = clamp(mapDragging.view.y - dy * scale, 0, BASE_VIEW.h - mapView.h);
      mapView = { ...mapView, x, y };
      setViewBox();
    });

    const endDrag = (event) => {
      if (!mapDragging) return;
      const moved = mapDragging.moved;
      if (el.brazilMap.hasPointerCapture(event.pointerId)) {
        el.brazilMap.releasePointerCapture(event.pointerId);
      }
      mapDragging = null;
      el.brazilMap.classList.remove("is-panning");
      if (moved) {
        suppressMapClick = true;
        setTimeout(() => {
          suppressMapClick = false;
        }, 220);
        renderMap();
      }
    };
    el.brazilMap.addEventListener("pointerup", endDrag);
    el.brazilMap.addEventListener("pointercancel", endDrag);

    el.cityList.addEventListener("click", (event) => {
      const item = event.target.closest("[data-city]");
      if (!item) return;
      setGeoFor({ region: item.dataset.region, uf: item.dataset.uf, city: item.dataset.city });
    });
    el.cityList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = event.target.closest("[data-city]");
      if (!item) return;
      event.preventDefault();
      setGeoFor({ region: item.dataset.region, uf: item.dataset.uf, city: item.dataset.city });
    });

    el.activeFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clear]");
      if (!button) return;
      clearFilter(button.dataset.clear);
    });

    el.searchInput.addEventListener("input", () => {
      const value = el.searchInput.value;
      el.searchClear.hidden = !value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = value.trim();
        state.pageSize = 8;
        renderActiveFilters();
        renderPeople();
      }, 130);
    });
    el.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        clearTimeout(searchTimer);
        state.search = el.searchInput.value.trim();
        state.pageSize = 8;
        renderActiveFilters();
        renderPeople();
      }
    });
    el.searchClear.addEventListener("click", () => {
      el.searchInput.value = "";
      el.searchClear.hidden = true;
      state.search = "";
      state.pageSize = 8;
      el.searchInput.focus();
      renderActiveFilters();
      renderPeople();
    });

    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      state.pageSize = 8;
      renderPeople();
    });

    el.loadMore.addEventListener("click", () => {
      state.pageSize += 8;
      renderPeople();
    });

    el.exportBtn.addEventListener("click", exportCsv);
    el.emptyReset.addEventListener("click", resetFilters);

    el.peopleBody.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      openDrawer(BY_ID.get(row.dataset.id));
    });
    el.peopleBody.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      event.preventDefault();
      openDrawer(BY_ID.get(row.dataset.id));
    });

    el.drawerClose.addEventListener("click", closeDrawer);
    el.drawerBackdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeDrawer();
        closeProfile();
        closeSidebar();
      }
    });
  };

  const observeResize = () => {
    const update = debounce(() => {
      renderMap();
      renderScatter();
    }, 120);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(update);
      observer.observe(el.mapCanvas);
      observer.observe(el.scatterCanvas);
    } else {
      window.addEventListener("resize", update);
    }
  };

  const init = () => {
    setTheme(initialTheme, false);
    el.snapshotLabel.textContent = DATA.meta.snapshot;
    el.footerSnapshot.textContent = DATA.meta.snapshot;
    el.footerNote.textContent = `${formatNumber(DATA.meta.total)} colaboradores ativos · ${formatNumber(DATA.meta.excludedAdmin)} contas administrativas e ${formatNumber(DATA.meta.inactive)} desligado${DATA.meta.inactive === 1 ? "" : "s"} excluído${DATA.meta.inactive === 1 ? "" : "s"}.`;
    el.sortSelect.value = state.sort;
    bindEvents();
    populateManagerSelect();
    populateLobSelect();
    resetMapView();
    renderAll();
    observeResize();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        renderMap();
        renderScatter();
      });
    }
  };

  init();
})();
