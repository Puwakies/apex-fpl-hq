// ============================================================
// APEX 3-WAY EXPORT MODULE  —  apex_3way.gs
// ------------------------------------------------------------
// วางเป็น "ไฟล์ใหม่" ในโปรเจกต์ Apps Script เดิม
//   (Editor → + ข้าง Files → Script → ตั้งชื่อ apex_3way → วางทั้งหมดนี้)
// ไม่ต้องแก้ไฟล์ใหญ่เดิม ยกเว้นใส่ GITHUB_TOKEN ด้านล่าง
//
// โมดูลนี้ใช้ฟังก์ชัน global จากไฟล์เดิมร่วม:
//   CONFIG, fetchJSON, readSheetData, getOrCreateSheet, callGemini,
//   logRun, buildSquadContext, buildNewsContext, buildPriceContext,
//   buildLeagueContext, statusLabel
//
// ทำ 2 อย่าง:
//   1) runGeminiPicks()  → Gemini ตอบ JSON structured (รัดกุม) เก็บใน tab GEMINI_PICKS
//   2) pushToGitHub()    → สร้าง cache JSON สะอาด push ขึ้น repo ให้ Claude Code/office อ่าน
//   3) runExport3Way()   → รันทั้งคู่ (ใช้ตั้ง trigger หรือต่อท้าย pipeline)
// ============================================================


// ── CONFIG เฉพาะโมดูลนี้ (ใส่ค่าตรงนี้ ไม่ต้องแก้ CONFIG เดิม) ──
const APEX3 = {
  GITHUB_REPO:   "Puwakies/apex-fpl-hq",   // owner/repo
  GITHUB_BRANCH: "main",
  GITHUB_TOKEN:  "",   // ← ใส่ fine-grained PAT (Contents: Read & write เฉพาะ repo นี้)

  // โมเดล Gemini สำหรับ structured picks (เปลี่ยนได้ถ้าต้องการ)
  GEMINI_MODEL:  "gemini-3.1-pro-preview",
};


