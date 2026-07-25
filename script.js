const formatCurrencyExact = d3.format("$,.0f");
const formatFuelPrice = d3.format("$.2f");
const formatPercent = d3.format(".1%");

function formatCompactCurrency(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return "$" + (value / 1e3).toFixed(0) + "K";
  return "$" + value.toFixed(0);
}

// Walmart brand palette. One accent = baseline value, one highlight = the point
// worth noticing. This mapping stays fixed across every chart: yellow always
// means "holiday week" or "the store to look at" — never a decorative choice.
const COLORS = {
  accent: "#0071CE",   // True Blue
  highlight: "#FFC220", // Spark Yellow
  neutral: "#94a3b8",
  selected: "#001E60"  // Bentonville Blue — the store the dashboard is drilled into
};

function holidayLabel(flag) {
  return flag === 1 ? "Holiday Week" : "Non-Holiday Week";
}

function holidayColor(flag) {
  return flag === 1 ? COLORS.highlight : COLORS.accent;
}

const parseDate = d3.timeParse("%d-%m-%Y");

const state = {
  store: "All",
  holiday: "All",
  year: "All",
  // Bar-chart-only store filter (the global Store dropdown deliberately does not
  // apply to the bar chart). barMode = "exclude" | "include"; barStores = the set
  // of store numbers chosen. Empty set = no constraint = show all 45 bars.
  barMode: "exclude",
  barStores: new Set()
};

// Module-level handle to the parsed rows, so the bar-chart store controls can
// redraw just the bar chart without threading `data` through every callback.
let DATA = null;

const tooltip = d3.select("#tooltip");

d3.csv("Walmart.csv").then(raw => {
  const data = raw.map(d => ({
    store: +d.Store,
    date: parseDate(d.Date),
    weeklySales: +d.Weekly_Sales,
    holiday: +d.Holiday_Flag,
    temperature: +d.Temperature,
    fuelPrice: +d.Fuel_Price,
    cpi: +d.CPI,
    unemployment: +d.Unemployment
  }));

  DATA = data;
  buildFilters(data);
  buildBarStoreControls(data);
  updateDashboard(data);

  d3.select("#storeFilter").on("change", event => {
    state.store = event.target.value;
    updateDashboard(data);
  });

  d3.select("#holidayFilter").on("change", event => {
    state.holiday = event.target.value;
    updateDashboard(data);
  });

  d3.select("#yearFilter").on("change", event => {
    state.year = event.target.value;
    updateDashboard(data);
  });

  d3.select("#resetBtn").on("click", () => {
    state.store = "All";
    state.holiday = "All";
    state.year = "All";
    state.barMode = "exclude";
    state.barStores.clear();
    d3.select("#storeFilter").property("value", "All");
    d3.select("#holidayFilter").property("value", "All");
    d3.select("#yearFilter").property("value", "All");
    d3.select("#storeSearch").property("value", "");
    hideSuggestions();
    refreshBarStoreControls();
    updateDashboard(data);
  });
});

// All store numbers (1..45), sorted — the universe the typeahead draws from.
let ALL_STORES = [];
let suggestIndex = -1; // highlighted row in the suggestion overlay

// Build the Include/Exclude store controls for the bar chart: a mode toggle and a
// compact typeahead. Type a store number → matching stores show as suggestions →
// click/Enter adds it as a removable token. Only the chosen stores are ever shown.
function buildBarStoreControls(data) {
  ALL_STORES = Array.from(new Set(data.map(d => d.store))).sort((a, b) => a - b);

  d3.selectAll("#barModeToggle button").on("click", function () {
    state.barMode = this.dataset.mode;
    refreshBarStoreControls();
    drawBarChart(getBarData(DATA), DATA);
  });

  d3.select("#clearStoreSel").on("click", () => {
    state.barStores.clear();
    d3.select("#storeSearch").property("value", "");
    hideSuggestions();
    refreshBarStoreControls();
    drawBarChart(getBarData(DATA), DATA);
  });

  const search = d3.select("#storeSearch");
  search.on("input", renderSuggestions);
  search.on("focus", renderSuggestions);
  search.on("keydown", handleSearchKey);
  // Delay so a click on a suggestion registers before the overlay hides.
  search.on("blur", () => setTimeout(hideSuggestions, 150));

  refreshBarStoreControls();
}

function addStore(n) {
  if (!ALL_STORES.includes(n) || state.barStores.has(n)) return;
  state.barStores.add(n);
  d3.select("#storeSearch").property("value", "");
  hideSuggestions();
  refreshBarStoreControls();
  drawBarChart(getBarData(DATA), DATA);
  d3.select("#storeSearch").node().focus();
}

function removeStore(n) {
  state.barStores.delete(n);
  refreshBarStoreControls();
  drawBarChart(getBarData(DATA), DATA);
}

// Stores matching the current query (prefix match on the number) that aren't
// already selected. "1" → 1, 10–19; "2" → 2, 20–29.
function matchingStores() {
  const q = d3.select("#storeSearch").property("value").trim();
  return ALL_STORES.filter(s =>
    !state.barStores.has(s) && (q === "" || String(s).startsWith(q))
  );
}

function renderSuggestions() {
  const matches = matchingStores().slice(0, 8);
  const box = d3.select("#storeSuggest");
  if (matches.length === 0) { hideSuggestions(); return; }
  suggestIndex = 0;
  box.attr("hidden", null)
    .selectAll("button")
    .data(matches)
    .join("button")
    .attr("type", "button")
    .classed("active", (d, i) => i === suggestIndex)
    .text(d => `Store ${d}`)
    .on("mousedown", (event, d) => { event.preventDefault(); addStore(d); });
}

function hideSuggestions() {
  suggestIndex = -1;
  d3.select("#storeSuggest").attr("hidden", true).selectAll("button").remove();
}

function handleSearchKey(event) {
  const matches = matchingStores().slice(0, 8);
  if (event.key === "Enter") {
    event.preventDefault();
    const typed = event.target.value.trim();
    const exact = ALL_STORES.find(s => String(s) === typed);
    if (suggestIndex >= 0 && matches[suggestIndex]) addStore(matches[suggestIndex]);
    else if (exact !== undefined) addStore(exact);
  } else if (event.key === "Backspace" && event.target.value === "") {
    const chosen = [...state.barStores].sort((a, b) => a - b);
    if (chosen.length) removeStore(chosen[chosen.length - 1]);
  } else if (event.key === "Escape") {
    hideSuggestions();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (matches.length === 0) return;
    const dir = event.key === "ArrowDown" ? 1 : -1;
    suggestIndex = (suggestIndex + dir + matches.length) % matches.length;
    d3.select("#storeSuggest").selectAll("button").classed("active", (d, i) => i === suggestIndex);
  }
}

// Render the selected-store tokens (before the input) and sync mode button +
// hint text with the current barMode / barStores.
function refreshBarStoreControls() {
  d3.selectAll("#barModeToggle button")
    .classed("active", function () { return this.dataset.mode === state.barMode; });

  renderTokens();

  const n = state.barStores.size;
  let hint;
  if (n === 0) hint = "Showing all 45 stores.";
  else if (state.barMode === "exclude") hint = `Hiding ${n} selected store${n > 1 ? "s" : ""}.`;
  else hint = `Showing only ${n} selected store${n > 1 ? "s" : ""}.`;
  d3.select("#storeSelHint").text(hint);
}