// ============================================================
// 1) GEMINI STRUCTURED PICKS — รัดกุม คืน JSON ที่ parse ได้แน่นอน
// ============================================================
function runGeminiPicks() {
  Logger.log("=== GEMINI STRUCTURED PICKS START ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // current GW
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const gw = boot ? (
    (boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
     boot.events[boot.events.length - 1]).id
  ) : "?";

  // ── SQUAD: ดึงสดจาก FPL (ไม่พึ่ง sheet ที่มี merged title) ──
  const squadObj = _apexBuildSquad(boot);
  const squadList = (squadObj && squadObj.squad) ? squadObj.squad : [];
  const squadNames = squadList.map(p => p.name).join(", ") || "(none)";
  const squadCtx = squadList.length
    ? squadList.map(p => (p.is_starting ? "XI" : "BN") + " " + p.name +
        "(" + p.team + "," + p.pos + ",£" + p.price + "m" +
        (p.is_captain ? ",C" : p.is_vice ? ",V" : "") +
        (p.status !== "AVAILABLE" ? "," + p.status : "") + ")").join("\n")
    : "(ไม่มีข้อมูล squad)";

  // ── XPTS: parse สะอาด ข้าม title/section header ──
  const xptsArr = _apexParseXpts(ss);
  const topXpts = xptsArr
    .filter(p => p.xpts > 0)
    .sort((a, b) => b.xpts - a.xpts)
    .slice(0, 25)
    .map(p => p.name + " | " + p.xpts + " | " + (p.captain_xpts || "") +
              " | fdr" + (p.fdr || "?") + " | " + p.pos)
    .join("\n");

  // context อื่น (builders เดิมที่ไม่ติดปัญหา title)
  // news: กรองจากข่าวสด FPL เฉพาะผู้เล่นในทีม (กัน Gemini พลาดเคส Haaland OUT)
  const squadSet = {}; squadList.forEach(p => squadSet[p.name] = true);
  const allNews = (_apexBuildNews(boot).items || []);
  const myNews  = allNews.filter(n => squadSet[n.player]);
  const newsCtx = myNews.length
    ? myNews.map(n => "[" + (n.signal || "note").toUpperCase() + "] " + n.player +
        (n.chance != null ? " (" + n.chance + "%)" : "") + " — " + (n.news || "")).join("\n")
    : "ไม่มีผู้เล่นในทีมที่ถูก flag";
  const priceCtx  = buildPriceContext(ss);
  const leagueCtx = buildLeagueContext(ss);

  Logger.log("Gemini context — squad:" + squadList.length + " players, xpts:" + xptsArr.length +
             " rows, myNews:" + myNews.length);

  // ── PROMPT รัดกุม ────────────────────────────────────────
  const prompt =
`You are APEX-QUANT-JSON, a deterministic FPL analyst. Output ONE JSON object ONLY.

HARD RULES (ละเมิดไม่ได้):
- Output exactly ONE minified JSON object. No markdown, no \`\`\` fences, no text before or after.
- Use player names EXACTLY as written in the DATA. Never invent a player.
- Every xPts number MUST be copied from TOP_XPTS. Do NOT estimate new numbers.
- "starting_xi" = EXACTLY 11 names. Valid formation: 1 GK + 3-5 DEF + 2-5 MID + 1-3 FWD (totals 11).
  All 11 MUST be from MY_SQUAD (or "transfer_in" if you recommend one). Do NOT include a player who is flagged OUT/injured in INJURY_NEWS.
- "bench" = EXACTLY 4 names (the remaining MY_SQUAD players not in starting_xi). starting_xi + bench = your 15.
- "captain" and "vice_captain" MUST be inside "starting_xi".
- "transfer_out" MUST be in MY_SQUAD. "transfer_in" MUST be from TOP_XPTS and not already owned. null for BOTH if no transfer is worth it.
- "chip" is exactly one of: "TC", "BB", "FH", "WC", or null.
- "projected_xpts" = sum of the xPts of your 11 starting_xi ONLY (look each up in TOP_XPTS),
  then ADD the captain's xPts ONE more time (captain counted twice total). Bench does NOT count.
  This number should normally be ~45-75. If you computed >80 you double-counted — recompute.
- "confidence" = "high" only if news + price + fixture all align; else "medium" or "low".

DATA:
GW: ${gw}
MY_SQUAD (15): ${squadNames}
MY_SQUAD_DETAIL:
${squadCtx}
TOP_XPTS (name | xpts | captain_xpts | fdr | pos):
${topXpts}
INJURY_NEWS (my team only):
${newsCtx}
PRICE_SIGNALS:
${priceCtx}
MINI_LEAGUE:
${leagueCtx}

Return JSON with EXACTLY these keys and types:
{"engine":"gemini","gw":${gw},"captain":"<name>","captain_xpts":<number>,"vice_captain":"<name>","starting_xi":["<11 names>"],"bench":["<4 names>"],"transfer_out":<"<name>"|null>,"transfer_in":<"<name>"|null>,"transfer_reason":"<short reason>","chip":<"TC"|"BB"|"FH"|"WC"|null>,"projected_xpts":<number>,"confidence":"<high|medium|low>","key_risk":"<one risk>"}`;

  // เรียกแบบบังคับ JSON (responseMimeType) + temperature ต่ำ
  const raw   = _apexCallGeminiJSON(prompt);
  const picks = _apexParseJSON(raw) || { engine: "gemini", gw: gw, error: "parse_failed",
                                         raw: String(raw || "").slice(0, 400) };
  picks.engine = "gemini";
  if (picks.gw == null) picks.gw = gw;

  // เขียน tab GEMINI_PICKS (key/value → readSheetData อ่านง่าย)
  const sheet = getOrCreateSheet(ss, "GEMINI_PICKS");
  sheet.clearContents(); sheet.clearFormats();
  sheet.getRange(1, 1, 1, 2).setValues([["KEY", "VALUE"]])
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  const rows = Object.entries(picks).map(([k, v]) =>
    [k, (v !== null && typeof v === "object") ? JSON.stringify(v) : (v === null ? "null" : v)]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  sheet.autoResizeColumns(1, 2);

  logRun(ss, "GeminiPicks",
    "cap:" + (picks.captain || "?") + " xpts:" + (picks.projected_xpts || "?") +
    (picks.error ? " ⚠" + picks.error : ""), picks.error ? "PARTIAL" : "SUCCESS");
  Logger.log("=== GEMINI PICKS DONE | Captain: " + (picks.captain || "?") + " ===");
  return picks;
}

// เรียก Gemini แบบบังคับให้ตอบ JSON (เสถียรกว่า callGemini ปกติ)
function _apexCallGeminiJSON(prompt) {
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
                APEX3.GEMINI_MODEL + ":generateContent?key=" + CONFIG.GEMINI_KEY;
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,            // เกือบ deterministic
          maxOutputTokens: 2000,
          responseMimeType: "application/json",  // ← บังคับ JSON
        },
      }),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log("Gemini HTTP " + code + " — " + res.getContentText().slice(0, 200));
      // fallback: ลองโมเดล text ปกติ (เผื่อ responseMimeType ไม่รองรับ)
      return callGemini(prompt);
    }
    const data = JSON.parse(res.getContentText());
    return data.candidates && data.candidates[0] &&
           data.candidates[0].content.parts[0].text || null;
  } catch (e) {
    Logger.log("Gemini JSON error: " + e.message);
    return callGemini(prompt); // fallback
  }
}