// Tokens sit inside the input field, before the search box. Color mirrors the
// mode: blue in Include ("shown"), orange in Exclude ("hidden").
function renderTokens() {
  const chosen = [...state.barStores].sort((a, b) => a - b);
  const field = d3.select("#storeTokenField");
  const input = field.select("#storeSearch");

  const tokens = field.selectAll("span.token").data(chosen, d => d);
  tokens.exit().remove();
  const entered = tokens.enter().insert("span", "#storeSearch").attr("class", "token");
  entered.append("span").attr("class", "token-label");
  entered.append("span").attr("class", "x").attr("aria-hidden", "true").text("×");

  const merged = entered.merge(tokens);
  merged.classed("exclude", state.barMode === "exclude");
  merged.select(".token-label").text(d => `Store ${d}`);
  merged.select(".x").on("click", (event, d) => removeStore(d));
  // Keep DOM order: tokens first (ascending), input last.
  merged.order();
  input.raise();

  input.attr("placeholder", chosen.length ? "" : "Type a store number…");
}

// True if a store should appear as a bar, given the Include/Exclude selection.
function storeVisible(store) {
  if (state.barStores.size === 0) return true;
  return state.barMode === "include"
    ? state.barStores.has(store)
    : !state.barStores.has(store);
}

function buildFilters(data) {
  const stores = Array.from(new Set(data.map(d => d.store))).sort((a, b) => a - b);
  const years = Array.from(new Set(data.map(d => d.date.getFullYear()))).sort();

  fillSelect("#storeFilter", [
    { value: "All", label: "All Stores" },
    ...stores.map(s => ({ value: String(s), label: `Store ${s}` }))
  ]);

  fillSelect("#holidayFilter", [
    { value: "All", label: "All Weeks" },
    { value: "1", label: "Holiday Weeks" },
    { value: "0", label: "Non-Holiday Weeks" }
  ]);

  fillSelect("#yearFilter", [
    { value: "All", label: "All Years" },
    ...years.map(y => ({ value: String(y), label: String(y) }))
  ]);
}

function fillSelect(selector, items) {
  d3.select(selector)
    .selectAll("option")
    .data(items)
    .join("option")
    .attr("value", d => d.value)
    .text(d => d.label);
}

// Full filter set — drives the KPIs, line, donut, and scatter charts.
function getFilteredData(data) {
  return data.filter(d => {
    const storeOk = state.store === "All" || d.store === +state.store;
    const holidayOk = state.holiday === "All" || String(d.holiday) === state.holiday;
    const yearOk = state.year === "All" || d.date.getFullYear().toString() === state.year;
    return storeOk && holidayOk && yearOk;
  });
}

// Bar chart deliberately ignores the Store filter: its job is comparing
// all 45 stores against each other, and it is itself the control that
// sets the Store filter (via click), so it can never filter itself down
// to a single bar.
function getBarData(data) {
  return data.filter(d => {
    const holidayOk = state.holiday === "All" || String(d.holiday) === state.holiday;
    const yearOk = state.year === "All" || d.date.getFullYear().toString() === state.year;
    return holidayOk && yearOk;
  });
}

function updateDashboard(data) {
  const filtered = getFilteredData(data);
  const barData = getBarData(data);
  updateScopeLine();
  updateFilterBadges();
  updateKPIs(filtered);
  drawLineChart(filtered);
  drawBarChart(barData, data);
  drawDonutChart(filtered, data);
  drawScatterChart(filtered);
}

// Short phrase naming the store currently in scope — reused across subtitles.
function storeScopeText() {
  return state.store === "All" ? "all 45 stores" : `Store ${state.store}`;
}

// The "Viewing: …" summary that keeps the active store/year/week-type visible,
// so a single-store view never leaves the user guessing what they're looking at.
function updateScopeLine() {
  const store = state.store === "All" ? "All 45 stores" : `Store ${state.store}`;
  const year = state.year === "All" ? "All years" : state.year;
  const wk = state.holiday === "All" ? "All weeks"
    : state.holiday === "1" ? "Holiday weeks" : "Non-holiday weeks";
  d3.select("#scopeLine").html(`Viewing: <strong>${store}</strong> · ${year} · ${wk}`);
}