// parse JSON แบบทนทาน (ลอก fence / ตัดข้อความนอกวงเล็บ)
function _apexParseJSON(raw) {
  if (!raw) return null;
  let t = String(raw).trim()
    .replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}


// ============================================================
// 2) PUSH CLEAN CACHE → GITHUB (ให้ Claude Code / office อ่าน)
// ============================================================
function pushToGitHub() {
  Logger.log("=== PUSH TO GITHUB START ===");
  if (!APEX3.GITHUB_TOKEN) { Logger.log("❌ ใส่ APEX3.GITHUB_TOKEN ก่อน"); return; }
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");

  // สร้าง JSON สะอาด (ไม่ dump sheet ดิบ)
  const cache = {
    "data/cache/squad.json":  _apexBuildSquad(boot),
    "data/cache/xpts.json":   { gw: _apexGW(boot), players: _apexParseXpts(ss) },
    "data/cache/league.json": _apexBuildLeague(ss),
    "data/cache/news.json":   _apexBuildNews(boot),
    "data/cache/price.json":  _apexBuildPrice(boot),
    "data/cache/gemini.json": _apexReadKV(ss, "GEMINI_PICKS"),
  };

  let ok = 0, fail = 0;
  Object.entries(cache).forEach(([path, obj]) => {
    const payload = { updated: new Date().toISOString(), ...obj };
    const b64 = Utilities.base64Encode(
      JSON.stringify(payload, null, 2), Utilities.Charset.UTF_8);
    const res = _ghPut(path, b64, "auto: update " + path.split("/").pop());
    if (res) { ok++; } else { fail++; }
  });

  logRun(ss, "GitHubPush", ok + " ok / " + fail + " fail", fail ? "PARTIAL" : "SUCCESS");
  Logger.log("=== PUSH DONE | " + ok + " ok, " + fail + " fail ===");
}