// Active filters affecting a chart, as {type, label} items (empty when nothing
// is set). type maps to the dropdown/state clearFilter needs to reset.
function activeFilterItems(includeStore) {
  const items = [];
  if (includeStore && state.store !== "All") items.push({ type: "store", label: `Store ${state.store}` });
  if (state.holiday !== "All") items.push({ type: "holiday", label: state.holiday === "1" ? "Holiday weeks" : "Non-holiday weeks" });
  if (state.year !== "All") items.push({ type: "year", label: state.year });
  return items;
}

// Resets a single filter back to "All", syncs its dropdown, and redraws —
// the same effect as changing that dropdown back to "All" manually.
function clearFilter(type) {
  if (type === "store") { state.store = "All"; d3.select("#storeFilter").property("value", "All"); }
  else if (type === "holiday") { state.holiday = "All"; d3.select("#holidayFilter").property("value", "All"); }
  else if (type === "year") { state.year = "All"; d3.select("#yearFilter").property("value", "All"); }
  updateDashboard(DATA);
}

// Renders the filter badge as a row of removable chips — one per active filter —
// so a filter can be cleared right at the chart instead of scrolling back to the
// top filter bar. Hidden entirely when nothing is active.
function renderFilterBadge(selector, items) {
  const el = d3.select(selector);
  if (items.length === 0) { el.style("display", "none").html(""); return; }
  el.style("display", "inline-flex").html("");
  el.append("span").attr("class", "badge-label").text("Filters:");
  const chips = el.selectAll("span.badge-chip").data(items).join("span").attr("class", "badge-chip");
  chips.append("span").text(d => d.label);
  chips.append("span").attr("class", "badge-x").attr("aria-hidden", "true").text("×")
    .on("click", (event, d) => clearFilter(d.type));
}

// Each chart carries a badge of the filters affecting it, so the active scope is
// obvious even when a chart is scrolled away from the top filter bar. The bar
// chart ignores the Store dropdown, so its badge omits Store.
function updateFilterBadges() {
  const globalItems = activeFilterItems(true);
  renderFilterBadge("#lineFilterBadge", globalItems);
  renderFilterBadge("#donutFilterBadge", globalItems);
  renderFilterBadge("#scatterFilterBadge", globalItems);
  renderFilterBadge("#barFilterBadge", activeFilterItems(false));
}

function updateKPIs(data) {
  const totalSales = d3.sum(data, d => d.weeklySales);
  // Weekly run-rate = total ÷ distinct calendar weeks in view. This is the
  // average HEIGHT of the line chart below, so the KPI and that chart agree —
  // unlike a per-store-week mean, which is a different (and easily misread) number.
  const weekCount = new Set(data.map(d => d.date.getTime())).size;
  const avgPerWeek = weekCount > 0 ? totalSales / weekCount : 0;
  const storesInView = new Set(data.map(d => d.store)).size;
  const holidaySales = d3.sum(data.filter(d => d.holiday === 1), d => d.weeklySales);
  const holidayShare = totalSales > 0 ? holidaySales / totalSales : 0;

  d3.select("#kpiSales").text(formatCompactCurrency(totalSales));
  d3.select("#kpiAvg").text(formatCompactCurrency(avgPerWeek));
  d3.select("#kpiStores").text(storesInView);
  d3.select("#kpiHolidayShare").text(formatPercent(holidayShare));
}

// Task 1: Sales Trend Line Chart
function drawLineChart(data) {
  const svg = d3.select("#lineChart");
  svg.selectAll("*").remove();

  const { width, height } = getSvgSize(svg);
  const margin = { top: 24, right: 30, bottom: 40, left: 85 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  d3.select("#lineSubtitle").text(`${storeScopeText()} — total sales each week.`);

  const weekly = Array.from(
    d3.rollup(data, v => d3.sum(v, d => d.weeklySales), d => d.date.getTime()),
    ([time, sales]) => ({ date: new Date(time), sales })
  ).sort((a, b) => a.date - b.date);

  if (weekly.length === 0) {
    d3.select("#lineTitle").text("Weekly Sales Trend — No Data for Current Filters");
    return;
  }

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime().domain(d3.extent(weekly, d => d.date)).range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(weekly, d => d.sales) || 1]).nice().range([innerHeight, 0]);

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat("%b %Y")));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(formatCompactCurrency));

  const line = d3.line().x(d => x(d.date)).y(d => y(d.sales)).curve(d3.curveMonotoneX);
  g.append("path").datum(weekly).attr("fill", "none").attr("stroke", COLORS.accent).attr("stroke-width", 2.5).attr("d", line);

  g.selectAll("circle.point").data(weekly).join("circle")
    .attr("class", "point")
    .attr("cx", d => x(d.date))
    .attr("cy", d => y(d.sales))
    .attr("r", 3)
    .attr("fill", COLORS.accent)
    .on("mousemove", (event, d) => showTooltip(event,
      `<b>${d3.timeFormat("%b %d, %Y")(d.date)}</b><br>Weekly Sales: ${formatCurrencyExact(d.sales)}`))
    .on("mouseleave", hideTooltip);

  const peak = weekly.reduce((a, b) => (b.sales > a.sales ? b : a));
  g.append("circle")
    .attr("cx", x(peak.date))
    .attr("cy", y(peak.sales))
    .attr("r", 6)
    .attr("fill", COLORS.highlight)
    .attr("stroke", COLORS.selected)
    .attr("stroke-width", 2);

  const peakX = Math.min(Math.max(x(peak.date), 60), innerWidth - 60);
  const peakAbove = y(peak.sales) > 28;
  g.append("text")
    .attr("class", "annotation highlight")
    .attr("x", peakX)
    .attr("y", peakAbove ? y(peak.sales) - 14 : y(peak.sales) + 22)
    .attr("text-anchor", "middle")
    .text(`Peak: ${formatCompactCurrency(peak.sales)} (${d3.timeFormat("%b %Y")(peak.date)})`);

  d3.select("#lineTitle").text(
    `Weekly Sales Peaked at ${formatCompactCurrency(peak.sales)} in ${d3.timeFormat("%B %Y")(peak.date)}`
  );
}

// Task 2: Store-wise Sales Bar Chart
function drawBarChart(barData, allData) {
  const svg = d3.select("#barChart");
  svg.selectAll("*").remove();

  const { width, height } = getSvgSize(svg);
  const margin = { top: 10, right: 55, bottom: 40, left: 95 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const storeTotals = Array.from(
    d3.rollup(barData, v => d3.sum(v, d => d.weeklySales), d => d.store),
    ([store, sales]) => ({ store, sales })
  )
    .filter(d => storeVisible(d.store))
    .sort((a, b) => b.sales - a.sales);

  const totalStores = new Set(barData.map(d => d.store)).size;
  const yrs = d3.extent(barData, d => d.date.getFullYear());
  const periodText = yrs[0] == null ? "the selected period"
    : yrs[0] === yrs[1] ? `${yrs[0]}` : `${yrs[0]}–${yrs[1]}`;
  const weekTypeText = state.holiday === "All" ? "all weeks"
    : state.holiday === "1" ? "holiday weeks only" : "non-holiday weeks only";
  d3.select("#barSubtitle").text(
    `Total sales per store, summed over ${periodText} (${weekTypeText}). ` +
    `${storeTotals.length} of ${totalStores} stores, ranked — ` +
    (state.store === "All"
      ? "click a bar to filter the rest of the dashboard."
      : `Store ${state.store} is highlighted. Click any bar to change.`)
  );

  if (storeTotals.length === 0) {
    d3.select("#barTitle").text("Total Sales by Store — No Stores Selected");
    return;
  }

  const topStore = storeTotals[0].store;
  const selectedStore = state.store !== "All" ? +state.store : null;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, storeTotals[0].sales]).nice().range([0, innerWidth]);
  const y = d3.scaleBand().domain(storeTotals.map(d => d.store)).range([0, innerHeight]).padding(0.22);

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickFormat(d => `Store ${d}`))
    .selectAll("text").style("font-size", "9.5px");
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(formatCompactCurrency));

  g.selectAll("rect").data(storeTotals).join("rect")
    .attr("y", d => y(d.store))
    .attr("height", y.bandwidth())
    .attr("x", 0)
    .attr("width", d => x(d.sales))
    .attr("rx", 3)
    // Three distinct fills, in priority order: selected store (the one the rest
    // of the dashboard is drilled into) wins with a solid accent-blue fill so it
    // is unmistakable; otherwise the top performer is orange; everything else is
    // neutral gray. Selection is a full color change, not a thin outline.
    .attr("fill", d => {
      if (selectedStore === d.store) return COLORS.selected;
      if (d.store === topStore) return COLORS.highlight;
      return COLORS.neutral;
    })
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      state.store = selectedStore === d.store ? "All" : String(d.store);
      d3.select("#storeFilter").property("value", state.store);
      updateDashboard(allData);
    })
    .on("mousemove", (event, d) => {
      const rank = storeTotals.findIndex(s => s.store === d.store) + 1;
      showTooltip(event,
        `<b>Store ${d.store}</b><br>Total Sales: ${formatCurrencyExact(d.sales)}<br>Rank: #${rank} of ${storeTotals.length}<br>Click to filter`);
    })
    .on("mouseleave", hideTooltip);

  d3.select("#barTitle").text(
    `Store ${topStore} Leads With ${formatCompactCurrency(storeTotals[0].sales)} in Total Sales`
  );
}