// PUT ไฟล์ขึ้น repo (อัปเดตถ้ามี sha เดิม)
function _ghPut(path, contentB64, msg) {
  const api = "https://api.github.com/repos/" + APEX3.GITHUB_REPO + "/contents/" +
              encodeURI(path);
  const headers = {
    Authorization: "Bearer " + APEX3.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "User-Agent": "apex-fpl-hq",
  };

  // หา sha เดิม (ถ้ามี)
  let sha = null;
  try {
    const get = UrlFetchApp.fetch(api + "?ref=" + APEX3.GITHUB_BRANCH,
      { headers: headers, muteHttpExceptions: true });
    if (get.getResponseCode() === 200) sha = JSON.parse(get.getContentText()).sha;
  } catch (e) {}

  const body = { message: msg, content: contentB64, branch: APEX3.GITHUB_BRANCH };
  if (sha) body.sha = sha;

  try {
    const put = UrlFetchApp.fetch(api, {
      method: "put", headers: headers, contentType: "application/json",
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = put.getResponseCode();
    if (code === 200 || code === 201) { Logger.log("  ✓ " + path); return true; }
    Logger.log("  ✗ " + path + " HTTP " + code + " — " + put.getContentText().slice(0, 160));
    return false;
  } catch (e) { Logger.log("  ✗ " + path + " — " + e.message); return false; }
}


// ============================================================
// 3) CLEAN JSON BUILDERS (สร้างข้อมูลสะอาดจากแหล่งที่เชื่อถือได้)
// ============================================================
function _apexGW(boot) {
  if (!boot) return "?";
  return (boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
          boot.events[boot.events.length - 1]).id;
}

// ทีมจริงของผู้ใช้ — ดึง entry picks สดจาก FPL (สะอาด)
function _apexBuildSquad(boot) {
  if (!boot) return { error: "no_bootstrap" };
  const id      = CONFIG.FPL_TEAM_ID;
  const entry   = fetchJSON("https://fantasy.premierleague.com/api/entry/" + id + "/");
  const history = fetchJSON("https://fantasy.premierleague.com/api/entry/" + id + "/history/");
  if (!entry) return { error: "no_entry" };

  const pMap = {}; boot.elements.forEach(e => pMap[e.id] = e);
  const tMap = {}; boot.teams.forEach(t => tMap[t.id] = t.short_name);
  const posMap = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const CHIP = { bboost: "BB", "3xc": "TC", freehit: "FH", wildcard: "WC" };
  const gw = _apexGW(boot);

  // หา picks ล่าสุดที่มีจริง
  let picks = null, picksGW = gw;
  for (let g = gw; g >= gw - 2 && g >= 1; g--) {
    const d = fetchJSON("https://fantasy.premierleague.com/api/entry/" + id + "/event/" + g + "/picks/");
    if (d && d.picks) { picks = d; picksGW = g; break; }
  }
  if (!picks) return { error: "no_picks", gw: gw };

  const used = (history && history.chips || []).map(c => c.name);
  const wc = used.filter(c => c === "wildcard").length;
  const chipsLeft = [].concat(
    !used.includes("bboost")  ? ["BB"] : [],
    !used.includes("3xc")     ? ["TC"] : [],
    !used.includes("freehit") ? ["FH"] : [],
    wc < 2 ? ["WC×" + (2 - wc)] : []);

  const squad = picks.picks.map(pk => {
    const p = pMap[pk.element] || {};
    return {
      slot: pk.position, is_starting: pk.position <= 11,
      name: p.web_name || ("ID:" + pk.element),
      team: tMap[p.team] || "?", pos: posMap[p.element_type] || "?",
      price: +((p.now_cost || 0) / 10).toFixed(1),
      status: statusLabel(p.status), news: p.news || "",
      is_captain: !!pk.is_captain, is_vice: !!pk.is_vice_captain,
    };
  });

  return {
    gw: gw, picks_gw: picksGW,
    team_name: entry.name,
    manager: (entry.player_first_name || "") + " " + (entry.player_last_name || ""),
    overall_rank: entry.summary_overall_rank || 0,
    total_points: entry.summary_overall_points || 0,
    bank: +((entry.last_deadline_bank || 0) / 10).toFixed(1),
    squad_value: +((entry.last_deadline_value || 0) / 10).toFixed(1),
    captain: (squad.find(p => p.is_captain) || {}).name || "?",
    vice_captain: (squad.find(p => p.is_vice) || {}).name || "?",
    chips_used: (history && history.chips || []).map(c => (CHIP[c.name] || c.name) + "@GW" + c.event),
    chips_left: chipsLeft,
    squad: squad,
  };
}

// xPts รายผู้เล่น — parse จาก sheet XPTS (เลขที่คำนวณจริง)
function _apexParseXpts(ss) {
  const sh = ss.getSheetByName("XPTS");
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  let hdr = null;
  const out = {}, seen = new Set();
  const idx = (h, key) => h.findIndex(c => String(c).toUpperCase().includes(key));

  data.forEach(row => {
    if (row.some(c => String(c).toUpperCase() === "NAME")) { hdr = row; return; }
    if (!hdr) return;
    const ni = hdr.findIndex(c => String(c).toUpperCase() === "NAME");
    const name = ni >= 0 ? String(row[ni] || "").trim() : "";
    const pos  = String(row[idx(hdr, "POS")] || "");
    if (!name || name.toUpperCase() === "NAME") return;
    if (!["GK", "DEF", "MID", "FWD"].includes(pos)) return; // เก็บเฉพาะแถวผู้เล่น
    if (seen.has(name)) return; seen.add(name);
    const g = key => { const i = idx(hdr, key); return i >= 0 ? row[i] : ""; };
    out[name] = {
      name: name, team: String(g("TEAM") || ""), pos: pos,
      price: parseFloat(String(g("PRICE")).replace("£", "").replace("m", "")) || 0,
      xpts: parseFloat(g("XPTS")) || 0,
      captain_xpts: parseFloat(g("CAPTAIN")) || 0,  // จับ CAPTAIN_xPTS
      fdr: parseInt(g("FDR")) || 0,
    };
  });
  return Object.values(out).sort((a, b) => b.xpts - a.xpts);
}

// mini-league — จาก LEAGUE_CONTEXT (สะอาด KV) + diff/template จาก MINI_LEAGUE
function _apexBuildLeague(ss) {
  const ctxSh = ss.getSheetByName("LEAGUE_CONTEXT");
  const ctx = {};
  if (ctxSh) ctxSh.getDataRange().getValues().forEach(r => { if (r[0]) ctx[String(r[0])] = r[1]; });

  const rows = readSheetData(ss, "MINI_LEAGUE");
  const diff = rows.filter(r => r["DIFF SCORE"] && parseFloat(r["DIFF SCORE"]) > 0)
    .slice(0, 10).map(r => ({ name: r["NAME"], team: r["TEAM"], pos: r["POS"],
      league_own: r["LEAGUE OWN%"], diff_score: r["DIFF SCORE"], i_own: r["I OWN?"] }));
  const tpl = rows.filter(r => r["I OWN?"] && String(r["LEAGUE OWN%"]).replace("%", "") >= 70)
    .slice(0, 10).map(r => ({ name: r["NAME"], league_own: r["LEAGUE OWN%"], i_own: r["I OWN?"] }));

  return { context: ctx, differentials: diff, template: tpl };
}

// ข่าวเจ็บ/แบน — สร้างสะอาดจาก bootstrap
function _apexBuildNews(boot) {
  if (!boot) return { items: [] };
  const tMap = {}; boot.teams.forEach(t => tMap[t.id] = t.short_name);
  const posMap = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const items = boot.elements
    .filter(p => p.news && p.news.trim() !== "")
    .map(p => ({
      player: p.web_name, team: tMap[p.team] || "?", pos: posMap[p.element_type] || "?",
      status: statusLabel(p.status),
      chance: p.chance_of_playing_next_round != null ? p.chance_of_playing_next_round : null,
      news: p.news,
      signal: p.status === "i" ? "out" : p.status === "s" ? "suspended" :
              p.status === "d" ? "doubt" : "note",
    }))
    .sort((a, b) => ({ out: 0, suspended: 1, doubt: 2, note: 3 }[a.signal] -
                      { out: 0, suspended: 1, doubt: 2, note: 3 }[b.signal]))
    .slice(0, 40);
  return { items: items };
}

// ราคา — สร้างสะอาดจาก net transfer velocity
function _apexBuildPrice(boot) {
  if (!boot) return { likely_rises: [], likely_falls: [] };
  const tMap = {}; boot.teams.forEach(t => tMap[t.id] = t.short_name);
  const posMap = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const TOTAL = CONFIG.TOTAL_MANAGERS || 10000000;

  const scored = boot.elements.filter(p => p.minutes > 0).map(p => {
    const own = parseFloat(p.selected_by_percent || 0);
    const owners = Math.round((own / 100) * TOTAL);
    const net = (p.transfers_in_event || 0) - (p.transfers_out_event || 0);
    const rate = owners > 0 ? +(net / owners * 100).toFixed(3) : 0;
    return { player: p.web_name, team: tMap[p.team] || "?", pos: posMap[p.element_type] || "?",
             net_transfers: net, net_rate: rate,
             price: +(p.now_cost / 10).toFixed(1),
             price_change: +(p.cost_change_event / 10).toFixed(1) };
  });
  return {
    likely_rises: scored.filter(x => x.net_rate >= (CONFIG.PRICE_RISE_SOON || 0.8))
      .sort((a, b) => b.net_rate - a.net_rate).slice(0, 12),
    likely_falls: scored.filter(x => x.net_rate <= (CONFIG.PRICE_FALL_SOON || -0.8))
      .sort((a, b) => a.net_rate - b.net_rate).slice(0, 12),
  };
}

// อ่าน sheet แบบ key/value → object (ใช้กับ GEMINI_PICKS)
function _apexReadKV(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return { error: "no_sheet_" + name };
  const obj = {};
  sh.getDataRange().getValues().slice(1).forEach(r => {
    if (!r[0]) return;
    let v = r[1];
    if (v === "null") v = null;
    else if (typeof v === "string" && (v[0] === "{" || v[0] === "[")) {
      try { v = JSON.parse(v); } catch (e) {}
    }
    obj[String(r[0])] = v;
  });
  return obj;
}


// ============================================================
// 4) ORCHESTRATION + TRIGGER (ไม่ต้องแตะไฟล์เดิม)
// ============================================================
// รัน Gemini picks แล้ว push — ใช้ตัวนี้ตัวเดียวพอ
function runExport3Way() {
  Logger.log("=== EXPORT 3-WAY START ===");
  try { runGeminiPicks(); } catch (e) { Logger.log("⚠ GeminiPicks: " + e.message); }
  try { pushToGitHub();   } catch (e) { Logger.log("⚠ pushToGitHub: " + e.message); }
  Logger.log("=== EXPORT 3-WAY DONE ===");
}

// ตั้ง trigger: ทุกพฤหัส 20:45 (หลัง weekly pipeline 20:00 ของไฟล์เดิม)
// รันฟังก์ชันนี้ครั้งเดียวเพื่อสร้าง trigger
function setupExportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "runExport3Way")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runExport3Way")
    .timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(20).nearMinute(45).create();
  Logger.log("✓ Export trigger set: Thursday ~20:45");
}