// Task 3: Holiday vs Non-Holiday Sales Donut Chart
function drawDonutChart(data, allData) {
  const svg = d3.select("#donutChart");
  svg.selectAll("*").remove();

  const { width, height } = getSvgSize(svg);
  const radius = Math.min(width, height) / 2 - 46;
  const g = svg.append("g").attr("transform", `translate(${width / 2},${height / 2})`);

  const grouped = Array.from(
    d3.rollup(
      data,
      v => ({ sales: d3.sum(v, d => d.weeklySales), weeks: new Set(v.map(d => d.date.getTime())).size }),
      d => d.holiday
    ),
    ([flag, vals]) => ({ flag, ...vals, avgPerWeek: vals.sales / vals.weeks })
  ).sort((a, b) => a.flag - b.flag);

  if (grouped.length === 0) return;

  const totalSales = d3.sum(grouped, d => d.sales);
  const pie = d3.pie().value(d => d.sales).sort(null);
  const arc = d3.arc().innerRadius(radius * 0.62).outerRadius(radius);
  const labelArc = d3.arc().innerRadius(radius * 0.82).outerRadius(radius * 0.82);

  g.selectAll("path").data(pie(grouped)).join("path")
    .attr("d", arc)
    .attr("fill", d => holidayColor(d.data.flag))
    .attr("stroke", "white")
    .attr("stroke-width", 2)
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      const flagStr = String(d.data.flag);
      state.holiday = state.holiday === flagStr ? "All" : flagStr;
      d3.select("#holidayFilter").property("value", state.holiday);
      updateDashboard(allData);
    })
    .on("mousemove", (event, d) => showTooltip(event,
      `<b>${holidayLabel(d.data.flag)}</b><br>Total Sales: ${formatCurrencyExact(d.data.sales)}<br>Share: ${formatPercent(d.data.sales / totalSales)}<br>Avg per week: ${formatCurrencyExact(d.data.avgPerWeek)}`))
    .on("mouseleave", hideTooltip);

  g.selectAll("text.slice-label").data(pie(grouped)).join("text")
    .attr("class", "slice-label")
    .attr("transform", d => `translate(${labelArc.centroid(d)})`)
    .attr("text-anchor", "middle")
    // White reads fine on the blue slice, but is unreadable on Spark Yellow —
    // the holiday slice gets dark navy text instead.
    .attr("fill", d => (d.data.flag === 1 ? "#041E42" : "white"))
    .attr("font-size", 12)
    .attr("font-weight", "bold")
    .text(d => formatPercent(d.data.sales / totalSales));

  g.append("text").attr("text-anchor", "middle").attr("dy", "-0.1em")
    .attr("font-size", 20).attr("font-weight", "bold")
    .text(formatCompactCurrency(totalSales));
  g.append("text").attr("text-anchor", "middle").attr("dy", "1.3em")
    .attr("font-size", 12).attr("fill", "#6b7280")
    .text("Total sales");

  addLegend(svg, 16, 16, grouped.map(d => ({ label: holidayLabel(d.flag), color: holidayColor(d.flag) })));

  // The donut above compares TOTALS, which isn't like-to-like: holiday weeks are
  // far rarer (≈10 vs ≈133 per store), so the split mostly reflects week counts.
  // These bars give the fair per-week comparison, where holiday actually wins.
  drawHolidayPerWeek(grouped);
}

// Like-for-like companion to the donut: average sales per week by week type.
// Same colors as the donut (blue non-holiday / orange holiday) so meaning carries.
function drawHolidayPerWeek(grouped) {
  const svg = d3.select("#holidayPerWeek");
  svg.selectAll("*").remove();

  const { width, height } = getSvgSize(svg);
  const margin = { top: 6, right: 90, bottom: 6, left: 108 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Non-Holiday first, then Holiday — whichever are present in the current filter.
  const rows = [grouped.find(d => d.flag === 0), grouped.find(d => d.flag === 1)]
    .filter(Boolean)
    .map(d => ({ flag: d.flag, label: holidayLabel(d.flag), value: d.avgPerWeek, weeks: d.weeks }));

  if (rows.length === 0) return;

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.value) || 1]).range([0, innerWidth]);
  const y = d3.scaleBand().domain(rows.map(d => d.label)).range([0, innerHeight]).padding(0.35);

  const nonHoliday = rows.find(d => d.flag === 0);
  const holiday = rows.find(d => d.flag === 1);
  let upliftText = "";
  if (nonHoliday && holiday) {
    const diffPct = ((holiday.value - nonHoliday.value) / nonHoliday.value) * 100;
    upliftText = ` (${diffPct >= 0 ? "+" : "−"}${Math.abs(diffPct).toFixed(0)}%)`;
  }

  g.selectAll("rect").data(rows).join("rect")
    .attr("y", d => y(d.label))
    .attr("height", y.bandwidth())
    .attr("x", 0)
    .attr("width", d => x(d.value))
    .attr("rx", 3)
    .attr("fill", d => holidayColor(d.flag))
    .on("mousemove", (event, d) => showTooltip(event,
      `<b>${d.label}</b><br>Avg per week: ${formatCurrencyExact(d.value)}<br>Based on ${d.weeks} week${d.weeks > 1 ? "s" : ""}`))
    .on("mouseleave", hideTooltip);

  g.selectAll("text.cat").data(rows).join("text")
    .attr("class", "cat")
    .attr("x", -8)
    .attr("y", d => y(d.label) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("font-size", 11)
    .attr("fill", "#4b5563")
    .text(d => d.label);

  g.selectAll("text.val").data(rows).join("text")
    .attr("class", "val")
    .attr("x", d => x(d.value) + 6)
    .attr("y", d => y(d.label) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("font-size", 11)
    .attr("font-weight", "bold")
    .attr("fill", "#374151")
    .text(d => formatCompactCurrency(d.value) + (d.flag === 1 ? upliftText : ""));
}

// Task 4: Fuel Price vs Weekly Sales Scatter Plot
function drawScatterChart(data) {
  const svg = d3.select("#scatterChart");
  svg.selectAll("*").remove();

  const { width, height } = getSvgSize(svg);
  const margin = { top: 28, right: 20, bottom: 55, left: 78 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  d3.select("#scatterSubtitle").text(`Each point is one store-week (${storeScopeText()}). Color shows holiday weeks.`);

  const sample = data.filter(d => Number.isFinite(d.fuelPrice) && Number.isFinite(d.weeklySales));

  if (sample.length === 0) {
    d3.select("#scatterTitle").text("Fuel Price vs. Weekly Sales — No Data for Current Filters");
    return;
  }

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain(d3.extent(sample, d => d.fuelPrice)).nice().range([0, innerWidth]);
  const y = d3.scaleLinear().domain(d3.extent(sample, d => d.weeklySales)).nice().range([innerHeight, 0]);

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(formatFuelPrice));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(formatCompactCurrency));

  g.append("text").attr("x", innerWidth / 2).attr("y", innerHeight + 42)
    .attr("text-anchor", "middle").attr("fill", "#6b7280").attr("font-size", 12)
    .text("Fuel Price ($ per gallon)");
  g.append("text").attr("transform", "rotate(-90)").attr("x", -innerHeight / 2).attr("y", -58)
    .attr("text-anchor", "middle").attr("fill", "#6b7280").attr("font-size", 12)
    .text("Weekly Sales");

  // Draw non-holiday (blue) points first, holiday (yellow) points last so the
  // rarer, harder-to-see yellow marks aren't buried under the far more numerous
  // blue ones — yellow also gets a thin dark outline and higher opacity, since a
  // pale yellow dot at low opacity nearly vanishes on a white background.
  const sorted = [...sample].sort((a, b) => a.holiday - b.holiday);
  g.selectAll("circle").data(sorted).join("circle")
    .attr("cx", d => x(d.fuelPrice))
    .attr("cy", d => y(d.weeklySales))
    .attr("r", 3.2)
    .attr("fill", d => holidayColor(d.holiday))
    .attr("opacity", d => (d.holiday === 1 ? 0.9 : 0.4))
    .attr("stroke", d => (d.holiday === 1 ? "#946A00" : "none"))
    .attr("stroke-width", 0.5)
    .on("mousemove", (event, d) => showTooltip(event,
      `<b>Store ${d.store}</b><br>${holidayLabel(d.holiday)}<br>Fuel Price: ${formatFuelPrice(d.fuelPrice)}<br>Weekly Sales: ${formatCurrencyExact(d.weeklySales)}`))
    .on("mouseleave", hideTooltip);

  const r = pearsonR(sample, d => d.fuelPrice, d => d.weeklySales);
  const relText = Math.abs(r) < 0.15 ? "no relationship" : r > 0 ? "weak positive" : "weak negative";
  g.append("text").attr("class", "annotation").attr("x", 2).attr("y", -10)
    .text(`r = ${r.toFixed(2)} (${relText})`);

  addLegend(g, innerWidth - 145, 4, [
    { label: "Non-Holiday Week", color: COLORS.accent },
    { label: "Holiday Week", color: COLORS.highlight }
  ]);

  d3.select("#scatterTitle").text(
    Math.abs(r) < 0.15 ? "Fuel Price Shows No Meaningful Relationship to Weekly Sales" : "Fuel Price vs. Weekly Sales"
  );
}

function pearsonR(data, xAccessor, yAccessor) {
  const n = data.length;
  if (n < 2) return 0;
  const xs = data.map(xAccessor);
  const ys = data.map(yAccessor);
  const mx = d3.mean(xs);
  const my = d3.mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function getSvgSize(svg) {
  const node = svg.node();
  const width = node.clientWidth || 600;
  const height = node.clientHeight || 340;
  return { width, height };
}

function addLegend(container, x, y, items) {
  const legend = container.append("g").attr("transform", `translate(${x},${y})`);
  items.forEach((item, i) => {
    const row = legend.append("g").attr("transform", `translate(0,${i * 18})`);
    row.append("rect").attr("width", 11).attr("height", 11).attr("fill", item.color).attr("rx", 2);
    row.append("text").attr("class", "legend").attr("x", 16).attr("y", 9).text(item.label);
  });
}

function showTooltip(event, html) {
  tooltip
    .style("opacity", 1)
    .style("left", `${event.clientX}px`)
    .style("top", `${event.clientY}px`)
    .html(html);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}