// ทดสอบเร็ว: เช็คว่า token/connection ใช้ได้
function apexTestPush() {
  if (!APEX3.GITHUB_TOKEN) { Logger.log("❌ ใส่ GITHUB_TOKEN ก่อน"); return; }
  const b64 = Utilities.base64Encode(
    JSON.stringify({ updated: new Date().toISOString(), test: true }, null, 2),
    Utilities.Charset.UTF_8);
  const ok = _ghPut("data/cache/_ping.json", b64, "test: apex ping");
  Logger.log(ok ? "✅ GitHub push OK — ดูไฟล์ data/cache/_ping.json ใน repo"
                : "❌ Push failed — เช็ค token/permission (ดู Logs)");
}


// ============================================================
// 5) BACKTEST EXPORTER — push historical data ขึ้น repo
//    ให้ the-historian (Claude Code) อ่านไปทำ blind backtest GW1-38
// ------------------------------------------------------------
// prerequisite: ต้องรัน blindSimPrep() ของไฟล์ใหญ่ก่อน (สร้าง BLIND_SIM_DATA)
// รันครั้งเดียวต่อซีซัน: exportBacktestData()
//   → data/backtest/history.json   (ผู้เล่นทุกคน per-GW: pts/min/xgi/price/fdr)
//   → data/backtest/my_picks.json  (ทีมจริงคุณทั้ง 38 GW = ground truth ของ YOU)
//   → data/backtest/meta.json      (ข้อมูลซีซัน + checklist)
// ============================================================
function exportBacktestData() {
  Logger.log("=== EXPORT BACKTEST DATA START ===");
  if (!APEX3.GITHUB_TOKEN) { Logger.log("❌ ใส่ APEX3.GITHUB_TOKEN ก่อน"); return; }
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // ── 1) history.json : จาก BLIND_SIM_DATA (per-GW ของผู้เล่นทุกคน) ──
  const ds = ss.getSheetByName("BLIND_SIM_DATA");
  if (!ds) { Logger.log("❌ ไม่พบ BLIND_SIM_DATA — รัน blindSimPrep() ก่อน"); return; }
  const raw = ds.getDataRange().getValues();
  const hdr = raw[0];
  const ci  = n => hdr.indexOf(n);

  // จัดกลุ่มตามผู้เล่น → [{id,name,team,pos,gws:[{gw,pts,min,xgi,price,fdr,venue,opp,dgw}]}]
  const byId = {};
  raw.slice(1).forEach(r => {
    const id = r[ci("PLAYER_ID")];
    if (!id) return;
    if (!byId[id]) byId[id] = {
      id: id, name: r[ci("NAME")], team: r[ci("TEAM")], pos: String(r[ci("POS")]),
      pen: parseInt(r[ci("PEN_ORDER")]) || 0, gws: [],
    };
    byId[id].gws.push({
      gw:    parseInt(r[ci("GW")]),
      pts:   parseInt(r[ci("PTS")])   || 0,
      min:   parseInt(r[ci("MIN")])   || 0,
      bps:   parseInt(r[ci("BPS")])   || 0,
      xgi:   parseFloat(r[ci("XGI")]) || 0,
      xgc:   parseFloat(r[ci("XGC")]) || 0,
      price: parseFloat(r[ci("PRICE")]) || 0,
      fdr:   parseInt(r[ci("FDR")])   || 3,
      venue: String(r[ci("VENUE")]    || "H"),
      opp:   String(r[ci("OPP")]      || "?"),
      dgw:   (parseInt(r[ci("NUM_FIX")]) || 1) >= 2,
    });
  });
  const players = Object.values(byId).map(p => {
    p.gws.sort((a, b) => a.gw - b.gw);
    return p;
  });
  Logger.log("history players: " + players.length);

  // ── 2) my_picks.json : ทีมจริงคุณทั้ง 38 GW (ground truth ของ YOU) ──
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const pMap = {}; (boot ? boot.elements : []).forEach(e => pMap[e.id] = e);
  const tMap = {}; (boot ? boot.teams : []).forEach(t => tMap[t.id] = t.short_name);
  const posMap = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const CHIP = { bboost: "BB", "3xc": "TC", freehit: "FH", wildcard: "WC" };
  const id = CONFIG.FPL_TEAM_ID;

  const history = fetchJSON("https://fantasy.premierleague.com/api/entry/" + id + "/history/");
  const transfers = fetchJSON("https://fantasy.premierleague.com/api/entry/" + id + "/transfers/") || [];
  const gwHist = (history && history.current) || [];

  // หา GW ที่จบแล้ว
  const finishedGWs = boot
    ? boot.events.filter(e => e.finished || e.data_checked).map(e => e.id)
    : [];
  const lastGW = finishedGWs.length ? Math.max.apply(null, finishedGWs) : 38;

  const myPicks = [];
  for (let gw = 1; gw <= lastGW; gw++) {
    Utilities.sleep(220);
    const pk = fetchJSON("https://fantasy.premierleague.com/api/entry/" + id + "/event/" + gw + "/picks/");
    if (!pk || !pk.picks) continue;
    const gwRow = gwHist.find(g => g.event === gw) || {};
    const gwXfers = transfers.filter(t => t.event === gw).map(t => ({
      out: (pMap[t.element_out] || {}).web_name || ("ID:" + t.element_out),
      in:  (pMap[t.element_in]  || {}).web_name || ("ID:" + t.element_in),
    }));
    myPicks.push({
      gw: gw,
      points: gwRow.points || 0,
      hits: gwRow.event_transfers_cost || 0,
      net_points: (gwRow.points || 0) - (gwRow.event_transfers_cost || 0),
      overall_rank: gwRow.overall_rank || 0,
      chip: pk.active_chip ? (CHIP[pk.active_chip] || pk.active_chip) : "",
      transfers: gwXfers,
      squad: pk.picks.map(x => {
        const p = pMap[x.element] || {};
        return {
          name: p.web_name || ("ID:" + x.element),
          team: tMap[p.team] || "?", pos: posMap[p.element_type] || "?",
          is_starting: x.position <= 11,
          is_captain: !!x.is_captain, is_vice: !!x.is_vice_captain,
          multiplier: x.multiplier,
        };
      }),
    });
    if (gw % 10 === 0) Logger.log("  picks " + gw + "/" + lastGW);
  }
  Logger.log("my_picks GWs: " + myPicks.length);

  // ── 3) push ขึ้น repo ──
  const push = (path, obj) => {
    const b64 = Utilities.base64Encode(
      JSON.stringify({ updated: new Date().toISOString(), ...obj }, null, 2),
      Utilities.Charset.UTF_8);
    return _ghPut(path, b64, "backtest: " + path.split("/").pop());
  };

  const okH = push("data/backtest/history.json", { season: "2025/26", n_players: players.length, players: players });
  const okP = push("data/backtest/my_picks.json", { season: "2025/26", team_id: id, last_gw: lastGW, gws: myPicks });
  const okM = push("data/backtest/meta.json", {
    season: "2025/26", last_gw: lastGW, n_players: players.length,
    note: "blind backtest source. history = per-GW player stats. my_picks = YOU ground truth.",
  });

  logRun(ss, "BacktestExport",
    "players:" + players.length + " picks:" + myPicks.length, (okH && okP) ? "SUCCESS" : "PARTIAL");
  Logger.log("=== BACKTEST EXPORT DONE | history:" + okH + " picks:" + okP + " ===");
}
