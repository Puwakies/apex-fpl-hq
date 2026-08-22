// ============================================================
// APEX PROTOCOL v2.0 — Google Apps Script
// FPL Intelligence System
// ============================================================
// STRUCTURE:
//   1.  CONFIG
//   2.  PIPELINE ORCHESTRATORS
//   3.  DATA — Scout & FDR
//   4.  DATA — News Scout
//   5.  DATA — Squad Tracker
//   6.  DATA — Mini-League
//   7.  DATA — Historical Data & Baseline
//   8.  DATA — Top Manager Strategy
//   9.  DATA — Price Prediction
//  10.  DATA — Rotation Risk
//  11.  DATA — Season Target
//  12.  DATA — xPts Calculator
//  13.  DATA — Hit Calculator
//  14.  DATA — Fixture Swing
//  15.  DATA — Realtime Alert (store only)
//  16.  AI   — Quant Analysis Engine
//  17.  AI   — Team Manager
//  18.  POST-MORTEM — GW Review
//  19.  SEASON MANAGER — Pause / Resume
//  20.  DASHBOARD
//  21.  EMAIL SYSTEM
//  22.  CUSTOM MENU + RUN ALL + TRIGGERS
//  23.  HELPERS
// ============================================================


// ============================================================
// 1. CONFIG — แก้ค่าทั้งหมดที่นี่เท่านั้น
// ============================================================

const CONFIG = {
  // ── Personal (แก้ทุกครั้ง) ───────────────────────────────
  SHEET_ID:   SpreadsheetApp.getActiveSpreadsheet().getId(),
  // 🔑 อย่า hardcode key ในไฟล์ (repo นี้ public) — เก็บใน Project Settings → Script Properties ชื่อ "GEMINI_KEY"
  //    ถ้ายังไม่ได้ตั้ง ให้ใส่ key แทน "" ชั่วคราว (แต่แนะนำ Script Properties)
  GEMINI_KEY: (function(){ try { return PropertiesService.getScriptProperties().getProperty("GEMINI_KEY") || ""; } catch(e){ return ""; } })(),
  FPL_TEAM_ID: "105876",
  LEAGUE_ID:   "156619",  // ← เพิ่มบรรทัดนี้

  // ── Player Pool ───────────────────────────────────────────
  // จำนวนนักเตะต่อตำแหน่งที่ดึงมาวิเคราะห์
  QUOTA: { 1:15, 2:50, 3:55, 4:30 }, // GK DEF MID FWD = 150 total

  // ── Season Target ─────────────────────────────────────────
  TARGET_RANK:      100,    // เป้าหมาย overall rank
  TARGET_PTS:       2500,   // เป้าหมายคะแนน (เดิม 2700 → 2500)
  TOTAL_GW:         38,     // จำนวน GW ต่อซีซัน

  // ── Season (อัปเดตทุกครั้งที่ขึ้นซีซันใหม่) ────────────────
  CURRENT_SEASON:   "2026/27",   // ซีซันปัจจุบัน
  PREV_SEASON:      "2025/26",   // ซีซันก่อน (ใช้เป็น baseline GW1-5)
  KEEP_SEASONS:     ["2025/26","2024/25","2023/24"], // 3 ซีซันจบล่าสุด (historical)
  HIST_WEIGHTS:     { "2025/26":0.45, "2024/25":0.35, "2023/24":0.20 },

  // ── xPts Formula weights ──────────────────────────────────
  // FDR Factor: fdr 1=1.30, 2=1.15, 3=1.00, 4=0.85, 5=0.70
  FDR_FACTORS:      [0, 1.30, 1.15, 1.00, 0.85, 0.70],
  // BPS thresholds → bonus factor
  BPS_TIERS:        [[35, 1.12], [25, 1.07], [15, 1.03], [0, 1.00]],
  // CS Probability base per FDR
  CS_PROB_BASE:     [0, 0.55, 0.45, 0.32, 0.20, 0.12], // index = fdr
  CS_PROB_MAX:      0.85,   // cap CS probability
  HOME_CS_BONUS:    1.10,   // home advantage for CS
  AWAY_CS_PENALTY:  0.95,
  HOME_ATT_BONUS:   1.05,   // home advantage for attack
  // SP (Set Piece) bonuses
  SP_PEN_FIRST:     1.15,   // pen taker #1
  SP_CORNER_FIRST:  1.08,   // corner/FK taker #1
  SP_SECOND:        1.03,   // any set piece taker #2
  // Minutes factor
  MIN_HIGH:         75,     // >= 75 min → factor 1.0
  MIN_MID:          45,     // >= 45 min → factor 0.75
  MIN_FACTOR_HIGH:  1.00,
  MIN_FACTOR_MID:   0.75,
  MIN_FACTOR_LOW:   0.40,

  // ── Price Prediction thresholds ──────────────────────────
  PRICE_RISE_NOW:   1.5,    // net rate % → BUY_NOW
  PRICE_RISE_SOON:  0.8,    // net rate % → BUY_SOON
  PRICE_FALL_NOW:  -1.5,    // net rate % → SELL_NOW
  PRICE_FALL_SOON: -0.8,    // net rate % → SELL_SOON
  TOTAL_MANAGERS:   10000000,

  // ── Rotation Risk thresholds ─────────────────────────────
  ROT_HIGH_SD:      30,     // SD นาที > 30 → HIGH risk
  ROT_HIGH_START:   40,     // start rate < 40% → HIGH
  ROT_MED_SD:       15,
  ROT_MED_START:    60,

  // ── Hit Calculator ───────────────────────────────────────
  HIT_COST:         4,      // -4 pts per hit
  DOUBLE_HIT_COST:  8,

  // ── Blind Simulator ──────────────────────────────────────
  SIM_FT_MIN_GAIN:  3.0,    // FT gain threshold (ถ้าน้อยกว่า → bank FT)
  SIM_HIT_MIN_GAIN: 8.0,    // Hit gain threshold (ต้องชนะ hitcost อย่างชัดเจน)
  SIM_DGW_BOOST:    1.85,   // DGW xPts multiplier (ไม่ถึง 2x เพราะ CS/bonus แบ่งกัน)
  SIM_DGW_SORT_BONUS: 3.0,  // bonus xPts ใน sort เพื่อ prioritize DGW players

  // Chip triggers
  CHIP_WC_AVG3_THRESHOLD:    42,   // avg 3 GW ต่ำกว่านี้ → Wildcard
  CHIP_WC1_FORCE_GW:         16,   // force WC1 ถ้าถึง GW นี้ยังไม่ได้ใช้
  CHIP_WC2_FORCE_GW:         32,   // force WC2
  CHIP_TC_MIN_XPTS:          9.0,  // top player xPts ขั้นต่ำสำหรับ TC
  CHIP_TC_MAX_FDR:           3,    // FDR ดีพอสำหรับ TC
  CHIP_TC_DGW_MIN_XPTS:      8.0,  // xPts ขั้นต่ำใน DGW week สำหรับ TC
  CHIP_TC1_MIN_GW:           6,    // TC1 ใช้ได้ตั้งแต่ GW นี้
  CHIP_TC1_FORCE_GW:         17,   // force TC1 ถ้าถึง GW นี้ยังไม่ได้ใช้
  CHIP_TC2_FORCE_GW_LEFT:    4,    // force TC2 ถ้าเหลือ GW น้อยกว่านี้
  CHIP_BB_MIN_GOOD_FDR:      8,    // คนใน squad ต้องมี FDR≤3 อย่างน้อยนี้คน → BB
  CHIP_BB1_MIN_GW:           8,    // BB1 ใช้ได้ตั้งแต่ GW นี้
  CHIP_BB1_FORCE_GW:         18,   // force BB1
  CHIP_BB2_FORCE_GW_LEFT:    5,    // force BB2

  // ── ข้อ 3: บังคับ sequencing WC → TC/BB ────────────────────
  // ถ้าเพิ่งเล่น WC ภายใน N GW ที่แล้ว = ทีมสดใหม่ → ใช้เกณฑ์ปกติได้เลย
  // ถ้าไม่ได้เพิ่งเล่น WC = ต้องเจอเกณฑ์สูงกว่าเดิมก่อนยอมเล่น TC/BB เดี่ยวๆ
  CHIP_POST_WC_WINDOW:        2,    // ภายใน 2 GW หลัง WC ถือว่า "ทีมสด"
  CHIP_STANDALONE_XPTS_BONUS: 2,    // ไม่ได้เพิ่งเล่น WC → ต้องการ xPts สูงกว่าเกณฑ์ปกติ +2
  CHIP_STANDALONE_FDR_BONUS:  3,    // ไม่ได้เพิ่งเล่น WC → ต้องการคนฟิกซ์เจอร์ดีมากกว่าเกณฑ์ปกติ +3 คน
  CHIP_FH_NOFIX_THRESHOLD:   5,    // คนในทีมไม่มีแมตช์ ≥ นี้ → FH
  CHIP_FH_AVG_FDR_THRESHOLD: 4.2,  // avg FDR ทีมสูงเกินนี้ → FH
  CHIP_FH_FORCE_GW_LEFT:     3,    // force FH ก่อนหมดซีซัน

  // ── Late-Season Tactical Mode (ข้อ 2) ────────────────────
  LATE_SEASON_START_GW:  30,   // GW ที่เริ่มเช็คโหมด aggressive
  LEAGUE_CHASE_GAP_PTS:  1,    // ตามหลัง leader เกินกี่ pts → AGGRESSIVE
  AGGR_FT_MIN_GAIN:      1.0,  // AGGRESSIVE: FT threshold (ต่ำกว่า STANDARD มาก)
  AGGR_HIT_MIN_GAIN:     4.0,  // AGGRESSIVE: Hit threshold
  AGGR_MAX_HITS_PER_GW:  2,    // AGGRESSIVE: hit ได้สูงสุด/GW
  AGGR_DIFF_TSB_MAX:     20,   // AGGRESSIVE: TSB% ต่ำกว่านี้ = differential boost
  AGGR_CHIP_RELAX:       true, // AGGRESSIVE: ผ่อนเงื่อนไข chip force-timing

  // ── GW1-5 Baseline Blend จากซีซันก่อน (ข้อ 4) ─────────────
  BASELINE_BLEND_GW:     5,    // GW ที่ blend กับ baseline 25/26 (GW1=100% ลดจนถึง GW6=0%)

  // ── AI Team Manager (Real pipeline) ──────────────────────
  AI_BUDGET_ALLOC: {
    1: [4.5, 4.0],
    2: [6.5, 5.0, 5.0, 4.5, 4.5],
    3: [9.0, 7.5, 6.0, 5.0, 5.0],
    4: [8.5, 6.0, 5.5],
  },
};

// ── AI Team Config (real pipeline) ──────────────────────────
const AI_TEAM_CONFIG = {
  budget:        100.0,
  formation:     { 1:2, 2:5, 3:5, 4:3 },
  maxPerTeam:    3,
  freeTransfers: 1,
  // budgetAlloc: array of max prices per slot (ต้องตรงกับ SIM_SQUAD_CONFIG.alloc)
  budgetAlloc: {
    1: [5.5, 4.5],
    2: [6.5, 6.0, 5.5, 4.8, 6.0],
    3: [11.0, 8.0, 7.0, 5.5, 7.0],
    4: [10.0, 7.5, 7.0],
  },
};

// ── Blind Sim Squad Config (ดึงจาก CONFIG) ──────────────────


// ============================================================
// 2. PIPELINE ORCHESTRATORS
// ============================================================

function runWeeklyPipeline() {
  Logger.log("=== APEX WEEKLY PIPELINE START ===");
  Logger.log("Time: " + new Date().toLocaleString("th-TH"));

  const steps = [
    ["SeasonManager",   runSeasonManager],
    ["Scout",           runScout],
    ["FixtureSwing",    runFixtureSwing],
    ["PricePrediction", runPricePrediction],
    ["RotationRisk",    runRotationRisk],
    ["NewsScout",       runNewsScout],
    ["SquadTracker",    runSquadTracker],
    ["SeasonTarget",    runSeasonTarget],
    ["MiniLeague",      runMiniLeague],
    ["XPtsCalculator",  runXPtsCalculator],  // ต้องก่อน HitCalc และ AITeam
    ["HitCalculator",   runHitCalculator],
    ["AITeamManager",   runAITeamManager],   // ต้องหลัง XPts
    ["QuantBrief",      runQuantBrief],
    ["Dashboard",       refreshDashboard],
  ];

  const failed = [];
  steps.forEach(([name, fn]) => {
    try {
      Logger.log("▶ " + name + "...");
      fn();
      Logger.log("✓ " + name);
    } catch(e) {
      Logger.log("✗ " + name + ": " + e.message);
      failed.push(name + ": " + e.message);
    }
  });

  if (failed.length > 0) {
    sendCompletionEmail("FAILED", failed.join("\n"));
  } else {
    sendCompletionEmail("SUCCESS");
  }
  Logger.log("=== WEEKLY PIPELINE DONE ===");
}

function runPreDeadlineCheck() {
  Logger.log("=== PRE-DEADLINE CHECK ===");
  const steps = [
    ["NewsScout",          runNewsScout],
    ["TopManagerStrategy", runTopManagerStrategy],
    ["MiniLeague",         runMiniLeague],
    ["QuantCaptain",       runQuantCaptain],
    ["NextWeekBlindTest",  runNextWeekBlindTest],
    ["Dashboard",          refreshDashboard],
  ];

  const failed = [];
  steps.forEach(([name, fn]) => {
    try { fn(); Logger.log("✓ " + name); }
    catch(e) { Logger.log("✗ " + name + ": " + e.message); failed.push(name); }
  });

  sendCompletionEmail(failed.length ? "FAILED" : "DEADLINE_CHECK",
                      failed.join(", "));
  Logger.log("=== PRE-DEADLINE DONE ===");
}


// ============================================================
// 3. DATA — SCOUT & FDR
// ============================================================

function runScout() {
  Logger.log("=== APEX SCOUT START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const fix  = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot || !fix) { Logger.log("❌ API failed"); return; }

  const teamMap = {};
  const teamPos = {};
  boot.teams.forEach((t, i) => {
    teamMap[t.id] = t.short_name;
    teamPos[t.id] = t.position || (i + 1);
  });
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  const currentGW = (
    boot.events.find(e => e.is_next)    ||
    boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;
  Logger.log("Current GW: " + currentGW);

  const upcoming = fix.filter(f => !f.finished && f.event !== null);
  const finished = fix.filter(f => f.finished);
  const teamForm = buildTeamForm(boot.teams, finished);

  // คัด Top 100 ตาม quota
  const top100 = [];
  [1,2,3,4].forEach(posId => {
    boot.elements
      .filter(p => p.minutes > 0 && p.element_type === posId)
      .sort((a, b) => b.total_points - a.total_points)
      .slice(0, CONFIG.QUOTA[posId])
      .forEach(p => top100.push(p));
  });

  const players = top100.map(p => {
    const fdrData = calcFDRX(p.team, upcoming, teamPos, teamForm, teamMap, currentGW);
    return {
      name:           p.web_name,
      full_name:      p.first_name + " " + p.second_name,
      team:           teamMap[p.team] || String(p.team),
      team_id:        p.team,
      pos_id:         p.element_type,
      position:       posMap[p.element_type] || "?",
      status:         statusLabel(p.status),
      price:          +(p.now_cost / 10).toFixed(1),
      total_pts:      p.total_points,
      minutes:        p.minutes,
      ppm:            p.now_cost > 0 ? +(p.total_points / (p.now_cost / 10)).toFixed(2) : 0,
      ownership:      +p.selected_by_percent,
      xgi:            +(parseFloat(p.expected_goal_involvements || 0)).toFixed(2),
      xgc:            +(parseFloat(p.expected_goals_conceded    || 0)).toFixed(2),
      transfer_in:     p.transfers_in_event  || 0,
      transfer_out:    p.transfers_out_event || 0,
      transfer_delta: (p.transfers_in_event  || 0) - (p.transfers_out_event || 0),
      price_change:   +(p.cost_change_event / 10).toFixed(1),
      yellow_cards:    p.yellow_cards || 0,
      news:            p.news || "",
      fdr_fpl_3:      fdrData.fpl_avg_3,
      fdr_fpl_5:      fdrData.fpl_avg_5,
      fdrx_3:         fdrData.fdrx_3,
      fdrx_5:         fdrData.fdrx_5,
      next_fixtures:  fdrData.readable,
      team_form:      teamForm[p.team]?.label || "?",
      team_form_pts:  teamForm[p.team]?.pts   || 0,
    };
  });

  Logger.log("✓ Players: " + players.length);

  const sheet   = getOrCreateSheet(ss, "PLAYER_POOL");
  sheet.clearContents();
  sheet.clearFormats();

  const headers = [
    "NAME","FULL_NAME","TEAM","POS","STATUS","PRICE","TOTAL_PTS","PPM",
    "MINUTES","OWNERSHIP%","XGI","XGC",
    "FDR_FPL_3","FDR_FPL_5","FDRX_3","FDRX_5",
    "NEXT_FIXTURES","TEAM_FORM","TEAM_FORM_PTS",
    "XFER_IN","XFER_OUT","XFER_DELTA","PRICE_CHANGE","YELLOW_CARDS","NEWS",
  ];
  const rows = players.map(p => [
    p.name, p.full_name, p.team, p.position, p.status,
    p.price, p.total_pts, p.ppm, p.minutes, p.ownership,
    p.xgi, p.xgc, p.fdr_fpl_3, p.fdr_fpl_5, p.fdrx_3, p.fdrx_5,
    p.next_fixtures, p.team_form, p.team_form_pts,
    p.transfer_in, p.transfer_out, p.transfer_delta,
    p.price_change, p.yellow_cards, p.news,
  ]);

  const hdr = sheet.getRange(1, 1, 1, headers.length);
  hdr.setValues([headers]).setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  // Color status
  const statusCol = headers.indexOf("STATUS") + 1;
  rows.forEach((row, i) => {
    const cell = sheet.getRange(i + 2, statusCol);
    const s    = row[statusCol - 1];
    if      (s === "AVAILABLE")   cell.setBackground("#d4edda").setFontColor("#155724");
    else if (s === "DOUBTFUL")    cell.setBackground("#fff3cd").setFontColor("#856404");
    else if (s === "INJURED")     cell.setBackground("#f8d7da").setFontColor("#721c24");
    else if (s === "SUSPENDED")   cell.setBackground("#f8d7da").setFontColor("#721c24");
    else if (s === "UNAVAILABLE") cell.setBackground("#e2e3e5").setFontColor("#383d41");
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  writeFDRCalendar(ss, boot.teams, upcoming, teamForm, currentGW);
  logRun(ss, "Scout", players.length + " players | GW" + currentGW, "SUCCESS");
  Logger.log("=== SCOUT DONE ===");
}

function calcFDRX(teamId, upcoming, teamPos, teamForm, teamMap, currentGW) {
  const fixtures = upcoming
    .filter(f => f.event >= currentGW &&
                (f.team_h === teamId || f.team_a === teamId))
    .sort((a, b) => a.event - b.event);
  if (!fixtures.length) return { fpl_avg_3:5, fpl_avg_5:5, fdrx_3:5, fdrx_5:5, readable:"BGW" };

  const computed = fixtures.slice(0, 5).map(f => {
    const isHome    = f.team_h === teamId;
    const oppId     = isHome ? f.team_a  : f.team_h;
    const fplFDR    = isHome ? f.team_h_difficulty : f.team_a_difficulty;
    const oppPos    = teamPos[oppId] || 10;
    const formPts   = teamForm[oppId]?.pts || 7;
    const posFactor = oppPos <= 5  ?  0.4 : oppPos <= 10 ?  0.1 : oppPos <= 15 ? -0.1 : -0.4;
    const vFactor   = isHome ? -0.2 : 0.2;
    const fFactor   = formPts >= 12 ?  0.3 : formPts >= 7 ? 0.0 : -0.2;
    const fdrx      = Math.min(5, Math.max(1, fplFDR + posFactor + vFactor + fFactor));
    const opp       = teamMap[oppId] || "?";
    return {
      fpl:      fplFDR,
      fdrx:     +fdrx.toFixed(1),
      readable: opp + "(" + (isHome?"H":"A") + ")[" + fdrx.toFixed(1) + "]",
    };
  });

  const avg = (arr, key, n) =>
    +(arr.slice(0, n).reduce((s, x) => s + x[key], 0) / Math.min(n, arr.length)).toFixed(2);

  return {
    fpl_avg_3: avg(computed, "fpl",  3),
    fpl_avg_5: avg(computed, "fpl",  5),
    fdrx_3:    avg(computed, "fdrx", 3),
    fdrx_5:    avg(computed, "fdrx", 5),
    readable:  computed.slice(0, 3).map(x => x.readable).join(" "),
  };
}

function buildTeamForm(teams, finished) {
  const form = {};
  teams.forEach(team => {
    const results = finished
      .filter(f => f.team_h === team.id || f.team_a === team.id)
      .sort((a, b) => b.event - a.event).slice(0, 5);
    let pts = 0, w = 0, d = 0, l = 0;
    results.forEach(f => {
      const isHome = f.team_h === team.id;
      const gf = isHome ? f.team_h_score : f.team_a_score;
      const ga = isHome ? f.team_a_score : f.team_h_score;
      if (gf > ga)        { pts += 3; w++; }
      else if (gf === ga) { pts += 1; d++; }
      else                { l++; }
    });
    form[team.id] = {
      pts, w, d, l,
      label: pts >= 13 ? "EXCELLENT" : pts >= 9 ? "GOOD" : pts >= 5 ? "AVERAGE" : "POOR",
    };
  });
  return form;
}

function writeFDRCalendar(ss, teams, upcoming, teamForm, currentGW) {
  const sheet = getOrCreateSheet(ss, "FDR_CALENDAR");
  sheet.clearContents(); sheet.clearFormats();
  const tMap = {};
  teams.forEach(t => tMap[t.id] = t.short_name);
  const gwList = [...new Set(
    upcoming.filter(f => f.event >= currentGW).map(f => f.event)
  )].sort((a, b) => a - b).slice(0, 10);
  const headers = ["TEAM","FORM",...gwList.map(g => "GW" + g)];
  const fdrColors = { 1:"#00cc44", 2:"#66dd66", 3:"#ffcc00", 4:"#ff8833", 5:"#ff3333" };
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  teams.forEach((team, rowIdx) => {
    const row = [team.short_name, teamForm[team.id]?.label || "?"];
    const fdrRow = [];
    gwList.forEach(gw => {
      const f = upcoming.find(x => x.event === gw &&
        (x.team_h === team.id || x.team_a === team.id));
      if (!f) { row.push("BGW"); fdrRow.push(null); return; }
      const isHome = f.team_h === team.id;
      const opp    = isHome ? tMap[f.team_a] : tMap[f.team_h];
      const fdr    = isHome ? f.team_h_difficulty : f.team_a_difficulty;
      row.push(opp + "(" + (isHome?"H":"A") + ")[" + fdr + "]");
      fdrRow.push(fdr);
    });
    sheet.getRange(rowIdx + 2, 1, 1, row.length).setValues([row]);
    fdrRow.forEach((fdr, colIdx) => {
      if (fdr === null) return;
      sheet.getRange(rowIdx + 2, colIdx + 3).setBackground(fdrColors[fdr] || "#ffffff");
    });
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  Logger.log("✓ FDR Calendar written");
}


// ============================================================
// 4. DATA — NEWS SCOUT
// ============================================================

function runNewsScout() {
  Logger.log("=== NEWS SCOUT START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) { Logger.log("❌ Bootstrap failed"); return; }

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap  = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  // FPL Official injuries
  const injuryNews = boot.elements
    .filter(p => p.news && p.news.trim() !== "")
    .map(p => ({
      name:     p.web_name,
      team:     teamMap[p.team] || String(p.team),
      position: posMap[p.element_type] || "?",
      price:    +(p.now_cost / 10).toFixed(1),
      status:   statusLabel(p.status),
      news:     p.news,
      chance:   p.chance_of_playing_next_round !== null
                  ? p.chance_of_playing_next_round + "%" : "Unknown",
      source:   "FPL Official",
      category: p.status === "i" ? "INJURY" : p.status === "s" ? "SUSPENDED" :
                p.status === "d" ? "DOUBTFUL" : "NEWS",
      impact:   p.status === "i" ? "SELL/AVOID" : p.status === "s" ? "BENCH/SELL" :
                p.status === "d" ? "MONITOR" : "NOTE",
      updated:  new Date(),
    }))
    .sort((a, b) => {
      const order = { INJURY:0, SUSPENDED:1, DOUBTFUL:2, NEWS:3 };
      return (order[a.category] || 3) - (order[b.category] || 3);
    });

  // RSS feeds
  const rssFeeds = [
    { name:"BBC Sport",  url:"https://feeds.bbci.co.uk/sport/football/rss.xml" },
    { name:"Sky Sports", url:"https://www.skysports.com/rss/12040" },
  ];
  const rssItems = [];
  rssFeeds.forEach(feed => {
    try {
      const res = UrlFetchApp.fetch(feed.url, {
        headers: { "User-Agent":"Mozilla/5.0" }, muteHttpExceptions:true,
      });
      if (res.getResponseCode() !== 200) return;
      rssItems.push(...parseRSS(res.getContentText(), feed.name));
    } catch(e) { Logger.log("⚠ " + feed.name + ": " + e.message); }
  });

  const playerNames = boot.elements.filter(p => p.minutes > 0)
    .map(p => p.web_name.toLowerCase());
  const relevantRSS = rssItems.filter(item => {
    const text = (item.title + " " + item.description).toLowerCase();
    return playerNames.some(n => n.length > 3 && text.includes(n)) || isFootballRelevant(text);
  }).slice(0, 30);

  // เขียน NEWS sheet
  const sheet = getOrCreateSheet(ss, "NEWS");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;

  sheet.getRange(row, 1).setValue("FPL OFFICIAL — INJURY / SUSPENSION / DOUBT")
       .setBackground("#1c2a50").setFontColor("#ff2d55").setFontWeight("bold").setFontSize(11);
  row++;
  const injHeaders = ["NAME","TEAM","POS","STATUS","CHANCE","IMPACT","NEWS","PRICE","UPDATED"];
  sheet.getRange(row, 1, 1, injHeaders.length).setValues([injHeaders])
       .setBackground("#2a1530").setFontColor("#ffd60a").setFontWeight("bold");
  row++;

  if (injuryNews.length > 0) {
    const injRows = injuryNews.map(n => [
      n.name, n.team, n.position, n.status, n.chance, n.impact, n.news, n.price, n.updated,
    ]);
    sheet.getRange(row, 1, injRows.length, injHeaders.length).setValues(injRows);
    injuryNews.forEach((n, i) => {
      const bg = ["INJURY","SUSPENDED"].includes(n.category) ? "#f8d7da" :
                 n.category === "DOUBTFUL" ? "#fff3cd" : "#d4edda";
      sheet.getRange(row + i, 1, 1, injHeaders.length).setBackground(bg);
    });
    row += injRows.length;
  }

  row += 2;
  sheet.getRange(row, 1).setValue("TRANSFER / FORM NEWS (RSS)")
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(11);
  row++;
  const rssHeaders = ["CATEGORY","SOURCE","TITLE","DESCRIPTION","PUBLISHED"];
  sheet.getRange(row, 1, 1, rssHeaders.length).setValues([rssHeaders])
       .setBackground("#0c1830").setFontColor("#00f5ff").setFontWeight("bold");
  row++;
  if (relevantRSS.length > 0) {
    sheet.getRange(row, 1, relevantRSS.length, rssHeaders.length)
         .setValues(relevantRSS.map(n => [
           n.category, n.source, n.title.slice(0,100), n.description.slice(0,150), n.pubDate,
         ]));
  }

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, 9);
  logRun(ss, "NewsScout", injuryNews.length + " injuries | " + relevantRSS.length + " RSS", "SUCCESS");
  Logger.log("=== NEWS SCOUT DONE ===");
}

function parseRSS(xml, sourceName) {
  const items  = [];
  const blocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
  blocks.forEach(block => {
    const title = extractXML(block, "title");
    const desc  = extractXML(block, "description");
    const date  = extractXML(block, "pubDate") || extractXML(block, "dc:date");
    if (!title) return;
    const text = (title + " " + desc).toLowerCase();
    const cat  = text.includes("injur") || text.includes("ruled out") ? "INJURY" :
                 text.includes("transfer") || text.includes("sign")   ? "TRANSFER" :
                 text.includes("return")  || text.includes("back")    ? "RETURN" :
                 text.includes("ban")     || text.includes("suspend")  ? "SUSPEND" : "GENERAL";
    items.push({ source:sourceName, title:cleanXML(title), description:cleanXML(desc),
                 pubDate: date ? new Date(date) : new Date(), category:cat });
  });
  return items;
}

function extractXML(xml, tag) {
  const m = xml.match(new RegExp(
    "<" + tag + "[^>]*><!\\[CDATA\\[[\\s\\S]*?\\]\\]><\\/" + tag + ">|" +
    "<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"
  ));
  if (!m) return "";
  return m[0].replace(/<[^>]+>/g,"").replace(/\[CDATA\[|\]\]/g,"").trim();
}

function cleanXML(str) {
  return (str||"").replace(/<[^>]+>/g," ")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
}

function isFootballRelevant(text) {
  return ["premier league","injury","transfer","return","ban","suspended","goal","assist"]
    .some(k => text.includes(k));
}


// ============================================================
// 5. DATA — SQUAD TRACKER
// ============================================================

function runSquadTracker() {
  Logger.log("=== SQUAD TRACKER START ===");
  const ss      = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot    = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const entry   = fetchJSON("https://fantasy.premierleague.com/api/entry/" + CONFIG.FPL_TEAM_ID + "/");
  const history = fetchJSON("https://fantasy.premierleague.com/api/entry/" + CONFIG.FPL_TEAM_ID + "/history/");
  if (!boot || !entry || !history) { Logger.log("❌ Fetch failed"); return; }

  const playerMap = {};
  boot.elements.forEach(e => playerMap[e.id] = e);
  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap  = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };
  const CHIP_NAME = { bboost:"BB", "3xc":"TC", freehit:"FH", wildcard:"WC" };

  const currentGW = (
    boot.events.find(e => e.is_next)    ||
    boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;

  let picks = null, picksGW = currentGW;
  for (let gw = currentGW; gw >= currentGW - 2; gw--) {
    const data = fetchJSON(
      "https://fantasy.premierleague.com/api/entry/" + CONFIG.FPL_TEAM_ID +
      "/event/" + gw + "/picks/"
    );
    if (data?.picks) { picks = data; picksGW = gw; break; }
  }
  if (!picks) { Logger.log("❌ No picks data"); return; }

  const usedCodes = (history.chips || []).map(c => c.name);
  const wcCount   = usedCodes.filter(c => c === "wildcard").length;
  const chipsUsed = (history.chips || []).map(c =>
    (CHIP_NAME[c.name] || c.name) + "@GW" + c.event);
  const chipsLeft = [
    ...(!usedCodes.includes("bboost")  ? ["BB"] : []),
    ...(!usedCodes.includes("3xc")     ? ["TC"] : []),
    ...(!usedCodes.includes("freehit") ? ["FH"] : []),
    ...(wcCount < 2 ? ["WC×" + (2 - wcCount)] : []),
  ];

  const bank       = +(entry.last_deadline_bank  / 10).toFixed(1);
  const squadValue = +(entry.last_deadline_value / 10).toFixed(1);
  const gwHistory  = history.current || [];
  const latestGW   = gwHistory[gwHistory.length - 1] || {};

  const allPicks = picks.picks.map(pick => {
    const p = playerMap[pick.element] || {};
    return {
      slot:       pick.position,
      is_starting: pick.position <= 11,
      name:       p.web_name || "ID:" + pick.element,
      team:       teamMap[p.team] || "?",
      position:   posMap[p.element_type] || "?",
      price:      +((p.now_cost || 0) / 10).toFixed(1),
      total_pts:  p.total_points || 0,
      status:     statusLabel(p.status),
      news:       p.news || "",
      is_captain: pick.is_captain || false,
      is_vice:    pick.is_vice_captain || false,
    };
  });

  const starting = allPicks.filter(p => p.is_starting);
  const bench    = allPicks.filter(p => !p.is_starting);
  const captain  = allPicks.find(p => p.is_captain);
  const vice     = allPicks.find(p => p.is_vice);

  // เขียน SQUAD sheet
  const sheet = getOrCreateSheet(ss, "SQUAD");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;

  sheet.getRange(row, 1, 1, 2).merge()
       .setValue("APEX SQUAD — " + entry.name)
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(12);
  sheet.setRowHeight(row, 32);
  row++;

  const summaryData = [
    ["Manager",      entry.player_first_name + " " + entry.player_last_name],
    ["Overall Rank", (entry.summary_overall_rank || 0).toLocaleString()],
    ["Total Points", entry.summary_overall_points || 0],
    ["GW" + (latestGW.event||"?") + " Points", latestGW.points || 0],
    ["Squad Value",  "£" + squadValue + "m"],
    ["In The Bank",  "£" + bank + "m"],
    ["Captain",      captain?.name || "?"],
    ["Vice Captain", vice?.name    || "?"],
    ["Chips Used",   chipsUsed.join(" | ") || "None"],
    ["Chips Left",   chipsLeft.join(" | ") || "None"],
    ["Picks GW",     picksGW],
  ];
  sheet.getRange(row, 1, summaryData.length, 2).setValues(summaryData);
  sheet.getRange(row, 1, summaryData.length, 1).setFontWeight("bold").setFontColor("#7a8fba");
  sheet.getRange(row, 1, summaryData.length, 2).setBackground("#0c1225")
       .setBorder(true,true,true,true,true,true);
  row += summaryData.length + 2;

  const sqHeaders = ["SLOT","NAME","TEAM","POS","PRICE","TOTAL_PTS","FLAGS"];

  // Starting XI
  row = writeSectionHeader(sheet, row, "STARTING XI", "#1c2a50", "#00ff9d");
  sheet.getRange(row, 1, 1, sqHeaders.length).setValues([sqHeaders])
       .setBackground("#0f1830").setFontColor("#c5d4f0").setFontWeight("bold");
  row++;
  starting.forEach((p, i) => {
    const isMe = p.is_captain || p.is_vice;
    const bg   = p.is_captain ? "#1a2500" : "#0c1225";
    const fc   = p.is_captain ? "#ffd60a" : "#c5d4f0";
    sheet.getRange(row, 1, 1, 7).setValues([[
      p.slot, p.name, p.team, p.position, "£"+p.price+"m", p.total_pts,
      (p.is_captain?"[C]":p.is_vice?"[V]":"") + (p.status!=="AVAILABLE"?" ⚠"+p.status:""),
    ]]).setBackground(bg).setFontColor(fc);
    row++;
  });
  row++;

  // Bench
  row = writeSectionHeader(sheet, row, "BENCH", "#1c2a50", "#7a8fba");
  sheet.getRange(row, 1, 1, sqHeaders.length).setValues([sqHeaders])
       .setBackground("#0f1830").setFontColor("#7a8fba").setFontWeight("bold");
  row++;
  bench.forEach(p => {
    sheet.getRange(row, 1, 1, 7).setValues([[
      p.slot, p.name, p.team, p.position, "£"+p.price+"m", p.total_pts,
      p.status !== "AVAILABLE" ? "⚠"+p.status : "",
    ]]).setBackground("#0a0a0a").setFontColor("#7a8fba");
    row++;
  });
  row++;

  // GW History
  row = writeSectionHeader(sheet, row, "GW HISTORY (Last 10)", "#1c2a50", "#00f5ff");
  const histHeaders = ["GW","POINTS","NET_PTS","TRANSFERS","HIT_COST","OVERALL_RANK","CHIP"];
  sheet.getRange(row, 1, 1, histHeaders.length).setValues([histHeaders])
       .setBackground("#0f1830").setFontColor("#c5d4f0").setFontWeight("bold");
  row++;
  gwHistory.slice(-10).reverse().forEach(g => {
    const hit     = parseInt(g.event_transfers_cost || 0);
    const netPts  = g.points - hit;
    const pace    = CONFIG.TARGET_PTS / 38;
    const bg      = netPts >= pace ? "#001a00" : netPts < pace * 0.8 ? "#1a0000" : "#0a0a0a";
    sheet.getRange(row, 1, 1, 7).setValues([[
      "GW"+g.event, g.points, netPts, g.event_transfers||0,
      hit ? "-"+hit : 0, (g.overall_rank||0).toLocaleString(),
      g.chip ? (CHIP_NAME[g.chip]||g.chip) : "",
    ]]).setBackground(bg).setFontColor("#c5d4f0");
    if (hit > 0) sheet.getRange(row, 5).setFontColor("#ff2d55");
    row++;
  });

  sheet.autoResizeColumns(1, 7);
  logRun(ss, "SquadTracker", entry.name + " | Rank: " +
    (entry.summary_overall_rank||0).toLocaleString(), "SUCCESS");
  Logger.log("=== SQUAD TRACKER DONE ===");
}

/**
 * คำนวณ xPts โดยพิจารณาช่วง GW 1-5 ให้ใช้ข้อมูลจากฤดูกาล 25/26 เป็นหลัก
 */
// ============================================================
// 6. DATA — MINI-LEAGUE
// ============================================================

function runMiniLeague() {
  Logger.log("=== MINI-LEAGUE START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;

  const playerMap = {};
  boot.elements.forEach(e => {
    playerMap[e.id] = {
      name:      e.web_name, team: e.team,
      pos:       e.element_type, price: +(e.now_cost/10).toFixed(1),
      total_pts: e.total_points, own_pct: +e.selected_by_percent,
    };
  });
  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  const currentGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;
  const picksGW = currentGW > 1 ? currentGW - 1 : currentGW;

  const leagueData = fetchJSON(
    "https://fantasy.premierleague.com/api/leagues-classic/" + CONFIG.LEAGUE_ID + "/standings/"
  );
  if (!leagueData) { Logger.log("❌ League fetch failed"); return; }

  const standings    = leagueData.standings?.results || [];
  const managerPicks = [];
  const playerOwnership = {};

  standings.forEach((mgr, i) => {
    Utilities.sleep(300);
    const picks = fetchJSON(
      "https://fantasy.premierleague.com/api/entry/" +
      mgr.entry + "/event/" + picksGW + "/picks/"
    );
    if (!picks?.picks) return;
    const mgrData = {
      entry_id:  mgr.entry, name: mgr.entry_name, manager: mgr.player_name,
      rank:      mgr.rank,  total_pts: mgr.total, gw_pts: mgr.event_total,
      picks:     picks.picks.map(p => p.element),
      captain:   picks.picks.find(p => p.is_captain)?.element,
      chip:      picks.active_chip || "",
    };
    managerPicks.push(mgrData);
    picks.picks.forEach(p => {
      if (!playerOwnership[p.element]) playerOwnership[p.element] = { count:0, managers:[] };
      playerOwnership[p.element].count++;
      playerOwnership[p.element].managers.push(mgr.entry_name);
    });
    Logger.log("  [" + (i+1) + "/" + standings.length + "] " + mgr.entry_name);
  });

  const myPicks    = managerPicks.find(m => String(m.entry_id) === String(CONFIG.FPL_TEAM_ID));
  const myPlayerIds = new Set(myPicks?.picks || []);
  const total      = managerPicks.length;

  const ownershipTable = Object.entries(playerOwnership).map(([id, data]) => {
    const pl     = playerMap[parseInt(id)] || {};
    const ownPct = total > 0 ? +((data.count / total) * 100).toFixed(1) : 0;
    const iOwn   = myPlayerIds.has(parseInt(id));
    return {
      player_id:  parseInt(id),
      name:       pl.name        || "?",
      team:       teamMap[pl.team] || "?",
      pos:        posMap[pl.pos]  || "?",
      price:      pl.price       || 0,
      total_pts:  pl.total_pts   || 0,
      league_own: ownPct,
      global_own: pl.own_pct    || 0,
      owned_by_n: data.count,
      i_own:      iOwn ? "YES" : "NO",
      managers:   data.managers.join(", "),
      diff_score: ownPct < 30 ? +(pl.total_pts / Math.max(ownPct, 0.1)).toFixed(1) : 0,
    };
  }).sort((a, b) => b.total_pts - a.total_pts);

  const template     = ownershipTable.filter(p => p.league_own >= 70);
  const differential = ownershipTable.filter(p => p.league_own < 30 && p.total_pts > 80)
    .sort((a,b) => b.diff_score - a.diff_score).slice(0, 20);

  // เขียน MINI_LEAGUE sheet
  const sheet = getOrCreateSheet(ss, "MINI_LEAGUE");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;

  row = writeSectionHeader(sheet, row, "LEAGUE STANDINGS — " + (leagueData.league?.name||""), "#1c2a50", "#ffd60a");
  const sHeaders = ["RANK","TEAM","MANAGER","TOTAL PTS","GW PTS","CAPTAIN","CHIP"];
  sheet.getRange(row, 1, 1, sHeaders.length).setValues([sHeaders])
       .setBackground("#0f1830").setFontColor("#ffd60a").setFontWeight("bold");
  row++;
  managerPicks.sort((a,b) => a.rank - b.rank).forEach((m, i) => {
    const isMe = String(m.entry_id) === String(CONFIG.FPL_TEAM_ID);
    const bg   = isMe ? "#1a2500" : i % 2 === 0 ? "#0c1225" : "#080d1a";
    const fc   = isMe ? "#00ff9d" : "#c5d4f0";
    sheet.getRange(row, 1, 1, 7).setValues([[
      m.rank, m.name, m.manager, m.total_pts, m.gw_pts,
      playerMap[m.captain]?.name || "?", m.chip || "-",
    ]]).setBackground(bg).setFontColor(fc);
    if (isMe) sheet.getRange(row, 1, 1, 7).setFontWeight("bold");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "TEMPLATE — ทุกคนในลีกถือ (>=70%)", "#1a0808", "#ff2d55");
  const tplH = ["NAME","TEAM","POS","PRICE","TOTAL PTS","LEAGUE OWN%","I OWN?"];
  sheet.getRange(row, 1, 1, tplH.length).setValues([tplH])
       .setBackground("#1a0808").setFontColor("#ff6b6b").setFontWeight("bold");
  row++;
  template.forEach(p => {
    sheet.getRange(row, 1, 1, 7).setValues([[
      p.name, p.team, p.pos, "£"+p.price+"m", p.total_pts, p.league_own+"%", p.i_own,
    ]]).setBackground(p.i_own==="YES"?"#0a1a0a":"#1a0808")
       .setFontColor(p.i_own==="YES"?"#00ff9d":"#ff6b6b");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "DIFFERENTIAL — คะแนนสูง ไม่ค่อยมีคนถือ (<30%)", "#001a00", "#00ff9d");
  const difH = ["NAME","TEAM","POS","PRICE","TOTAL PTS","LEAGUE OWN%","DIFF SCORE","I OWN?"];
  sheet.getRange(row, 1, 1, difH.length).setValues([difH])
       .setBackground("#001a00").setFontColor("#00ff9d").setFontWeight("bold");
  row++;
  differential.forEach(p => {
    sheet.getRange(row, 1, 1, 8).setValues([[
      p.name, p.team, p.pos, "£"+p.price+"m", p.total_pts,
      p.league_own+"%", p.diff_score, p.i_own,
    ]]).setBackground(p.i_own==="YES"?"#0f2a0f":"#001a00")
       .setFontColor(p.i_own==="YES"?"#ffd60a":"#00ff9d");
    row++;
  });

  // Captain analysis
  row++;
  row = writeSectionHeader(sheet, row, "CAPTAIN CHOICES", "#1a1500", "#ffd60a");
  const capCount = {};
  managerPicks.forEach(m => {
    const n = playerMap[m.captain]?.name || "Unknown";
    capCount[n] = (capCount[n] || 0) + 1;
  });
  sheet.getRange(row, 1, 1, 3).setValues([["CAPTAIN","COUNT","% IN LEAGUE"]])
       .setBackground("#1a1500").setFontColor("#ffd60a").setFontWeight("bold");
  row++;
  Object.entries(capCount).sort((a,b) => b[1]-a[1]).forEach(([name, count]) => {
    sheet.getRange(row, 1, 1, 3).setValues([[
      name, count, +((count/total)*100).toFixed(1)+"%",
    ]]).setBackground("#0f1000").setFontColor("#c5d4f0");
    row++;
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 8);

  // บันทึก context สำหรับ Quant + Tactical Mode (ข้อ 2)
  const ctxSheet = getOrCreateSheet(ss, "LEAGUE_CONTEXT");
  ctxSheet.clearContents();
  const sortedByRank = [...managerPicks].sort((a,b)=>a.rank-b.rank);
  const myEntry = managerPicks.find(m => String(m.entry_id)===String(CONFIG.FPL_TEAM_ID));
  const myRank  = myEntry?.rank || "?";
  const myPts   = myEntry?.total_pts || 0;
  const topMgr  = sortedByRank[0];
  const leaderPts  = topMgr?.total_pts || 0;
  const gapToLeader = leaderPts - myPts; // >0 = ตามหลัง, <=0 = นำอยู่
  const amILeading  = gapToLeader <= 0 ? "YES" : "NO";

  ctxSheet.getRange(1, 1, 10, 2).setValues([
    ["GW",                picksGW],
    ["My Rank",           myRank],
    ["League Leader",     (topMgr?.name||"?") + " (" + leaderPts + "pts)"],
    ["Top Differentials", differential.slice(0,5).map(p=>p.name+"("+p.league_own+"%)").join(", ")],
    ["Template Players",  template.slice(0,5).map(p=>p.name).join(", ")],
    ["Total Managers",    total],
    // ── เพิ่มสำหรับ Tactical Mode (ข้อ 2) ──────────────
    ["My Total Pts",      myPts],
    ["League Leader Pts", leaderPts],
    ["Gap To Leader",     gapToLeader],   // >0 = ตามหลัง (pts), <=0 = นำอยู่
    ["Am I Leading",      amILeading],
  ]);

  logRun(ss, "MiniLeague", total + " managers | " + differential.length + " diffs", "SUCCESS");
  Logger.log("=== MINI-LEAGUE DONE ===");
}


// ============================================================
// 7. DATA — HISTORICAL DATA & BASELINE
// ============================================================

function runHistoricalData() {
  Logger.log("=== HISTORICAL DATA START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap  = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };
  const KEEP_SEASONS = CONFIG.KEEP_SEASONS;

  const top100 = [];
  [1,2,3,4].forEach(posId => {
    boot.elements.filter(p => p.minutes > 0 && p.element_type === posId)
      .sort((a,b) => b.total_points - a.total_points)
      .slice(0, CONFIG.QUOTA[posId])
      .forEach(p => top100.push(p));
  });
  Logger.log("✓ Top 100 selected");

  const allHistory = [];
  top100.forEach((p, i) => {
    Utilities.sleep(300);
    if (i % 10 === 0) Logger.log("  " + i + "/" + top100.length + "...");
    const summary = fetchJSON("https://fantasy.premierleague.com/api/element-summary/" + p.id + "/");
    if (!summary) return;
    const meta = {
      id: p.id, name: p.web_name, team: teamMap[p.team]||"?",
      pos: posMap[p.element_type]||"?", price_now: +(p.now_cost/10).toFixed(1),
    };
    // Past seasons (3 ซีซัน)
    (summary.history_past || []).filter(s => KEEP_SEASONS.includes(s.season_name))
      .forEach(s => {
        allHistory.push({ ...meta, data_type:"PAST_SEASON", season:s.season_name, gw:"",
          total_pts: s.total_points, minutes: s.minutes, goals: s.goals_scored,
          assists: s.assists, clean_sheets: s.clean_sheets, bonus: s.bonus, bps: s.bps,
          price_start: s.start_cost ? +(s.start_cost/10).toFixed(1) : "",
          price_end:   s.end_cost   ? +(s.end_cost  /10).toFixed(1) : "",
          ppm: s.end_cost && s.total_points ? +(s.total_points/(s.end_cost/10)).toFixed(2) : "",
          avg_pts_gw: s.total_points ? +(s.total_points/38).toFixed(2) : "",
          xg:"", xa:"", xgi:"",
        });
      });
    // Current GW (5 นัดล่าสุด)
    (summary.history || []).sort((a,b) => b.round-a.round).slice(0,5).forEach(gw => {
      allHistory.push({ ...meta, data_type:"CURRENT_GW", season:CONFIG.CURRENT_SEASON, gw:gw.round,
        total_pts: gw.total_points, minutes: gw.minutes, goals: gw.goals_scored,
        assists: gw.assists, clean_sheets: gw.clean_sheets, bonus: gw.bonus, bps: gw.bps,
        price_start: "", price_end: +(gw.value/10).toFixed(1), ppm:"", avg_pts_gw:"",
        xg:  +parseFloat(gw.expected_goals            ||0).toFixed(2),
        xa:  +parseFloat(gw.expected_assists           ||0).toFixed(2),
        xgi: +parseFloat(gw.expected_goal_involvements ||0).toFixed(2),
      });
    });
  });

  const histSheet = getOrCreateSheet(ss, "HISTORY");
  histSheet.clearContents(); histSheet.clearFormats();
  const hH = ["NAME","TEAM","POS","DATA_TYPE","SEASON","GW",
    "TOTAL_PTS","MINUTES","GOALS","ASSISTS","CLEAN_SHEETS","BONUS","BPS",
    "PRICE_START","PRICE_END","PPM","AVG_PTS_GW","XG","XA","XGI"];
  histSheet.getRange(1,1,1,hH.length).setValues([hH])
           .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  if (allHistory.length > 0) {
    histSheet.getRange(2,1,allHistory.length,hH.length)
             .setValues(allHistory.map(h => [
               h.name,h.team,h.pos,h.data_type,h.season,h.gw,
               h.total_pts,h.minutes,h.goals,h.assists,h.clean_sheets,
               h.bonus,h.bps,h.price_start,h.price_end,h.ppm,h.avg_pts_gw,
               h.xg,h.xa,h.xgi,
             ]));
  }
  histSheet.setFrozenRows(1);
  histSheet.autoResizeColumns(1, hH.length);

  buildHistoricalBaseline(ss, allHistory);
  logRun(ss, "HistoricalData", top100.length + " players | " + allHistory.length + " rows", "SUCCESS");
  Logger.log("=== HISTORICAL DATA DONE ===");
}

function buildHistoricalBaseline(ss, allHistory) {
  const WEIGHTS = CONFIG.HIST_WEIGHTS;
  const byPlayer = {};
  allHistory.filter(h => h.data_type === "PAST_SEASON").forEach(h => {
    if (!byPlayer[h.name]) byPlayer[h.name] = { meta:h, seasons:[] };
    byPlayer[h.name].seasons.push(h);
  });
  const baseline = Object.values(byPlayer).map(({ meta, seasons }) => {
    let wPts=0,wPPM=0,wGoals=0,wAssists=0,wCS=0,totalW=0;
    seasons.forEach(s => {
      const w = WEIGHTS[s.season] || 0.05;
      if (s.total_pts) wPts     += s.total_pts * w;
      if (s.ppm)       wPPM     += s.ppm       * w;
      if (s.goals)     wGoals   += s.goals      * w;
      if (s.assists)   wAssists += s.assists    * w;
      if (s.clean_sheets) wCS   += s.clean_sheets * w;
      totalW += w;
    });
    const norm = totalW > 0 ? 1/totalW : 0;
    const last = seasons.sort((a,b) => b.season.localeCompare(a.season))[0];
    return {
      name:           meta.name, team:meta.team, pos:meta.pos, price_now:meta.price_now,
      seasons_count:  seasons.length,
      seasons_list:   seasons.map(s => s.season).join("|"),
      hist_avg_pts:   +(wPts     * norm).toFixed(1),
      hist_ppm:       +(wPPM     * norm).toFixed(2),
      hist_goals:     +(wGoals   * norm).toFixed(1),
      hist_assists:   +(wAssists * norm).toFixed(1),
      hist_cs:        +(wCS      * norm).toFixed(1),
      latest_season:  last.season, latest_pts: last.total_pts||0, latest_ppm: last.ppm||0,
      peak_pts:       Math.max(...seasons.map(s => s.total_pts||0)),
      consistency:    +(seasons.length/3).toFixed(2),
      potential:      (wPts*norm)>=150?"HIGH":(wPts*norm)>=100?"MEDIUM":"LOW",
    };
  }).sort((a,b) => b.hist_avg_pts - a.hist_avg_pts);

  const bSheet = getOrCreateSheet(ss, "BASELINE_26_27");
  bSheet.clearContents(); bSheet.clearFormats();
  const bH = ["NAME","TEAM","POS","PRICE_NOW","SEASONS","SEASONS_LIST",
    "HIST_AVG_PTS","HIST_PPM","HIST_GOALS","HIST_ASSISTS","HIST_CS",
    "LATEST_SEASON","LATEST_PTS","LATEST_PPM","PEAK_PTS","CONSISTENCY","POTENTIAL"];
  bSheet.getRange(1,1,1,bH.length).setValues([bH])
        .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  if (baseline.length > 0) {
    const bRows = baseline.map(p => [
      p.name,p.team,p.pos,p.price_now,p.seasons_count,p.seasons_list,
      p.hist_avg_pts,p.hist_ppm,p.hist_goals,p.hist_assists,p.hist_cs,
      p.latest_season,p.latest_pts,p.latest_ppm,p.peak_pts,p.consistency,p.potential,
    ]);
    bSheet.getRange(2,1,bRows.length,bH.length).setValues(bRows);
    const potCol = bH.indexOf("POTENTIAL") + 1;
    bRows.forEach((r,i) => {
      const cell = bSheet.getRange(i+2, potCol);
      if (r[potCol-1]==="HIGH")   cell.setBackground("#003300").setFontColor("#00ff9d");
      if (r[potCol-1]==="MEDIUM") cell.setBackground("#1a1500").setFontColor("#ffd60a");
      if (r[potCol-1]==="LOW")    cell.setBackground("#1a0000").setFontColor("#ff6b6b");
    });
  }
  bSheet.setFrozenRows(1);
  bSheet.autoResizeColumns(1, bH.length);
  Logger.log("✓ Baseline built: " + baseline.length + " players");
}


// ============================================================
// 8. DATA — TOP MANAGER STRATEGY
// ============================================================

function runTopManagerStrategy() {
  Logger.log("=== TOP MANAGER STRATEGY START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;

  const playerMap = {};
  boot.elements.forEach(e => playerMap[e.id] = e.web_name);
  const CHIP_NAME = { bboost:"BB", "3xc":"TC", freehit:"FH", wildcard:"WC" };

  const currentGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;

  const overall = fetchJSON(
    "https://fantasy.premierleague.com/api/leagues-classic/314/standings/?page_standings=1"
  );
  if (!overall) { Logger.log("❌ Overall league failed"); return; }

  const top10       = (overall.standings?.results || []).slice(0, 10);
  const managerData = [];

  top10.forEach((mgr, idx) => {
    Logger.log("[" + (idx+1) + "/10] " + mgr.entry_name + "...");
    Utilities.sleep(500);
    const history   = fetchJSON("https://fantasy.premierleague.com/api/entry/" + mgr.entry + "/history/");
    Utilities.sleep(300);
    const transfers = fetchJSON("https://fantasy.premierleague.com/api/entry/" + mgr.entry + "/transfers/");
    if (!history) return;

    const gwHistory   = (history.current || []).map(gw => ({
      gw: gw.event, points: gw.points,
      net_points: gw.points - (gw.event_transfers_cost||0),
      transfers: gw.event_transfers||0, hit_cost: gw.event_transfers_cost||0,
      overall_rank: gw.overall_rank, chip: gw.chip ? (CHIP_NAME[gw.chip]||gw.chip) : "",
    }));
    const chipsUsed   = (history.chips||[]).map(c => ({ chip:CHIP_NAME[c.name]||c.name, gw:c.event }));
    const xferHistory = (transfers||[]).slice(0,20).map(t => ({
      gw: t.event,
      sold:     playerMap[t.element_out] || "ID:"+t.element_out,
      bought:   playerMap[t.element_in]  || "ID:"+t.element_in,
      cost_out: +((t.element_out_cost||0)/10).toFixed(1),
      cost_in:  +((t.element_in_cost ||0)/10).toFixed(1),
    }));

    const captainHistory = [];
    for (let gw = currentGW-1; gw >= Math.max(1, currentGW-5); gw--) {
      Utilities.sleep(200);
      const picks = fetchJSON(
        "https://fantasy.premierleague.com/api/entry/" + mgr.entry + "/event/" + gw + "/picks/"
      );
      if (picks?.picks) {
        const cap  = picks.picks.find(p => p.is_captain);
        const vice = picks.picks.find(p => p.is_vice_captain);
        captainHistory.push({
          gw, captain: cap  ? playerMap[cap.element]  ||"?" : "?",
          vice:        vice ? playerMap[vice.element] ||"?" : "?",
        });
      }
    }

    const avgPts    = gwHistory.length ? +(gwHistory.reduce((s,g)=>s+g.net_points,0)/gwHistory.length).toFixed(1) : 0;
    const totalHits = gwHistory.filter(g => g.hit_cost > 0).length;

    managerData.push({
      rank:mgr.rank, entry_id:mgr.entry, team_name:mgr.entry_name,
      manager_name:mgr.player_name, total_pts:mgr.total,
      avg_pts_gw:avgPts, total_hits:totalHits,
      chips_used:chipsUsed, gw_history:gwHistory,
      captain_history:captainHistory, transfers:xferHistory,
    });
    Logger.log("  ✓ avg:" + avgPts + " chips:" + chipsUsed.map(c=>c.chip+"@"+c.gw).join(","));
  });

  // เขียน TOP_MANAGERS sheet
  const sheet = getOrCreateSheet(ss, "TOP_MANAGERS");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;

  row = writeSectionHeader(sheet, row, "TOP 10 GLOBAL MANAGERS", "#1c2a50", "#ffd60a");
  sheet.getRange(row, 1, 1, 7).setValues([["RANK","TEAM","MANAGER","TOTAL PTS","AVG PTS/GW","HITS","CHIPS USED"]])
       .setBackground("#0f1830").setFontColor("#ffd60a").setFontWeight("bold");
  row++;
  managerData.forEach((m, i) => {
    const chips = m.chips_used.map(c => c.chip+"@GW"+c.gw).join(" | ");
    sheet.getRange(row, 1, 1, 7).setValues([[
      m.rank, m.team_name, m.manager_name, m.total_pts, m.avg_pts_gw, m.total_hits, chips||"None",
    ]]).setBackground(i===0?"#1a1500":i%2===0?"#0c1225":"#080d1a")
       .setFontColor(i===0?"#ffd60a":"#c5d4f0");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "CHIP TIMING", "#0a1a0a", "#00ff9d");
  sheet.getRange(row, 1, 1, 6).setValues([["MANAGER","TC GW","BB GW","FH GW","WC1 GW","WC2 GW"]])
       .setBackground("#0a1a0a").setFontColor("#00ff9d").setFontWeight("bold");
  row++;
  managerData.forEach((m, i) => {
    const tc  = m.chips_used.find(c => c.chip==="TC");
    const bb  = m.chips_used.find(c => c.chip==="BB");
    const fh  = m.chips_used.find(c => c.chip==="FH");
    const wcs = m.chips_used.filter(c => c.chip==="WC");
    sheet.getRange(row, 1, 1, 6).setValues([[
      m.team_name,
      tc  ? "GW"+tc.gw  : "-", bb  ? "GW"+bb.gw  : "-",
      fh  ? "GW"+fh.gw  : "-", wcs[0] ? "GW"+wcs[0].gw : "-",
      wcs[1] ? "GW"+wcs[1].gw : "-",
    ]]).setBackground(i%2===0?"#0a1a0a":"#080d0a").setFontColor("#c5d4f0");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "CAPTAIN PATTERN (5 GW)", "#1a1500", "#ffd60a");
  const capGWs = Array.from({length:5}, (_,i) => "GW"+(currentGW-1-i));
  sheet.getRange(row, 1, 1, capGWs.length+1).setValues([["MANAGER",...capGWs]])
       .setBackground("#1a1500").setFontColor("#ffd60a").setFontWeight("bold");
  row++;
  managerData.forEach((m, i) => {
    const capRow = [m.team_name];
    for (let gw = currentGW-1; gw >= currentGW-5 && gw >= 1; gw--) {
      const pick = m.captain_history.find(c => c.gw===gw);
      capRow.push(pick ? pick.captain : "-");
    }
    sheet.getRange(row, 1, 1, capRow.length).setValues([capRow])
         .setBackground(i%2===0?"#1a1500":"#0f1000").setFontColor("#c5d4f0");
    row++;
  });

  // AI analysis
  const aiAnalysis = analyzeTopManagers(managerData, currentGW);
  if (aiAnalysis) {
    row++;
    row = writeSectionHeader(sheet, row, "AI PATTERN ANALYSIS", "#0a0a1a", "#b44eff");
    sheet.getRange(row, 1, 1, 6).merge()
         .setValue(aiAnalysis)
         .setBackground("#08080f").setFontColor("#c5d4f0")
         .setFontFamily("Courier New").setFontSize(10)
         .setWrap(true).setVerticalAlignment("top");
    sheet.setRowHeight(row, 250);
  }

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 7);
  logRun(ss, "TopManagers", managerData.length + " managers | GW" + currentGW, "SUCCESS");
  Logger.log("=== TOP MANAGER DONE ===");
}

function analyzeTopManagers(managers, currentGW) {
  const summary = managers.map(m => {
    const chips = m.chips_used.map(c => c.chip+"@GW"+c.gw).join(",");
    const caps  = m.captain_history.slice(0,3).map(c => "GW"+c.gw+":"+c.captain).join(",");
    return m.rank+". "+m.team_name+" avg:"+m.avg_pts_gw+" chips:"+(chips||"none")+" caps:"+(caps||"?")+" hits:"+m.total_hits;
  }).join("\n");
  return callGemini(
    "วิเคราะห์ pattern ของ Top 10 FPL managers โลก GW"+currentGW+":\n"+summary+
    "\n\n1. CHIP PATTERN\n2. CAPTAIN PATTERN\n3. TRANSFER STYLE\n4. KEY INSIGHT\n5. APPLY TO MY TEAM\nตอบภาษาไทย กระชับ"
  );
}


// ============================================================
// 9. DATA — PRICE PREDICTION
// ============================================================

function runPricePrediction() {
  Logger.log("=== PRICE PREDICTION START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };
  const TOTAL  = CONFIG.TOTAL_MANAGERS;

  const predictions = boot.elements.filter(p => p.minutes > 0).map(p => {
    const ownPct    = parseFloat(p.selected_by_percent || 0);
    const owners    = Math.round((ownPct/100) * TOTAL);
    const tIn       = p.transfers_in_event  || 0;
    const tOut      = p.transfers_out_event || 0;
    const netDelta  = tIn - tOut;
    const netRate   = owners > 0 ? +(netDelta/owners*100).toFixed(3) : 0;
    const currChange = p.cost_change_event || 0;
    let signal, urgency;
    if      (currChange >= 1)  { signal="RISEN";         urgency="ALREADY_RISEN";  }
    else if (currChange <= -1) { signal="FALLEN";        urgency="ALREADY_FALLEN"; }
    else if (netRate >= CONFIG.PRICE_RISE_NOW)  { signal="ABOUT_TO_RISE"; urgency="BUY_NOW";        }
    else if (netRate >= CONFIG.PRICE_RISE_SOON)  { signal="LIKELY_RISE";   urgency="BUY_SOON";       }
    else if (netRate <= CONFIG.PRICE_FALL_NOW)  { signal="ABOUT_TO_FALL"; urgency="SELL_NOW";       }
    else if (netRate <= CONFIG.PRICE_FALL_SOON)  { signal="LIKELY_FALL";   urgency="SELL_SOON";      }
    else                       { signal="STABLE";        urgency="HOLD";           }
    return {
      name:p.web_name, team:teamMap[p.team]||"?", pos:posMap[p.element_type]||"?",
      price:+(p.now_cost/10).toFixed(1), price_change:+(currChange/10).toFixed(1),
      total_pts:p.total_points, ownership:ownPct,
      transfer_in:tIn, transfer_out:tOut, net_delta:netDelta, net_rate:netRate,
      signal, urgency,
    };
  }).sort((a,b) => Math.abs(b.net_rate) - Math.abs(a.net_rate));

  const sheet = getOrCreateSheet(ss, "PRICE_TRACKER");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  row = writeSectionHeader(sheet, row, "PRICE PREDICTION — Net Transfer Velocity", "#1c2a50", "#ffd60a");
  const headers = ["NAME","TEAM","POS","PRICE","PRICE_CHANGE","NET_DELTA","NET_RATE%","SIGNAL","URGENCY"];

  ["BUY NOW / SOON","SELL NOW / SOON"].forEach(label => {
    const isBuy    = label.includes("BUY");
    const filtered = predictions.filter(p =>
      isBuy ? ["ABOUT_TO_RISE","LIKELY_RISE","RISEN"].includes(p.signal)
            : ["ABOUT_TO_FALL","LIKELY_FALL","FALLEN"].includes(p.signal)
    ).slice(0, 15);
    if (!filtered.length) return;
    row = writeSectionHeader(sheet, row, (isBuy?"BUY":"SELL") + " — " + label, isBuy?"#001a00":"#1a0000", isBuy?"#00ff9d":"#ff2d55");
    sheet.getRange(row, 1, 1, headers.length).setValues([headers])
         .setBackground(isBuy?"#002a00":"#2a0000").setFontColor("#c5d4f0").setFontWeight("bold");
    row++;
    filtered.forEach(p => {
      const fc = isBuy ? (p.urgency==="BUY_NOW"?"#00ff9d":"#7aff9d") : (p.urgency==="SELL_NOW"?"#ff2d55":"#ff7a7a");
      sheet.getRange(row, 1, 1, 9).setValues([[
        p.name, p.team, p.pos, "£"+p.price+"m",
        p.price_change>0?"+£"+p.price_change+"m":p.price_change<0?"-£"+Math.abs(p.price_change)+"m":"-",
        p.net_delta>0?"+"+p.net_delta.toLocaleString():p.net_delta.toLocaleString(),
        (p.net_rate>0?"+":"")+p.net_rate+"%", p.signal, p.urgency,
      ]]).setBackground(isBuy?"#001a00":"#1a0000").setFontColor(fc);
      row++;
    });
    row++;
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 9);
  logRun(ss, "PricePrediction", predictions.length + " analyzed", "SUCCESS");
  Logger.log("=== PRICE PREDICTION DONE ===");
}


// ============================================================
// 10. DATA — ROTATION RISK
// ============================================================

function runRotationRisk() {
  Logger.log("=== ROTATION RISK START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  const top100 = [];
  [1,2,3,4].forEach(posId => {
    boot.elements.filter(p => p.minutes>0 && p.element_type===posId)
      .sort((a,b)=>b.total_points-a.total_points).slice(0,CONFIG.QUOTA[posId])
      .forEach(p => top100.push(p));
  });

  const results = [];
  top100.forEach((p, i) => {
    Utilities.sleep(250);
    if (i%20===0) Logger.log("  "+i+"/"+top100.length+"...");
    const summary = fetchJSON("https://fantasy.premierleague.com/api/element-summary/" + p.id + "/");
    if (!summary) return;
    const recent5 = (summary.history||[]).sort((a,b)=>b.round-a.round).slice(0,5);
    if (!recent5.length) return;
    const minutes  = recent5.map(g => g.minutes||0);
    const avg      = minutes.reduce((s,m)=>s+m,0) / minutes.length;
    const sd       = +Math.sqrt(minutes.reduce((s,m)=>s+Math.pow(m-avg,2),0)/minutes.length).toFixed(1);
    const starts   = recent5.filter(g => g.minutes>=45).length;
    const startRate = +(starts/recent5.length*100).toFixed(0);
    const risk     = sd>30||startRate<40?"HIGH":sd>15||startRate<60?"MEDIUM":"LOW";
    const pen      = p.penalties_order                      || 0;
    const corner   = p.corners_and_indirect_freekicks_order || 0;
    const fk       = p.direct_freekicks_order               || 0;
    const first    = [pen,corner,fk].filter(o=>o===1).length;
    const second   = [pen,corner,fk].filter(o=>o===2).length;
    const setpiece = first>=2?"ELITE":first===1?"GOOD":second>=1?"MINOR":"NONE";
    results.push({
      name:p.web_name, team:teamMap[p.team]||"?", pos:posMap[p.element_type]||"?",
      price:+(p.now_cost/10).toFixed(1), total_pts:p.total_points,
      avg_min:+avg.toFixed(0), sd_min:sd, start_rate:startRate,
      recent_min:minutes.join(", "), rotation_risk:risk,
      pen_order:pen, corner_order:corner, fk_order:fk, setpiece,
    });
  });

  const sheet = getOrCreateSheet(ss, "ROTATION_RISK");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  const headers = ["NAME","TEAM","POS","PRICE","TOTAL PTS","AVG MIN","SD","START%","RECENT MINS","SET PIECE"];
  ["HIGH","MEDIUM","LOW"].forEach(risk => {
    const group  = results.filter(p=>p.rotation_risk===risk).sort((a,b)=>b.total_pts-a.total_pts);
    if (!group.length) return;
    const colors = { HIGH:{bg:"#1a0000",fc:"#ff2d55"}, MEDIUM:{bg:"#1a1500",fc:"#ffd60a"}, LOW:{bg:"#001a00",fc:"#00ff9d"} };
    const c = colors[risk];
    row = writeSectionHeader(sheet, row,
      risk==="HIGH"?"HIGH ROTATION RISK":risk==="MEDIUM"?"MEDIUM ROTATION RISK":"LOW ROTATION RISK", c.bg, c.fc);
    sheet.getRange(row,1,1,headers.length).setValues([headers]).setBackground(c.bg).setFontColor(c.fc).setFontWeight("bold");
    row++;
    group.forEach(p => {
      sheet.getRange(row,1,1,10).setValues([[
        p.name,p.team,p.pos,"£"+p.price+"m",p.total_pts,p.avg_min,p.sd_min,p.start_rate+"%",p.recent_min,p.setpiece,
      ]]).setBackground(c.bg).setFontColor("#c5d4f0");
      const spCell = sheet.getRange(row,10);
      if (p.setpiece==="ELITE") spCell.setFontColor("#ffd60a").setFontWeight("bold");
      else if (p.setpiece==="GOOD") spCell.setFontColor("#00ff9d");
      row++;
    });
    row++;
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1,10);
  logRun(ss, "RotationRisk", results.length + " players", "SUCCESS");
  Logger.log("=== ROTATION RISK DONE ===");
}


// ============================================================
// 11. DATA — SEASON TARGET
// ============================================================

function runSeasonTarget() {
  Logger.log("=== SEASON TARGET START ===");
  const ss      = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot    = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const entry   = fetchJSON("https://fantasy.premierleague.com/api/entry/" + CONFIG.FPL_TEAM_ID + "/");
  const history = fetchJSON("https://fantasy.premierleague.com/api/entry/" + CONFIG.FPL_TEAM_ID + "/history/");
  if (!boot || !entry || !history) return;

  const totalManagers    = 10000000;
  const TARGET_RANK      = CONFIG.TARGET_RANK;
  const TOTAL_GW         = CONFIG.TOTAL_GW;
  const TARGET_TOTAL_PTS = CONFIG.TARGET_PTS;

  const currentGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;

  const gwHistory  = history.current || [];
  const gwDone     = gwHistory.length;
  const gwLeft     = TOTAL_GW - gwDone;
  const totalPts   = entry.summary_overall_points || 0;
  const currRank   = entry.summary_overall_rank   || 0;
  const ptsNeeded  = Math.max(0, TARGET_TOTAL_PTS - totalPts);
  const ptsPerGWNeeded = gwLeft > 0 ? +(ptsNeeded/gwLeft).toFixed(1) : 0;
  const avgPtsActual   = gwDone > 0 ? +(totalPts/gwDone).toFixed(1) : 0;
  const onTrack        = avgPtsActual >= ptsPerGWNeeded ? "ON TRACK" : "BEHIND";
  const pace           = +(TARGET_TOTAL_PTS / TOTAL_GW).toFixed(1);

  const gwData = gwHistory.map(gw => {
    const pts     = gw.points || 0;
    const hitCost = parseInt(gw.event_transfers_cost || 0);
    return {
      gw: gw.event, pts, net_pts: pts - hitCost,
      rank: gw.rank, overall_rank: gw.overall_rank,
      transfers: gw.event_transfers||0, hit_cost: hitCost,
      chip: gw.chip||"", vs_pace: +(pts - hitCost - pace).toFixed(1),
    };
  });

  const sheet = getOrCreateSheet(ss, "SEASON_TARGET");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  row = writeSectionHeader(sheet, row, "SEASON TARGET TRACKER — Top " + TARGET_RANK, "#1c2a50", "#00f5ff");

  const summaryData = [
    ["Overall Rank",      currRank.toLocaleString(),     "Target Rank",    "Top "+TARGET_RANK],
    ["Total Points",      totalPts,                       "Target Pts",     TARGET_TOTAL_PTS],
    ["GW Done",           gwDone+"/"+TOTAL_GW,            "GW Left",        gwLeft],
    ["Avg Pts/GW (Act)",  avgPtsActual,                   "Avg Pts/GW Need",ptsPerGWNeeded],
    ["Pts Needed",        ptsNeeded,                      "Status",         (onTrack==="ON TRACK"?"✅ ":"⚠️ ")+onTrack],
    ["Total Hits",        gwData.filter(g=>g.hit_cost>0).length,
     "Net Pts Total",     gwData.reduce((s,g)=>s+g.net_pts,0)],
  ];
  summaryData.forEach(r => {
    sheet.getRange(row,1).setValue(r[0]).setFontWeight("bold").setFontColor("#7a8fba");
    sheet.getRange(row,2).setValue(r[1]).setFontColor(
      r[0]==="Status"?(r[1].includes("ON TRACK")?"#00ff9d":"#ffd60a"):"#ffffff"
    ).setFontWeight(r[0]==="Status"?"bold":"normal");
    sheet.getRange(row,3).setValue(r[2]).setFontWeight("bold").setFontColor("#7a8fba");
    sheet.getRange(row,4).setValue(r[3]).setFontColor("#ffffff");
    sheet.getRange(row,1,1,4).setBackground("#0c1225");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "GW BY GW PERFORMANCE", "#0a0a1a", "#b44eff");
  const gwH = ["GW","POINTS","NET PTS","VS PACE","OVERALL RANK","TRANSFERS","HIT","CHIP"];
  sheet.getRange(row,1,1,gwH.length).setValues([gwH]).setBackground("#0f1830").setFontColor("#b44eff").setFontWeight("bold");
  row++;
  [...gwData].reverse().forEach(g => {
    const bg = g.net_pts>=pace?"#001a00":g.net_pts>=pace*0.8?"#0a0a0a":"#1a0000";
    sheet.getRange(row,1,1,8).setValues([[
      "GW"+g.gw, g.pts, g.net_pts, (g.vs_pace>=0?"+":"")+g.vs_pace,
      (g.overall_rank||0).toLocaleString(), g.transfers, g.hit_cost?"-"+g.hit_cost:"-", g.chip||"-",
    ]]).setBackground(bg).setFontColor("#c5d4f0");
    sheet.getRange(row,4).setFontColor(g.vs_pace>=0?"#00ff9d":"#ff6b6b").setFontWeight("bold");
    if (g.chip) sheet.getRange(row,8).setFontColor("#ffd60a").setFontWeight("bold");
    if (g.hit_cost>0) sheet.getRange(row,7).setFontColor("#ff2d55");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "PROJECTION", "#0a1a0a", "#00f5ff");
  [
    ["ถ้าทำ "+avgPtsActual+" pts/GW (pace ปัจจุบัน)", Math.round(totalPts+avgPtsActual*gwLeft)+" pts"],
    ["ถ้าทำ "+ptsPerGWNeeded+" pts/GW (target pace)", TARGET_TOTAL_PTS+" pts"],
    ["ถ้าทำ 60 pts/GW", Math.round(totalPts+60*gwLeft)+" pts"],
    ["ถ้าทำ 50 pts/GW", Math.round(totalPts+50*gwLeft)+" pts"],
  ].forEach(p => {
    sheet.getRange(row,1,1,2).setValues([p]).setBackground("#0a1a0a").setFontColor("#c5d4f0");
    row++;
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1,8);
  logRun(ss, "SeasonTarget", "Rank:"+currRank.toLocaleString()+" | "+onTrack, "SUCCESS");
  Logger.log("=== SEASON TARGET DONE ===");
}


// ============================================================
// 12. DATA — xPts CALCULATOR
// ============================================================

// ── ข้อ 5: อ่าน baseline 25/26 จาก FULL_PLAYER_DATA_2526 (รัน runFullPlayerData2526() ก่อน) ──
// คืนค่า map ชื่อผู้เล่น -> {avgPts, avgMin, avgBPS, avgBonus, avgXGC} (= ค่ารวมซีซัน / 38)
function _getBaseline2526Map(ss) {
  const sheet = ss.getSheetByName("FULL_PLAYER_DATA_2526");
  if (!sheet) {
    Logger.log("⚠ ไม่พบ FULL_PLAYER_DATA_2526 — ข้าม baseline blend (รัน runFullPlayerData2526() ก่อน)");
    return {};
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const col = (name) => headers.indexOf(name);
  const iName=col("NAME"), iPts=col("Pts"), iMP=col("MP"), iBPS=col("BPS"), iBP=col("BP"), iXGC=col("xGC");
  if ([iName,iPts,iMP,iBPS,iBP,iXGC].includes(-1)) {
    Logger.log("⚠ FULL_PLAYER_DATA_2526 column ไม่ครบ — ข้าม baseline blend");
    return {};
  }
  const map = {};
  for (let r=1; r<data.length; r++) {
    const row = data[r];
    const name = String(row[iName]||"").trim();
    if (!name) continue;
    map[name] = {
      avgPts:   (parseFloat(row[iPts])||0) / 38,
      avgMin:   (parseFloat(row[iMP]) ||0) / 38,
      avgBPS:   (parseFloat(row[iBPS])||0) / 38,
      avgBonus: (parseFloat(row[iBP]) ||0) / 38,
      avgXGC:   (parseFloat(row[iXGC])||0) / 38,
    };
  }
  return map;
}

function runXPtsCalculator() {
  Logger.log("=== xPts CALCULATOR START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const fix  = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot || !fix) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  const currentGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;

  const upcoming = fix.filter(f => !f.finished && f.event !== null);
  const finished = fix.filter(f => f.finished);
  const teamForm = buildTeamForm(boot.teams, finished);

  const top100 = [];
  [1,2,3,4].forEach(posId => {
    boot.elements.filter(p => p.minutes>0 && p.element_type===posId)
      .sort((a,b)=>b.total_points-a.total_points).slice(0,CONFIG.QUOTA[posId])
      .forEach(p => top100.push(p));
  });

  // ── ข้อ 5: GW1-5 ใช้ baseline 25/26 ผสมกับฟอร์มปัจจุบัน ──────────
  const useBaseline = currentGW <= CONFIG.BASELINE_BLEND_GW;
  const baselineMap = useBaseline ? _getBaseline2526Map(ss) : {};
  if (useBaseline) {
    const w = Math.max(0, (CONFIG.BASELINE_BLEND_GW - (currentGW-1)) / CONFIG.BASELINE_BLEND_GW);
    Logger.log("🔄 BASELINE BLEND ACTIVE: GW"+currentGW+"/"+CONFIG.BASELINE_BLEND_GW+
      " | weight="+(w*100).toFixed(0)+"% baseline 25/26 | players matched: "+Object.keys(baselineMap).length);
  }

  const xPtsResults = [];
  top100.forEach((p, i) => {
    Utilities.sleep(250);
    if (i%20===0) Logger.log("  "+i+"/"+top100.length+"...");
    const summary = fetchJSON("https://fantasy.premierleague.com/api/element-summary/" + p.id + "/");
    if (!summary) return;

    const recent5   = (summary.history||[]).sort((a,b)=>b.round-a.round).slice(0,5);
    let   avgPts5   = recent5.length ? +(recent5.reduce((s,g)=>s+g.total_points,0)/recent5.length).toFixed(2) : 0;
    const xgi5      = recent5.length ? +(recent5.reduce((s,g)=>s+parseFloat(g.expected_goal_involvements||0),0)).toFixed(2) : 0;
    let   xgcAvg5   = recent5.length ? recent5.reduce((s,g)=>s+parseFloat(g.expected_goals_conceded||0),0)/recent5.length : 0;
    let   avgBPS5   = recent5.length ? +(recent5.reduce((s,g)=>s+(g.bps||0),0)/recent5.length).toFixed(1) : 0;
    let   avgBonus5 = recent5.length ? +(recent5.reduce((s,g)=>s+(g.bonus||0),0)/recent5.length).toFixed(2) : 0;
    let   avgMin5   = recent5.length ? recent5.reduce((s,g)=>s+(g.minutes||0),0)/recent5.length : 0;

    // ── ข้อ 5: GW1-5 blend กับ baseline ฤดูกาล 25/26 ──────────────
    // weight: GW1=100% baseline → ลดลงเรื่อยๆ → GW6+=0% (ใช้ฟอร์มปัจจุบันเต็ม)
    // (xgi5 ไม่ได้ blend เพราะไม่ถูกใช้ใน xPts formula นี้)
    if (useBaseline) {
      const base = baselineMap[p.web_name];
      if (base) {
        const w = Math.max(0, (CONFIG.BASELINE_BLEND_GW - (currentGW-1)) / CONFIG.BASELINE_BLEND_GW);
        avgPts5   = +(avgPts5*(1-w)   + base.avgPts  *w).toFixed(2);
        avgMin5   =  avgMin5*(1-w)    + base.avgMin  *w;
        avgBPS5   = +(avgBPS5*(1-w)   + base.avgBPS  *w).toFixed(1);
        avgBonus5 = +(avgBonus5*(1-w) + base.avgBonus*w).toFixed(2);
        xgcAvg5   =  xgcAvg5*(1-w)    + base.avgXGC  *w;
      }
    }

    const bpsFactor = CONFIG.BPS_TIERS.find(([t])=>avgBPS5>=t)?.[1]||1.0;
    const minFactor = avgMin5>=75?1.0:avgMin5>=45?0.75:0.4;

    // Fixture
    const nextFix = upcoming.find(f => f.event===currentGW && (f.team_h===p.team||f.team_a===p.team));
    let fdr=3, isHome=false, hasFix=false, oppId=null;
    if (nextFix) {
      hasFix = true; isHome = nextFix.team_h===p.team;
      fdr = isHome ? nextFix.team_h_difficulty : nextFix.team_a_difficulty;
      oppId = isHome ? nextFix.team_a : nextFix.team_h;
    }
    const fdrFactor   = hasFix ? (CONFIG.FDR_FACTORS[fdr]||1.0) : 0;
    const venueFactor = isHome ? CONFIG.HOME_ATT_BONUS : 1.0;
    const avFactor    = p.status==="a"?1.0:p.status==="d"?0.5:0.0;

    // Set piece
    const pen    = p.penalties_order                      || 0;
    const corner = p.corners_and_indirect_freekicks_order || 0;
    const fk     = p.direct_freekicks_order               || 0;
    const spBonus = pen===1?1.15:[corner,fk].includes(1)?1.08:[pen,corner,fk].includes(2)?1.03:1.0;

    // Clean sheet probability
    const posId = p.element_type;
    let csProbability = 0;
    if (posId <= 3 && hasFix) {
      const csBase    = CONFIG.CS_PROB_BASE[Math.round(fdr)]||0.12;
      const teamXGC   = xgcAvg5>0 ? xgcAvg5 : 1.5;
      const xgcFactor = teamXGC<=0.8?1.2:teamXGC<=1.2?1.0:teamXGC<=1.8?0.85:0.7;
      const myFormPts = teamForm[p.team]?.pts || 7;
      const formFactor = myFormPts>=12?1.15:myFormPts>=8?1.0:myFormPts>=4?0.9:0.75;
      const csVenue    = isHome?1.1:0.95;
      csProbability    = +Math.min(CONFIG.CS_PROB_MAX, csBase*xgcFactor*formFactor*csVenue).toFixed(3);
    }
    const csPoints     = [0,6,6,1,0][posId] || 0;
    const csExpected   = +(csProbability * csPoints).toFixed(2);
    const pensSaved5   = posId===1 ? recent5.reduce((s,g)=>s+(g.penalties_saved||0),0) : 0;
    const penSaveBonus = posId===1 && pensSaved5>0 ? +(pensSaved5/recent5.length*5).toFixed(2) : 0;

    const xPtsBase = hasFix ? +(avgPts5*fdrFactor*venueFactor*avFactor*spBonus*minFactor).toFixed(2) : 0;
    const xPts     = +(xPtsBase*bpsFactor + csExpected + penSaveBonus).toFixed(2);
    const capXPts  = +(xPts * 2).toFixed(2);

    xPtsResults.push({
      name:p.web_name, team:teamMap[p.team]||"?", pos:posMap[posId]||"?",
      price:+(p.now_cost/10).toFixed(1), total_pts:p.total_points, status:statusLabel(p.status),
      avg_pts_5gw:avgPts5, avg_bps_5gw:avgBPS5, avg_bonus_5gw:avgBonus5,
      cs_prob:csProbability>0?(csProbability*100).toFixed(1)+"%":"-",
      cs_expected:csExpected>0?csExpected:"-",
      next_opp:oppId?teamMap[oppId]:"BGW", next_venue:hasFix?(isHome?"H":"A"):"-",
      fdr, fdr_factor:fdrFactor, sp_bonus:spBonus, bps_factor:bpsFactor,
      xpts:xPts, captain_xpts:capXPts,
    });
  });

  xPtsResults.sort((a,b) => b.xpts - a.xpts);

  const sheet = getOrCreateSheet(ss, "XPTS");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  const xptsTitle = "EXPECTED POINTS (xPts) — GW"+currentGW +
    (useBaseline ? "  🔄 BASELINE BLEND 25/26 ("+Object.keys(baselineMap).length+" players)" : "");
  row = writeSectionHeader(sheet, row, xptsTitle, "#1c2a50", "#00f5ff");

  // Top captain section
  row = writeSectionHeader(sheet, row, "TOP CAPTAIN CANDIDATES", "#1a1500", "#ffd60a");
  const capH = ["NAME","TEAM","POS","PRICE","STATUS","AVG_5GW","AVG_BPS","AVG_BONUS",
    "CS_PROB","CS_EXPECTED","FDR","VENUE","SP_BONUS","BPS_FACTOR","xPTS","CAPTAIN_xPTS"];
  sheet.getRange(row,1,1,capH.length).setValues([capH]).setBackground("#1a1500").setFontColor("#ffd60a").setFontWeight("bold");
  row++;
  xPtsResults.slice(0,15).forEach((p,i) => {
    const bg = i===0?"#2a2000":i<3?"#1a1500":"#0f1000";
    const fc = i===0?"#ffd60a":"#c5d4f0";
    sheet.getRange(row,1,1,capH.length).setValues([[
      p.name,p.team,p.pos,"£"+p.price+"m",p.status,
      p.avg_pts_5gw,p.avg_bps_5gw,p.avg_bonus_5gw,p.cs_prob,p.cs_expected,
      p.fdr,p.next_venue,p.sp_bonus,p.bps_factor,p.xpts,p.captain_xpts,
    ]]).setBackground(bg).setFontColor(fc);
    if (i===0) sheet.getRange(row,1,1,capH.length).setFontWeight("bold");
    row++;
  });
  row++;

  // Per position
  ["GK","DEF","MID","FWD"].forEach(pos => {
    const group = xPtsResults.filter(p => p.pos===pos);
    if (!group.length) return;
    const pColors = { GK:{bg:"#1a1500",fc:"#ffd60a"}, DEF:{bg:"#001a1a",fc:"#00f5ff"},
                      MID:{bg:"#001a00",fc:"#00ff9d"}, FWD:{bg:"#1a0a00",fc:"#ff6a00"} };
    const c = pColors[pos];
    row = writeSectionHeader(sheet, row, pos+" — xPts Ranking", c.bg, c.fc);
    sheet.getRange(row,1,1,capH.length).setValues([capH]).setBackground(c.bg).setFontColor(c.fc).setFontWeight("bold");
    row++;
    group.forEach(p => {
      const bg = p.status!=="AVAILABLE"?"#1a0000":c.bg;
      sheet.getRange(row,1,1,capH.length).setValues([[
        p.name,p.team,p.pos,"£"+p.price+"m",p.status,
        p.avg_pts_5gw,p.avg_bps_5gw,p.avg_bonus_5gw,p.cs_prob,p.cs_expected,
        p.fdr,p.next_venue,p.sp_bonus,p.bps_factor,p.xpts,p.captain_xpts,
      ]]).setBackground(bg).setFontColor(p.status!=="AVAILABLE"?"#ff6b6b":"#c5d4f0");
      row++;
    });
    row++;
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, capH.length);
  buildCSSheet(ss, xPtsResults);
  logRun(ss, "xPtsCalculator", xPtsResults.length+" players | GW"+currentGW, "SUCCESS");
  Logger.log("=== xPts DONE | Top: " + xPtsResults[0]?.name + " " + xPtsResults[0]?.xpts + "pts ===");
}

function buildCSSheet(ss, xPtsResults) {
  const sheet = getOrCreateSheet(ss, "CLEAN_SHEET_PROB");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  row = writeSectionHeader(sheet, row, "CLEAN SHEET PROBABILITY — GK & DEF", "#1c2a50", "#00f5ff");
  const headers = ["NAME","TEAM","PRICE","NEXT_OPP","VENUE","FDR","CS_PROB","CS_PTS_EXP","AVG_BPS","AVG_BONUS","xPTS"];
  ["GK","DEF","MID"].forEach(pos => {
    const group = xPtsResults.filter(p => p.pos===pos && p.cs_prob!=="-")
      .sort((a,b) => parseFloat(b.cs_prob)-parseFloat(a.cs_prob)).slice(0,pos==="MID"?10:15);
    if (!group.length) return;
    const pColor = { GK:{bg:"#001a1a",fc:"#00f5ff"}, DEF:{bg:"#001a00",fc:"#00ff9d"}, MID:{bg:"#1a1500",fc:"#ffd60a"} }[pos];
    row = writeSectionHeader(sheet, row, pos+" Clean Sheet", pColor.bg, pColor.fc);
    sheet.getRange(row,1,1,headers.length).setValues([headers]).setBackground(pColor.bg).setFontColor(pColor.fc).setFontWeight("bold");
    row++;
    group.forEach(p => {
      const csNum = parseFloat(p.cs_prob)||0;
      const bg = csNum>=45?"#003300":csNum>=30?"#001a00":csNum>=15?"#0f1000":"#0a0a0a";
      const fc = csNum>=45?"#00ff9d":csNum>=30?"#7aff9d":"#c5d4f0";
      sheet.getRange(row,1,1,headers.length).setValues([[
        p.name,p.team,"£"+p.price+"m",p.next_opp,p.next_venue,p.fdr,
        p.cs_prob,p.cs_expected,p.avg_bps_5gw,p.avg_bonus_5gw,p.xpts,
      ]]).setBackground(bg).setFontColor(fc);
      row++;
    });
    row++;
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}


// ============================================================
// 13. DATA — HIT CALCULATOR
// ============================================================

function runHitCalculator() {
  Logger.log("=== HIT CALCULATOR START ===");
  const ss        = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const xptsSheet = ss.getSheetByName("XPTS");
  const poolSheet = ss.getSheetByName("PLAYER_POOL");
  const squadSheet = ss.getSheetByName("SQUAD");
  if (!xptsSheet || !poolSheet) { Logger.log("❌ รัน runXPtsCalculator() ก่อน"); return; }

  // อ่าน xPts data
  const xptsData    = xptsSheet.getDataRange().getValues();
  let   headerRowIdx = -1;
  xptsData.forEach((row,i) => {
    if (row.some(cell => String(cell).toUpperCase()==="NAME")) headerRowIdx = i;
  });
  if (headerRowIdx < 0) { Logger.log("❌ ไม่พบ header ใน XPTS"); return; }

  const xptsHeaders = xptsData[headerRowIdx];
  const col = (name) => xptsHeaders.findIndex(h => String(h).toUpperCase().includes(name.toUpperCase()));
  const colName  = col("NAME");
  const colXpts  = col("XPTS");
  const colPos   = col("POS");
  const colPrice = col("PRICE");

  const xptsMap = {};
  xptsData.slice(headerRowIdx+1).forEach(r => {
    const name = String(r[colName]||"");
    if (name && name!=="NAME") {
      xptsMap[name] = {
        xpts:  parseFloat(r[colXpts]  || 0),
        pos:   String(r[colPos]       || ""),
        price: parseFloat(String(r[colPrice]||"0").replace("£","").replace("m","")),
      };
    }
  });

  const myPlayers = new Set();
  if (squadSheet) {
    squadSheet.getDataRange().getValues().slice(1).forEach(r => { if (r[1]) myPlayers.add(String(r[1])); });
  }

  const poolData    = poolSheet.getDataRange().getValues();
  const poolHeaders = poolData[0];
  const pNameIdx    = poolHeaders.indexOf("NAME");
  const pPriceIdx   = poolHeaders.indexOf("PRICE");
  const pPosIdx     = poolHeaders.indexOf("POS");

  const candidates = poolData.slice(1).map(r => ({
    name:  r[pNameIdx]||"", pos: r[pPosIdx]||"",
    price: parseFloat(r[pPriceIdx]||0),
    xpts:  xptsMap[r[pNameIdx]]?.xpts || 0,
  })).filter(p => p.name && !myPlayers.has(p.name) && p.xpts>0)
     .sort((a,b) => b.xpts - a.xpts);

  const squadCandidates = poolData.slice(1).map(r => ({
    name:  r[pNameIdx]||"", pos: r[pPosIdx]||"",
    price: parseFloat(r[pPriceIdx]||0),
    xpts:  xptsMap[r[pNameIdx]]?.xpts || 0,
  })).filter(p => p.name && myPlayers.has(p.name))
     .sort((a,b) => a.xpts - b.xpts);

  const HIT_COST = CONFIG.HIT_COST;
  const scenarios = [];

  for (let i = 0; i < Math.min(3, squadCandidates.length); i++) {
    const out = squadCandidates[i];
    for (let j = 0; j < Math.min(5, candidates.length); j++) {
      const inP = candidates[j];
      if (inP.pos !== out.pos) continue;
      if (inP.price > out.price + 2) continue;
      const gain    = +(inP.xpts - out.xpts).toFixed(2);
      const netGain = +(gain - HIT_COST).toFixed(2);
      scenarios.push({
        hits:1, out:out.name, out_xpts:out.xpts, in:inP.name, in_xpts:inP.xpts,
        gross_gain:gain, hit_cost:-HIT_COST, net_gain:netGain,
        worth_it: netGain>0?"YES":"NO",
        verdict:  netGain>=4?"STRONGLY YES":netGain>=0?"BORDERLINE":netGain>=-2?"RISKY NO":"DEFINITELY NO",
      });
    }
  }

  if (squadCandidates.length>=2 && candidates.length>=2) {
    const out1 = squadCandidates[0], out2 = squadCandidates[1];
    const in1  = candidates.find(c => c.pos===out1.pos);
    const in2  = candidates.find(c => c.pos===out2.pos && c.name!==in1?.name);
    if (in1 && in2) {
      const gain    = +((in1.xpts+in2.xpts)-(out1.xpts+out2.xpts)).toFixed(2);
      const netGain = +(gain - 8).toFixed(2);
      scenarios.push({
        hits:2, out:out1.name+"+"+out2.name, out_xpts:+(out1.xpts+out2.xpts).toFixed(2),
        in:in1.name+"+"+in2.name, in_xpts:+(in1.xpts+in2.xpts).toFixed(2),
        gross_gain:gain, hit_cost:-8, net_gain:netGain,
        worth_it:netGain>0?"YES":"NO",
        verdict:netGain>=8?"STRONGLY YES":netGain>=0?"BORDERLINE":"DEFINITELY NO",
      });
    }
  }
  scenarios.sort((a,b) => b.net_gain - a.net_gain);

  const sheet = getOrCreateSheet(ss, "HIT_CALC");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  row = writeSectionHeader(sheet, row, "HIT CALCULATOR — คุ้มไหมถ้า hit?", "#1c2a50", "#ffd60a");
  sheet.getRange(row,1,1,3).setValues([["Net Gain = xPts(IN)-xPts(OUT)-HitCost","1 Hit=-4pts","2 Hits=-8pts"]])
       .setBackground("#0c1225").setFontColor("#7a8fba").setFontStyle("italic");
  row+=2;
  const headers = ["HITS","OUT","OUT_xPTS","IN","IN_xPTS","GROSS_GAIN","HIT_COST","NET_GAIN","WORTH_IT","VERDICT"];
  sheet.getRange(row,1,1,headers.length).setValues([headers]).setBackground("#0f1830").setFontColor("#ffd60a").setFontWeight("bold");
  row++;
  scenarios.forEach(s => {
    const bg = s.verdict==="STRONGLY YES"?"#002200":s.verdict==="BORDERLINE"?"#1a1500":s.verdict==="RISKY NO"?"#1a0800":"#1a0000";
    const fc = s.verdict==="STRONGLY YES"?"#00ff9d":s.verdict==="BORDERLINE"?"#ffd60a":s.verdict==="RISKY NO"?"#ff9a00":"#ff2d55";
    sheet.getRange(row,1,1,10).setValues([[
      s.hits+"hit"+(s.hits>1?"s":""), s.out, s.out_xpts, s.in, s.in_xpts,
      (s.gross_gain>0?"+":"")+s.gross_gain, s.hit_cost,
      (s.net_gain>0?"+":"")+s.net_gain, s.worth_it, s.verdict,
    ]]).setBackground(bg).setFontColor(fc);
    row++;
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  logRun(ss, "HitCalculator", scenarios.length+" scenarios", "SUCCESS");
  Logger.log("=== HIT CALCULATOR DONE ===");
}


// ============================================================
// 14. DATA — FIXTURE SWING
// ============================================================

function runFixtureSwing() {
  Logger.log("=== FIXTURE SWING START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const fix  = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot || !fix) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const currentGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;
  const upcoming = fix.filter(f => !f.finished && f.event !== null);

  function teamAvgFDR(teamId, fromGW, toGW) {
    const fixtures = upcoming.filter(f => f.event>=fromGW && f.event<=toGW &&
      (f.team_h===teamId||f.team_a===teamId)).sort((a,b)=>a.event-b.event);
    if (!fixtures.length) return 5;
    return +(fixtures.reduce((s,f)=>s+(f.team_h===teamId?f.team_h_difficulty:f.team_a_difficulty),0)/fixtures.length).toFixed(2);
  }

  const swings = boot.teams.map(team => {
    const fdrNow  = teamAvgFDR(team.id, currentGW,   currentGW+2);
    const fdrNext = teamAvgFDR(team.id, currentGW+3, currentGW+5);
    const swing   = +(fdrNow - fdrNext).toFixed(2);
    const getReadable = (from, to) => upcoming
      .filter(f => f.event>=from && f.event<=to && (f.team_h===team.id||f.team_a===team.id))
      .sort((a,b)=>a.event-b.event).map(f => {
        const isHome = f.team_h===team.id;
        return (isHome?teamMap[f.team_a]:teamMap[f.team_h])+"("+(isHome?"H":"A")+")["+(isHome?f.team_h_difficulty:f.team_a_difficulty)+"]";
      }).join(" ");
    const assets = boot.elements.filter(p=>p.team===team.id&&p.minutes>0)
      .sort((a,b)=>b.total_points-a.total_points).slice(0,3).map(p=>p.web_name).join(", ");
    return {
      team:team.short_name, fdr_now:fdrNow, fdr_next:fdrNext, swing,
      direction: swing<=-0.5?"IMPROVING":swing>=0.5?"WORSENING":"STABLE",
      strength:  Math.abs(swing)>=1.5?"STRONG":Math.abs(swing)>=0.5?"MODERATE":"SLIGHT",
      fixtures_now:  getReadable(currentGW,   currentGW+2),
      fixtures_next: getReadable(currentGW+3, currentGW+5),
      key_assets: assets,
    };
  }).sort((a,b) => a.swing-b.swing);

  const sheet = getOrCreateSheet(ss, "FIXTURE_SWING");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  row = writeSectionHeader(sheet, row, "FIXTURE SWING — GW"+currentGW+" Analysis", "#1c2a50", "#00f5ff");
  sheet.getRange(row,1,1,5).setValues([["Swing=FDR_NOW-FDR_NEXT","IMPROVING=fixture ดีขึ้น->ซื้อ","WORSENING=fixture แย่ลง->ขาย","",""]])
       .setBackground("#0c1225").setFontColor("#7a8fba").setFontStyle("italic");
  row+=2;
  const hdr = ["TEAM","FDR_NOW","FDR_NEXT","SWING","STRENGTH",
    "NOW(GW"+currentGW+"-"+(currentGW+2)+")", "NEXT(GW"+(currentGW+3)+"-"+(currentGW+5)+")", "KEY ASSETS"];
  ["IMPROVING","STABLE","WORSENING"].forEach(dir => {
    const group = swings.filter(t=>t.direction===dir);
    if (!group.length) return;
    const dColor = { IMPROVING:{bg:"#001a00",fc:"#00ff9d"}, STABLE:{bg:"#1a1500",fc:"#ffd60a"}, WORSENING:{bg:"#1a0000",fc:"#ff2d55"} };
    const c = dColor[dir];
    if (dir==="WORSENING") group.sort((a,b)=>b.swing-a.swing);
    row = writeSectionHeader(sheet, row, dir+" — fixture", c.bg, c.fc);
    sheet.getRange(row,1,1,hdr.length).setValues([hdr]).setBackground(c.bg).setFontColor(c.fc).setFontWeight("bold");
    row++;
    group.forEach(t => {
      const bg = t.strength==="STRONG"?(dir==="IMPROVING"?"#003300":"#330000"):c.bg;
      sheet.getRange(row,1,1,hdr.length).setValues([[
        t.team,t.fdr_now,t.fdr_next,t.swing,t.strength,t.fixtures_now,t.fixtures_next,t.key_assets,
      ]]).setBackground(bg).setFontColor("#c5d4f0");
      row++;
    });
    row++;
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, hdr.length);
  logRun(ss, "FixtureSwing", swings.length+" teams | GW"+currentGW, "SUCCESS");
  Logger.log("=== FIXTURE SWING DONE ===");
}


// ============================================================
// 15. DATA — REALTIME ALERT (store only, no email)
// ============================================================

function runRealtimeAlert() {
  Logger.log("=== REALTIME ALERT START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap  = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };
  const TOTAL   = CONFIG.TOTAL_MANAGERS;

  const stateSheet = getOrCreateSheet(ss, "ALERT_STATE");
  const prevState  = loadAlertState(stateSheet);
  const alerts     = [];

  // ตรวจ status เปลี่ยน
  boot.elements.filter(p => p.minutes>0).forEach(p => {
    const key     = "status_" + p.id;
    const prevSts = prevState[key];
    const currSts = p.status;
    if (prevSts === "a" && currSts !== "a") {
      alerts.push({
        type:"INJURY", urgency:"CRITICAL", player:p.web_name,
        team:teamMap[p.team]||"?", pos:posMap[p.element_type]||"?",
        price:+(p.now_cost/10).toFixed(1), detail:p.news||"Status:"+currSts,
        action:"SELL/BENCH NOW",
      });
    }
    if (prevSts && prevSts!=="a" && currSts==="a") {
      alerts.push({
        type:"RETURN", urgency:"OPPORTUNITY", player:p.web_name,
        team:teamMap[p.team]||"?", pos:posMap[p.element_type]||"?",
        price:+(p.now_cost/10).toFixed(1), detail:"กลับมา Available แล้ว",
        action:"BUY BEFORE PRICE RISES",
      });
    }
    prevState[key] = currSts;
  });

  // ตรวจ price velocity
  boot.elements.filter(p => p.minutes>0).forEach(p => {
    const ownPct    = parseFloat(p.selected_by_percent||0);
    const owners    = Math.round((ownPct/100)*TOTAL);
    const netDelta  = (p.transfers_in_event||0) - (p.transfers_out_event||0);
    const netRate   = owners>0 ? +(netDelta/owners*100).toFixed(3) : 0;
    if (netRate >= 2.0) {
      const key = "price_alert_"+p.id;
      if (!prevState[key]) {
        alerts.push({
          type:"PRICE_RISE", urgency:"BUY_NOW", player:p.web_name,
          team:teamMap[p.team]||"?", pos:posMap[p.element_type]||"?",
          price:+(p.now_cost/10).toFixed(1),
          detail:"Net rate:+"+netRate+"% | Net:+"+netDelta.toLocaleString()+" transfers",
          action:"ซื้อก่อนราคาขึ้น",
        });
        prevState[key] = "alerted";
      }
    } else { delete prevState["price_alert_"+p.id]; }

    if (netRate <= -2.0) {
      const key = "sell_alert_"+p.id;
      if (!prevState[key]) {
        alerts.push({
          type:"PRICE_FALL", urgency:"SELL_NOW", player:p.web_name,
          team:teamMap[p.team]||"?", pos:posMap[p.element_type]||"?",
          price:+(p.now_cost/10).toFixed(1),
          detail:"Net rate:"+netRate+"% | Net:"+netDelta.toLocaleString()+" transfers",
          action:"ขายก่อนราคาลง",
        });
        prevState[key] = "alerted";
      }
    } else { delete prevState["sell_alert_"+p.id]; }
  });

  saveAlertState(stateSheet, prevState);

  // เขียนลง ALERTS sheet เท่านั้น (ไม่ส่ง email)
  if (alerts.length > 0) {
    writeAlertSheet(ss, alerts);
    Logger.log("✓ " + alerts.length + " alerts saved to sheet");
  } else {
    Logger.log("✓ No new alerts");
  }

  logRun(ss, "RealtimeAlert", alerts.length+" alerts", alerts.length>0?"ALERT":"OK");
  Logger.log("=== REALTIME ALERT DONE ===");
}

function loadAlertState(sheet) {
  const state = {};
  sheet.getDataRange().getValues().slice(1).forEach(r => { if (r[0]) state[r[0]] = r[1]; });
  return state;
}

function saveAlertState(sheet, state) {
  sheet.clearContents();
  sheet.getRange(1,1,1,2).setValues([["KEY","VALUE"]]);
  const rows = Object.entries(state).map(([k,v]) => [k,v]);
  if (rows.length > 0) sheet.getRange(2,1,rows.length,2).setValues(rows);
}

function writeAlertSheet(ss, alerts) {
  const sheet = getOrCreateSheet(ss, "ALERTS");
  // ── ล้างและเขียนใหม่ทุกครั้ง (ไม่ append) ──
  // เก็บ history สูงสุด 30 alerts ล่าสุด (เก่าสุดตัดทิ้ง)
  sheet.clearContents(); sheet.clearFormats();
  sheet.getRange(1,1,1,7).setValues([["TIMESTAMP","URGENCY","TYPE","PLAYER","TEAM","PRICE","DETAIL / ACTION"]])
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");

  const now  = new Date();
  const rows = alerts.slice(0,30).map(a =>
    [now, a.urgency, a.type, a.player+"("+a.pos+")", a.team, "£"+a.price+"m", a.detail+" -> "+a.action]);
  if (!rows.length) { sheet.getRange(2,1).setValue("ไม่มี alerts").setFontColor("#7a8fba"); return; }
  sheet.getRange(2,1,rows.length,7).setValues(rows);
  alerts.slice(0,30).forEach((a,i) => {
    const bg = a.type==="INJURY"?"#1a0000":a.type==="RETURN"?"#001a00":a.type==="PRICE_RISE"?"#001a1a":"#1a0a00";
    const fc = a.type==="INJURY"?"#ff2d55":a.type==="RETURN"?"#00ff9d":a.type==="PRICE_RISE"?"#00f5ff":"#ffd60a";
    sheet.getRange(i+2,1,1,7).setBackground(bg).setFontColor(fc);
  });
  sheet.autoResizeColumns(1,7);
}


// ============================================================
// 16. AI — QUANT ANALYSIS ENGINE
// ============================================================

function runQuant(mode) {
  mode = mode || "brief";
  Logger.log("=== QUANT START | mode: " + mode + " ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  const playerData = readSheetData(ss, "PLAYER_POOL");
  const newsData   = readSheetData(ss, "NEWS");
  const squadData  = readSheetData(ss, "SQUAD");

  if (!playerData.length) { Logger.log("❌ ไม่พบ PLAYER_POOL"); return; }

  const playerCSV = buildPlayerContext(playerData);
  const newsCtx   = buildNewsContext(ss, newsData);
  const squadCtx  = buildSquadContext(squadData);

  let prompt;
  switch(mode) {
    case "captain":      prompt = promptCaptain(playerCSV, newsCtx, ss);      break;
    case "transfer":     prompt = promptTransfer(playerCSV, newsCtx, squadCtx, ss); break;
    case "differential": prompt = promptDifferential(playerCSV);               break;
    case "chip":         prompt = promptChip(readSheetData(ss, "FDR_CALENDAR")); break;
    case "preseason":    prompt = promptPreseason(playerCSV, ss);              break;
    default:             prompt = promptBrief(playerCSV, newsCtx, squadCtx, ss);
  }

  const analysis = callGemini(prompt);
  if (!analysis) { Logger.log("❌ Gemini failed"); return; }

  const sheet = getOrCreateSheet(ss, "ANALYSIS");
  sheet.clearContents(); sheet.clearFormats();
  sheet.getRange(1,1).setValue("APEX QUANT — "+mode.toUpperCase()+" | "+new Date().toLocaleString("th-TH"))
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(12);
  const textCell = sheet.getRange(3,1);
  textCell.setValue(analysis).setWrap(true).setFontFamily("Courier New").setFontSize(11);
  sheet.setColumnWidth(1, 800);

  logRun(ss, "Quant["+mode+"]", "tokens~"+Math.round(prompt.length/4), "SUCCESS");
  Logger.log("=== QUANT DONE ===");
}

function runQuantBrief()        { runQuant("brief"); }
function runQuantCaptain()      { runQuant("captain"); }
function runQuantTransfer()     { runQuant("transfer"); }
function runQuantDifferential() { runQuant("differential"); }
function runQuantChip()         { runQuant("chip"); }
function runQuantPreseason()    { runQuant("preseason"); }

function promptBrief(playerCSV, newsCtx, squadCtx, ss) {
  const leagueCtx = buildLeagueContext(ss);
  const priceCtx  = buildPriceContext(ss);
  const rotCtx    = buildRotationContext(ss);
  const targetCtx = buildTargetContext(ss);
  return `คุณคือ APEX QUANT วิเคราะห์ FPL ระดับสูง เป้าหมาย: Top 100 / ${CONFIG.TARGET_PTS}+ pts

${squadCtx  ? "SQUAD:\n"         + squadCtx  + "\n" : ""}
${newsCtx   ? "INJURY/NEWS (ทีมฉัน):\n" + newsCtx   + "\n" : ""}
${leagueCtx ? "MINI-LEAGUE:\n"   + leagueCtx + "\n" : ""}
${priceCtx  ? "PRICE ALERTS:\n"  + priceCtx  + "\n" : ""}
${rotCtx    ? "ROTATION RISK:\n" + rotCtx    + "\n" : ""}
${targetCtx ? "SEASON TARGET:\n" + targetCtx + "\n" : ""}

PLAYER POOL (Top 100):
${playerCSV}

**1. CAPTAIN PICK** — Top 3, FDR-X+PPM+rotation risk
**2. TRANSFER** — IN: BUY_NOW+FDR ดี | OUT: SELL_NOW+rotation HIGH (เฉพาะทีมฉัน)
**3. DIFFERENTIAL** — OWN%<5% diff score สูง
**4. SEASON TARGET** — on track? ถ้า BEHIND -> aggressive play
**5. RISK ALERTS** — เฉพาะนักเตะในทีมฉัน: injured/suspended/price fall

ตอบภาษาไทย กระชับ มีตัวเลข`.trim();
}

function promptCaptain(playerCSV, newsCtx, ss) {
  const xptsData = readSheetData(ss, "XPTS");
  const top5xpts = xptsData.filter(r => r["xPTS"]).sort((a,b) => parseFloat(b["xPTS"])-parseFloat(a["xPTS"])).slice(0,5);
  const xptsCtx  = top5xpts.map(p => p["NAME"]+" xPts:"+p["xPTS"]+" cap:"+p["CAPTAIN_xPTS"]+" fdr:"+p["FDR"]).join("\n");
  return `APEX QUANT — Captain Pick\n${newsCtx?"NEWS:\n"+newsCtx+"\n":""}\nTOP xPTS:\n${xptsCtx}\nPLAYER POOL:\n${playerCSV}\n\nTop 5 captain candidates (FDRX_3 30%+PPM 40%+OWN% 30%)\nตรวจ rotation risk ก่อน\nตอบภาษาไทย กระชับ`;
}

function promptTransfer(playerCSV, newsCtx, squadCtx, ss) {
  return `APEX QUANT — Transfer Analysis\n${squadCtx?"SQUAD:\n"+squadCtx+"\n":""}\n${newsCtx?"NEWS (ทีมฉัน):\n"+newsCtx+"\n":""}\nPRICE:\n${buildPriceContext(ss)}\n\nIN: BUY_NOW + FDR<=3 + PPM สูง\nOUT: SELL_NOW หรือ rotation HIGH (เฉพาะทีมฉัน)\nHIT: คุ้มไหม (-4pts)?\nตอบภาษาไทย มีตัวเลข`;
}

function promptDifferential(playerCSV) {
  return `APEX QUANT — Differential\nPLAYER POOL:\n${playerCSV}\n\nTop 5 differential (OWN%<5%): Diff Score=PPM×(5-FDRX_3)/OWN%\nระบุ risk level\nตอบภาษาไทย กระชับ`;
}

function promptChip(fdrData) {
  const txt = fdrData.slice(0,20).map(r=>Object.values(r).join(",")).join("\n");
  return `APEX QUANT — Chip Timing\nFDR CALENDAR:\n${txt}\n\nTC/BB/FH/WC timing ที่ดีที่สุด\nตอบภาษาไทย กระชับ`;
}

function promptPreseason(playerCSV, ss) {
  const blSheet = ss.getSheetByName("BASELINE_26_27");
  let blCtx = "";
  if (blSheet) {
    const data = blSheet.getDataRange().getValues();
    blCtx = "HISTORICAL BASELINE:\n"+data.slice(1,21).map(r=>r[0]+"("+r[2]+",£"+r[3]+"m) hist_avg:"+r[6]+" hist_ppm:"+r[7]+" consistency:"+r[15]+" potential:"+r[16]).join("\n");
  }
  return `APEX QUANT — Pre-Season 26/27\n${blCtx}\n\nPLAYER POOL:\n${playerCSV}\n\n` +
    `กฎเหล็ก FPL (ห้ามละเมิดเด็ดขาด):\n` +
    `• ทีม 15 คน: GK×2, DEF×5, MID×5, FWD×3 (นับตำแหน่งให้ครบก่อนเสมอ)\n` +
    `• งบประมาณรวม ≤ £100m\n` +
    `• ผู้เล่นจากทีมเดียวกันได้ ≤ 3 คน\n\n` +
    `ข้อกำหนดเพิ่มเติม:\n` +
    `• TIER1 premium (£9m+): 2-3 คน\n` +
    `• TIER2 mid (£6-8.9m): 6-7 คน\n` +
    `• TIER3 budget (<=£5.9m): 5-6 คน\n\n` +
    `รูปแบบคำตอบที่ต้องการ (ห้ามแตกต่าง):\n` +
    `GK (2): [ชื่อ 1] £Xm, [ชื่อ 2] £Xm\n` +
    `DEF (5): [ชื่อ 1] £Xm, [ชื่อ 2] £Xm, [ชื่อ 3] £Xm, [ชื่อ 4] £Xm, [ชื่อ 5] £Xm\n` +
    `MID (5): [ชื่อ 1] £Xm, [ชื่อ 2] £Xm, [ชื่อ 3] £Xm, [ชื่อ 4] £Xm, [ชื่อ 5] £Xm\n` +
    `FWD (3): [ชื่อ 1] £Xm, [ชื่อ 2] £Xm, [ชื่อ 3] £Xm\n` +
    `กัปตัน GW1: [ชื่อ] เหตุผล: [สั้นๆ]\n` +
    `รวมงบ: £Xm | เหลือ: £Xm\n` +
    `เหตุผล: [2-3 บรรทัด]\n\n` +
    `ห้ามแสดงขั้นตอนคิดหรือคำนวณ ตอบเฉพาะผลสรุปสุดท้ายตามรูปแบบข้างต้น\nตอบภาษาไทยทั้งหมด`;
}

// Context builders
function buildPlayerContext(rows) {
  if (!rows.length) return "ไม่มีข้อมูล";
  const needed = ["NAME","TEAM","POS","STATUS","PRICE","TOTAL_PTS","PPM","OWNERSHIP%",
    "FDRX_3","FDRX_5","NEXT_FIXTURES","XFER_DELTA","PRICE_CHANGE","NEWS"];
  const headers  = Object.keys(rows[0]);
  const filtered = needed.filter(h => headers.includes(h));
  const sorted   = [...rows].sort((a,b) => parseFloat(b.TOTAL_PTS||0)-parseFloat(a.TOTAL_PTS||0)).slice(0,40);
  return [filtered.join(","), ...sorted.map(r => filtered.map(h => r[h]||"").join(","))].join("\n");
}

function buildNewsContext(ss, rows) {
  // เฉพาะนักเตะในทีมฉัน
  const squadSheet = ss?.getSheetByName("SQUAD");
  const myPlayers  = new Set();
  if (squadSheet) {
    squadSheet.getDataRange().getValues().slice(1)
      .forEach(r => { if (r[1]) myPlayers.add(String(r[1])); });
  }
  return (rows||[])
    .filter(r => {
      const s = String(r["STATUS"]||"");
      const n = String(r["NAME"]  ||"");
      return myPlayers.has(n) && ["INJURED","SUSPENDED","DOUBTFUL","UNAVAILABLE"].includes(s);
    })
    .slice(0,10)
    .map(r => "["+r["STATUS"]+"] "+r["NAME"]+" — "+(r["NEWS"]||r["TITLE"]||""))
    .join("\n") || "ไม่มีนักเตะในทีมที่บาดเจ็บ";
}

function buildSquadContext(rows) {
  if (!rows.length) return "";
  return rows.filter(r => r["NAME"]&&r["SLOT"]).slice(0,15)
    .map(r => (r["SLOT"]<=11?"XI":"BN")+" "+r["NAME"]+"("+r["TEAM"]+","+r["POS"]+",£"+r["PRICE"]+")"+
               (r["IS_CAPTAIN"]==="TRUE"?" [C]":r["IS_VICE"]==="TRUE"?" [V]":""))
    .join("\n");
}

function buildLeagueContext(ss) {
  const sheet = ss?.getSheetByName("LEAGUE_CONTEXT");
  if (!sheet) return "";
  try { return sheet.getDataRange().getValues().map(r => r[0]+": "+r[1]).join("\n"); }
  catch { return ""; }
}

function buildPriceContext(ss) {
  const squadSheet = ss?.getSheetByName("SQUAD");
  const myPlayers  = new Set();
  if (squadSheet) {
    squadSheet.getDataRange().getValues().slice(1)
      .forEach(r => { if (r[1]) myPlayers.add(String(r[1])); });
  }
  return readSheetData(ss, "PRICE_TRACKER")
    .filter(r => {
      const u = String(r["URGENCY"]||"");
      const n = String(r["NAME"]   ||"");
      if (u==="SELL_NOW") return myPlayers.has(n);
      return u==="BUY_NOW" && !myPlayers.has(n);
    })
    .slice(0,8)
    .map(r => r["URGENCY"]+": "+r["NAME"]+"("+r["POS"]+") rate:"+r["NET_RATE%"])
    .join("\n") || "ไม่มี alerts";
}

function buildRotationContext(ss) {
  return readSheetData(ss, "ROTATION_RISK")
    .filter(r => r["ROTATION_RISK"]==="HIGH").slice(0,8)
    .map(r => "HIGH: "+r["NAME"]+"("+r["POS"]+") start:"+r["START%"]+" sd:"+r["SD_MIN"])
    .join("\n") || "ไม่มี HIGH risk";
}

function buildTargetContext(ss) {
  const sheet = ss?.getSheetByName("SEASON_TARGET");
  if (!sheet) return "";
  try {
    return sheet.getRange(2,1,6,4).getValues()
      .map(r => r[0]+": "+r[1]).join(" | ");
  } catch { return ""; }
}


// ============================================================
// 17. AI — TEAM MANAGER
// ============================================================

function runAITeamManager() {
  Logger.log("=== AI TEAM MANAGER START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const fix  = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot || !fix) return;

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap  = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  const currentGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;

  // ── ข้อ 2: ตรวจ Tactical Mode (STANDARD/AGGRESSIVE) ──────────
  const tactical = determineTacticalMode(currentGW);
  Logger.log("Tactical Mode: " + tactical.mode + " — " + tactical.reason);

  // โหลด xPts data
  const xptsSheet = ss.getSheetByName("XPTS");
  if (!xptsSheet) { Logger.log("❌ รัน runXPtsCalculator() ก่อน"); return; }
  const xptsData = xptsSheet.getDataRange().getValues();
  if (xptsData.length < 2) { Logger.log("❌ XPTS sheet ว่าง"); return; }

  // อ่านเฉพาะ section ที่เป็น position (GK/DEF/MID/FWD)
  // ข้าม "TOP CAPTAIN CANDIDATES" เพื่อป้องกัน dedup ทำให้ FWD หาย
  let xptsHeaders     = null;
  let inPositionSection = false;
  const seenNames     = new Set();
  const players       = [];

  xptsData.forEach(row => {
    const firstCell = String(row[0] || "").toUpperCase();

    // ตรวจ section header
    if (["GK","DEF","MID","FWD"].some(p => firstCell.startsWith(p))) {
      inPositionSection = true;
    } else if (firstCell.includes("CAPTAIN") || firstCell.includes("TOP ")) {
      inPositionSection = false;
    }

    // header row (มีคำว่า NAME)
    if (row.some(cell => String(cell).toUpperCase() === "NAME")) {
      xptsHeaders = row; return;
    }

    // เก็บเฉพาะ position sections และมี headers แล้ว
    if (!xptsHeaders || !inPositionSection || !row[0] || firstCell === "") return;

    const col  = (name) => xptsHeaders.findIndex(h => String(h).toUpperCase().includes(name.toUpperCase()));
    const name  = String(row[col("NAME")]  || "");
    const xpts  = parseFloat(row[col("XPTS")] || 0);
    const pos   = String(row[col("POS")]   || "");
    const price = String(row[col("PRICE")] || "0");
    const team  = String(row[col("TEAM")]  || "");

    if (name && name !== "NAME" && ["GK","DEF","MID","FWD"].includes(pos) && !seenNames.has(name)) {
      seenNames.add(name);
      players.push({
        NAME:name, TEAM:team, POS:pos, PRICE:price,
        xPTS:xpts, TOTAL_PTS:parseFloat(row[col("TOTAL") < 0 ? col("PTS") : col("TOTAL")] || 0),
      });
    }
  });
  Logger.log("Players: " + players.length + " | GK:"+players.filter(p=>p.POS==="GK").length+
    " DEF:"+players.filter(p=>p.POS==="DEF").length+" MID:"+players.filter(p=>p.POS==="MID").length+
    " FWD:"+players.filter(p=>p.POS==="FWD").length);
  if (!players.length) { Logger.log("❌ ไม่พบ players"); return; }

  // โหลด state
  const aiStateSheet = getOrCreateSheet(ss, "AI_TEAM_STATE");
  const aiState      = loadAIState(aiStateSheet);
  let   aiSquad      = aiState.squad  || [];
  let   budget       = aiState.budget || AI_TEAM_CONFIG.budget;
  let   chips        = aiState.chips  || { tc:true, bb:true, fh:true, wc1:true, wc2:true };

  // Validate squad
  const hasGK  = aiSquad.filter(p=>p.pos==="GK").length  >= 2;
  const hasDEF = aiSquad.filter(p=>p.pos==="DEF").length >= 5;
  const hasMID = aiSquad.filter(p=>p.pos==="MID").length >= 5;
  const hasFWD = aiSquad.filter(p=>p.pos==="FWD").length >= 3;
  if (aiSquad.length < 15 || !hasGK || !hasDEF || !hasMID || !hasFWD) {
    const comp = ["GK","DEF","MID","FWD"].map(p=>p+":"+aiSquad.filter(x=>x.pos===p).length).join(" ");
    Logger.log("❌ Squad ผิดกติกา ["+aiSquad.length+" คน | "+comp+"] — Rebuilding from scratch...");
    aiSquad = []; aiState.budget = AI_TEAM_CONFIG.budget; budget = AI_TEAM_CONFIG.budget;
  }

  if (!aiSquad.length) {
    const result = buildAISquad(players);
    aiSquad = result.squad; budget = result.itb;
    Logger.log("✓ Built: " + aiSquad.length + " players | ITB:£" + budget + "m");

    // ── Pre-season fallback chain (GW1 ก่อน deadline picks API คืนค่าว่าง) ──────
    if (aiSquad.length < 15) {
      Logger.log("⚠ buildAISquad < 15 players — ลอง INITIAL_TEAM_2627 / SQUAD_INPUT");

      // 1) ลอง SQUAD_INPUT (ป้อนมือ — สร้างได้จากเมนู "📝 Set GW1 Squad Manually")
      const inputSheet = ss.getSheetByName("SQUAD_INPUT");
      if (inputSheet && inputSheet.getLastRow() > 1) {
        const inputData = inputSheet.getDataRange().getValues();
        const hdr       = inputData[0].map(h=>String(h).toUpperCase());
        const col       = (n) => hdr.findIndex(h=>h.includes(n.toUpperCase()));
        aiSquad = inputData.slice(1).filter(r=>r[col("NAME")]||r[0]).map(r => ({
          name: String(r[col("NAME")]||r[0]||"").trim(),
          team: String(r[col("TEAM")]||r[1]||"?"),
          pos:  String(r[col("POS")] ||r[2]||"").toUpperCase(),
          price:parseFloat(String(r[col("PRICE")]||r[3]||"0").replace("£","").replace("m","")),
          xpts: parseFloat(r[col("XPTS")]||r[4]||0),
          is_starting:false, is_captain:false, is_vice:false,
        })).filter(p=>p.name && ["GK","DEF","MID","FWD"].includes(p.pos));
        if (aiSquad.length >= 11) {
          assignStartingXI(aiSquad);
          Logger.log("✓ Loaded "+aiSquad.length+" players from SQUAD_INPUT");
        } else { aiSquad = []; }
      }

      // 2) ลอง INITIAL_TEAM_2627 (จาก runQuantPreseason / blindSimPredict2627)
      if (!aiSquad.length) {
        const initSheet = ss.getSheetByName("INITIAL_TEAM_2627");
        if (initSheet && initSheet.getLastRow() > 1) {
          const initData = initSheet.getDataRange().getValues();
          const hdr      = initData[0].map(h=>String(h).toUpperCase());
          const col      = (n) => hdr.findIndex(h=>h.includes(n.toUpperCase()));
          aiSquad = initData.slice(1).filter(r=>r[0]).map(r => ({
            name: String(r[col("NAME")]||r[0]||"").trim(),
            team: String(r[col("TEAM")]||r[1]||"?"),
            pos:  String(r[col("POS")] ||r[2]||"").toUpperCase(),
            price:parseFloat(String(r[col("PRICE")]||r[3]||"0").replace("£","").replace("m","")),
            xpts: parseFloat(r[col("XPTS")]||r[4]||0),
            is_starting:false, is_captain:false, is_vice:false,
          })).filter(p=>p.name && ["GK","DEF","MID","FWD"].includes(p.pos));
          if (aiSquad.length >= 11) {
            assignStartingXI(aiSquad);
            Logger.log("✓ Loaded "+aiSquad.length+" players from INITIAL_TEAM_2627");
          } else { aiSquad = []; }
        }
      }

      if (!aiSquad.length) {
        Logger.log("❌ ไม่มีข้อมูลทีมเลย — กรุณากด '📝 Set GW1 Squad Manually' แล้วป้อน 15 คน");
        ss.toast("❌ ไม่มีข้อมูลทีม GW1 — กด APEX Protocol → 📝 Set GW1 Squad Manually", "AI Team", 15);
        return;
      }
    }
  } else {
    const xferResult = makeAITransfers(aiSquad, players, budget, AI_TEAM_CONFIG.freeTransfers, tactical.mode);
    aiSquad = xferResult.squad; budget = xferResult.itb;
    if (xferResult.transfers.length) Logger.log("✓ Transfers ["+tactical.mode+"]: " + xferResult.transfers.join(", "));
    else if (tactical.mode==="AGGRESSIVE") Logger.log("⚠ AGGRESSIVE mode แต่ไม่มี transfer ที่คุ้ม");
  }

  // Captain
  const starting = aiSquad.filter(p => p.is_starting);
  const capPick  = [...starting].sort((a,b) => parseFloat(b.xpts||0)-parseFloat(a.xpts||0))[0];
  const vicePick = [...starting].sort((a,b) => parseFloat(b.xpts||0)-parseFloat(a.xpts||0))[1];
  aiSquad.forEach(p => { p.is_captain=p.name===capPick?.name; p.is_vice=p.name===vicePick?.name; });

  aiState.squad=aiSquad; aiState.budget=budget; aiState.chips=chips; aiState.last_gw=currentGW;
  aiState.tactical_mode=tactical.mode;
  saveAIState(aiStateSheet, aiState);
  writeAITeamSheet(ss, aiSquad, capPick, vicePick, budget, chips, null, currentGW, tactical);

  logRun(ss, "AITeamManager", "GW"+currentGW+" | Cap:"+capPick?.name+" | Mode:"+tactical.mode, "SUCCESS");
  Logger.log("=== AI TEAM DONE ===");
}

/**
 * ตรวจสอบสถานะและวิเคราะห์ว่าต้องเปลี่ยนกลยุทธ์เป็น Aggressive หรือไม่ (ข้อ 2)
 */
// ============================================================
// LATE-SEASON TACTICAL MODE (ข้อ 2)
// อ่านสถานะ mini-league จาก LEAGUE_CONTEXT sheet (เขียนโดย runMiniLeague)
// แล้วตัดสินใจว่าควรสลับเป็น AGGRESSIVE หรือไม่ (GW >= LATE_SEASON_START_GW
// และตามหลัง leader เกิน LEAGUE_CHASE_GAP_PTS)
// ============================================================
function getMiniLeagueStatus() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName("LEAGUE_CONTEXT");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  const map  = {};
  data.forEach(r => { if (r[0]) map[String(r[0]).trim()] = r[1]; });

  const gw         = parseInt(map["GW"]) || 0;
  const myPts      = parseFloat(map["My Total Pts"]);
  const leaderPts  = parseFloat(map["League Leader Pts"]);
  const gap        = parseFloat(map["Gap To Leader"]);
  const amILeading = String(map["Am I Leading"]||"").toUpperCase()==="YES";
  const leaderName = String(map["League Leader"]||"").split(" (")[0];

  if (isNaN(myPts) || isNaN(leaderPts)) return null; // sheet ยังไม่ถูกอัปเดตด้วย field ใหม่

  return { gw, myPts, leaderPts, leaderName, gap: isNaN(gap)?(leaderPts-myPts):gap, amILeading };
}

function determineTacticalMode(currentGW) {
  if (currentGW < CONFIG.LATE_SEASON_START_GW) {
    return { mode:"STANDARD", reason:"ยังไม่ถึง GW"+CONFIG.LATE_SEASON_START_GW+" (late-season check)", status:null };
  }

  const status = getMiniLeagueStatus();
  if (!status) {
    return { mode:"STANDARD", reason:"ไม่มีข้อมูลมินิลีก — รัน runMiniLeague() ก่อน", status:null };
  }

  if (status.amILeading) {
    return { mode:"STANDARD", reason:"คุณนำอยู่ในมินิลีก ("+status.myPts+"pts) — เล่นมั่นคงต่อ", status };
  }

  if (status.gap > CONFIG.LEAGUE_CHASE_GAP_PTS) {
    Logger.log("🚨 LATE SEASON CHASE (GW"+currentGW+"): ตามหลัง "+status.leaderName+" "+status.gap+"pts → AGGRESSIVE");
    return {
      mode:"AGGRESSIVE",
      reason:"ตามหลัง "+status.leaderName+" "+status.gap.toFixed(0)+"pts (GW"+currentGW+"/"+CONFIG.TOTAL_GW+") — เปิดโหมดเสี่ยงเต็มตัว",
      status,
    };
  }

  return { mode:"STANDARD", reason:"ห่าง leader เพียง "+status.gap.toFixed(0)+"pts (≤"+CONFIG.LEAGUE_CHASE_GAP_PTS+") — เล่นมั่นคง", status };
}

function buildAISquad(players) {
  if (!players||!players.length) return { squad:[], itb:AI_TEAM_CONFIG.budget };
  let remaining = AI_TEAM_CONFIG.budget;
  const squad   = [], teamCount = {}, usedNames = new Set();
  const posMap  = {1:"GK",2:"DEF",3:"MID",4:"FWD"};

  // ── คำนวณ "สำรองงบขั้นต่ำ" สำหรับแต่ละตำแหน่ง ────────────────────────
  // เพื่อป้องกัน GK/DEF/MID กินงบหมดก่อน ทำให้ FWD สุดท้ายไม่มีเงินเลือก
  // minNeeded[posId] = ราคาถูกสุด N ตัว (N = จำนวน slot ของตำแหน่งนั้น)
  const minNeeded = {};
  [1,2,3,4].forEach(pid => {
    const n = (AI_TEAM_CONFIG.budgetAlloc[pid]||[]).length;
    const prices = players.filter(p=>p.POS===posMap[pid])
      .map(p=>parseFloat(String(p.PRICE||"0").replace("£","").replace("m","")))
      .filter(v=>v>0).sort((a,b)=>a-b).slice(0,n);
    minNeeded[pid] = prices.reduce((s,v)=>s+v, 0);
    Logger.log("MinNeeded "+posMap[pid]+" ("+n+" slots): £"+minNeeded[pid].toFixed(1)+"m");
  });

  [1,2,3,4].forEach(posId => {
    const posLabel = posMap[posId];
    const budgets  = AI_TEAM_CONFIG.budgetAlloc[posId];
    const cands    = players.filter(p=>p.POS===posLabel)
      .map(p => ({
        name:p.NAME, team:p.TEAM, pos:p.POS, pos_id:posId,
        price: parseFloat(String(p.PRICE||"0").replace("£","").replace("m","")),
        xpts:  parseFloat(p.xPTS||0), total_pts:parseFloat(p.TOTAL_PTS||0),
      })).filter(p=>p.price>0&&p.xpts>0).sort((a,b)=>b.xpts-a.xpts);

    budgets.forEach((maxBudget, slotIdx) => {
      // ── งบสำรองสำหรับ slot อื่นๆ ที่ยังเหลือ ──────────────────────────
      // = ราคาถูกสุดสำหรับ slot ที่เหลือในตำแหน่งนี้ + งบขั้นต่ำทุกตำแหน่งถัดไป
      const remainingSlotsInThisPos = budgets.length - slotIdx - 1;
      const futureReserve = [1,2,3,4].filter(pid=>pid>posId).reduce((s,pid)=>s+minNeeded[pid],0)
                          + remainingSlotsInThisPos * (minNeeded[posId]/budgets.length);

      const effectiveBudget = Math.max(0, remaining - futureReserve);
      const flexBudget = Math.min(maxBudget + (remaining*0.05), effectiveBudget);
      let pick = cands.find(c => !usedNames.has(c.name)&&c.price<=flexBudget&&(teamCount[c.team]||0)<AI_TEAM_CONFIG.maxPerTeam);
      if (!pick) pick = cands.find(c => !usedNames.has(c.name)&&c.price<=effectiveBudget&&(teamCount[c.team]||0)<AI_TEAM_CONFIG.maxPerTeam);
      // last resort: ignore reserve but still pick (กันกรณี pool มีน้อยมาก)
      if (!pick) pick = cands.find(c => !usedNames.has(c.name)&&c.price<=remaining&&(teamCount[c.team]||0)<AI_TEAM_CONFIG.maxPerTeam);
      if (pick) {
        squad.push({ ...pick, is_starting:false, is_captain:false, is_vice:false });
        usedNames.add(pick.name);
        teamCount[pick.team] = (teamCount[pick.team]||0)+1;
        remaining -= pick.price;
        Logger.log("  "+posLabel+"["+slotIdx+"] "+pick.name+" £"+pick.price+"m (reserve:£"+futureReserve.toFixed(1)+"m effectiveBudget:£"+effectiveBudget.toFixed(1)+"m)");
      }
    });
  });

  // ── Fallback: เติมตำแหน่งที่ขาดด้วยผู้เล่นถูกสุดที่ยังพอจ่ายได้ ──────────
  // (ป้องกัน 7DEF/4MID/2FWD เมื่อ budget หมดก่อนเติม MID/FWD)
  const need = { 1:2, 2:5, 3:5, 4:3 };
  const usedNamesSet = new Set(squad.map(p=>p.name));
  [1,2,3,4].forEach(posId => {
    const posLabel = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" }[posId];
    const have = squad.filter(p=>p.pos_id===posId||p.pos===posLabel).length;
    let missing = need[posId] - have;
    if (missing <= 0) return;
    const pool = players.filter(p=>p.POS===posLabel && !usedNamesSet.has(p.name) && p.price > 0)
      .sort((a,b)=>a.price-b.price);
    for (const c of pool) {
      if (missing <= 0) break;
      if (c.price > remaining) continue;
      if ((teamCount[c.team]||0) >= AI_TEAM_CONFIG.maxPerTeam) continue;
      squad.push({ name:c.name, team:c.team, pos:c.POS||posLabel, pos_id:posId,
                   price:c.price, xpts:c.xpts||0, is_starting:false, is_captain:false, is_vice:false });
      usedNamesSet.add(c.name);
      teamCount[c.team] = (teamCount[c.team]||0)+1;
      remaining -= c.price;
      Logger.log("  [FALLBACK] "+posLabel+" "+c.name+" £"+c.price+"m (needed "+missing+" more)");
      missing--;
    }
    if (missing > 0) Logger.log("⚠ Still missing "+missing+" "+posLabel+" — pool exhausted");
  });

  assignStartingXI(squad);
  const posCount = {GK:0,DEF:0,MID:0,FWD:0};
  squad.forEach(p=>posCount[p.pos]=(posCount[p.pos]||0)+1);
  Logger.log("Squad: "+squad.length+" | "+Object.entries(posCount).map(([k,v])=>k+":"+v).join(" ")+" | ITB:£"+remaining.toFixed(1)+"m");
  // ── ตรวจ composition ขั้นสุดท้าย (log เตือน แต่ไม่ return empty — caller ใช้ทีมที่ได้ต่อไป)
  const finalComp = [["GK",2],["DEF",5],["MID",5],["FWD",3]].map(([p,n])=>{
    const got = squad.filter(x=>x.pos===p).length;
    return p+":"+got+(got!==n?" ⚠️ (ต้องการ "+n+")":"");
  }).join(" ");
  Logger.log("Final squad "+squad.length+" players | "+finalComp);
  return { squad, itb:+remaining.toFixed(1) };
}

// mode: "STANDARD" (default) | "AGGRESSIVE" (ข้อ 2 — late-season mini-league chase)
function makeAITransfers(currentSquad, players, budget, freeTransfers, mode) {
  mode = mode || "STANDARD";
  const squad    = [...currentSquad], transfers = [];
  let   itb      = budget;
  const teamCount = {};
  squad.forEach(p => teamCount[p.team] = (teamCount[p.team]||0)+1);

  const withXpts = squad.map(p => {
    const xptsPlayer = players.find(x => x.NAME===p.name);
    return { ...p, current_xpts:parseFloat(xptsPlayer?.xPTS||p.xpts||0) };
  }).sort((a,b) => a.current_xpts - b.current_xpts);

  // ── FIX: เดิม loop วิ่งแค่ Math.min(freeTransfers,2) ครั้ง
  // ถ้า freeTransfers=1 → loop วิ่งแค่ i=0 → isHit (i>=freeTransfers) ไม่เคยเป็น true
  // → ต่อให้ mode AGGRESSIVE ต้องการ hit ก็ทำไม่ได้เลย
  // FIX: loop = freeTransfers + maxHits ครั้ง, isHit = i>=freeTransfers ทำงานถูกต้อง
  const maxHits      = mode==="AGGRESSIVE" ? CONFIG.AGGR_MAX_HITS_PER_GW : 1;
  const maxTransfers = freeTransfers + maxHits;

  // ── AGGRESSIVE: ดึงรายชื่อ differential (TSB ต่ำ) จาก MINI_LEAGUE sheet ──
  const diffNames = mode==="AGGRESSIVE"
    ? _getLeagueDifferentials(SpreadsheetApp.openById(CONFIG.SHEET_ID), CONFIG.AGGR_DIFF_TSB_MAX)
    : new Set();

  for (let i = 0; i < maxTransfers; i++) {
    const out = withXpts[i];
    if (!out) break;
    const isHit = i >= freeTransfers;

    // FT threshold / Hit threshold — mode-aware (ข้อ 2: AGGRESSIVE ใช้ threshold ต่ำกว่ามาก)
    const minGain = isHit
      ? (mode==="AGGRESSIVE" ? CONFIG.AGGR_HIT_MIN_GAIN : 8)
      : (mode==="AGGRESSIVE" ? CONFIG.AGGR_FT_MIN_GAIN  : 2);

    const currentNames = new Set(squad.map(p => p.name));
    let candidates = players.filter(p => {
      const price = parseFloat(String(p.PRICE||"0").replace("£","").replace("m",""));
      return p.POS===out.pos && !currentNames.has(p.NAME) &&
             price<=out.price+itb && parseFloat(p.xPTS||0)>out.current_xpts+minGain &&
             (teamCount[p.TEAM]||0)<AI_TEAM_CONFIG.maxPerTeam;
    });
    if (!candidates.length) continue;

    // AGGRESSIVE: ให้ differential (TSB ต่ำ) boost ใน sort เพื่อช่วยไต่ rank
    candidates = candidates.map(p => ({
      ...p, _sortXpts: parseFloat(p.xPTS||0) + (mode==="AGGRESSIVE" && diffNames.has(p.NAME) ? 1.5 : 0),
    })).sort((a,b) => b._sortXpts - a._sortXpts);

    const replacement = candidates[0];
    const inPrice   = parseFloat(String(replacement.PRICE||"0").replace("£","").replace("m",""));
    const priceDiff = inPrice - out.price;
    if (priceDiff > itb) continue;

    const idx = squad.findIndex(p => p.name===out.name);
    squad[idx] = { name:replacement.NAME, team:replacement.TEAM, pos:replacement.POS,
      pos_id:out.pos_id, price:inPrice, xpts:parseFloat(replacement.xPTS||0),
      is_starting:out.is_starting, is_captain:false, is_vice:false };
    itb -= priceDiff;
    const tag = isHit ? " [HIT-4]" : " [FT]";
    const diffTag = (mode==="AGGRESSIVE" && diffNames.has(replacement.NAME)) ? " 🎯DIFF" : "";
    transfers.push("OUT:"+out.name+"("+out.current_xpts.toFixed(1)+"xPts) -> IN:"+replacement.NAME+
      "("+parseFloat(replacement.xPTS||0).toFixed(1)+"xPts)"+tag+diffTag);
  }
  assignStartingXI(squad);
  return { squad, itb:+itb.toFixed(1), transfers, mode };
}

// ── ดึงรายชื่อ differential (TSB < maxOwnPct) จาก MINI_LEAGUE sheet ──
// อ่าน section ระหว่าง "DIFFERENTIAL" และ "CAPTAIN CHOICES"
function _getLeagueDifferentials(ss, maxOwnPct) {
  const out = new Set();
  const sheet = ss.getSheetByName("MINI_LEAGUE");
  if (!sheet) return out;

  const data = sheet.getDataRange().getValues();
  let inSection = false;
  for (const row of data) {
    const c0 = String(row[0]||"").toUpperCase();
    if (c0.includes("DIFFERENTIAL")) { inSection = true; continue; }
    if (c0.includes("CAPTAIN")) { inSection = false; continue; }
    if (!inSection) continue;
    const name    = String(row[0]||"").trim();
    const ownPct  = parseFloat(row[1]);
    if (name && name!=="NAME" && !isNaN(ownPct) && ownPct < maxOwnPct) out.add(name);
  }
  return out;
}

function assignStartingXI(squad) {
  squad.forEach(p => p.is_starting=false);
  const gks = squad.filter(p=>p.pos_id===1).sort((a,b)=>parseFloat(b.xpts||0)-parseFloat(a.xpts||0));
  if (gks[0]) gks[0].is_starting = true;
  const outfield   = squad.filter(p=>p.pos_id>1).sort((a,b)=>parseFloat(b.xpts||0)-parseFloat(a.xpts||0));
  const minPos     = { 2:3, 3:2, 4:1 };
  const posStarted = { 2:0, 3:0, 4:0 };
  let startCount   = 0;
  outfield.forEach(p => {
    if (posStarted[p.pos_id]<minPos[p.pos_id] && startCount<10) {
      p.is_starting=true; posStarted[p.pos_id]++; startCount++;
    }
  });
  outfield.filter(p=>!p.is_starting).sort((a,b)=>parseFloat(b.xpts||0)-parseFloat(a.xpts||0)).forEach(p => {
    if (startCount<10) { p.is_starting=true; startCount++; }
  });
}

function loadAIState(sheet) {
  try { const d=sheet.getRange(1,1).getValue(); return d?JSON.parse(d):{}; } catch { return {}; }
}

function saveAIState(sheet, state) {
  sheet.getRange(1,1).setValue(JSON.stringify(state));
}

function writeAITeamSheet(ss, squad, cap, vice, itb, chips, chipPlayed, gw, tactical) {
  const sheet = getOrCreateSheet(ss, "AI_TEAM");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;
  sheet.getRange(row,1,1,5).merge()
       .setValue("AI TEAM MANAGER — GW"+gw)
       .setBackground("#050810").setFontColor("#b44eff").setFontWeight("bold").setFontSize(12);
  sheet.setRowHeight(row,32); row++;

  const chipsLeft = Object.entries({tc:"TC",bb:"BB",fh:"FH",wc1:"WC1",wc2:"WC2"})
    .filter(([k])=>chips[k]).map(([,v])=>v).join(", ");
  [["ITB","£"+itb+"m","Chips Left",chipsLeft||"None"],
   ["Chip","None","Captain",cap?.name||"?"]].forEach(r => {
    [0,1,2,3].forEach(ci => sheet.getRange(row,ci+1).setValue(r[ci])
      .setFontColor(ci%2===0?"#7a8fba":"#ffffff").setFontWeight(ci%2===0?"bold":"normal").setBackground("#0c1225"));
    row++;
  });

  // ── ข้อ 2: แสดง Tactical Mode (STANDARD/AGGRESSIVE) + เหตุผล ──
  if (tactical) {
    const isAggr = tactical.mode === "AGGRESSIVE";
    sheet.getRange(row,1).setValue("Mode").setFontColor("#7a8fba").setFontWeight("bold").setBackground("#0c1225");
    sheet.getRange(row,2).setValue(isAggr ? "🚨 AGGRESSIVE" : "✅ STANDARD")
         .setFontColor(isAggr ? "#ff2d55" : "#00ff9d").setFontWeight("bold").setBackground("#0c1225");
    sheet.getRange(row,3,1,3).merge().setValue(tactical.reason)
         .setFontColor("#c5d4f0").setBackground("#0c1225").setFontSize(9);
    row++;
  }
  row++;

  const sqHeaders = ["NAME","TEAM","POS","PRICE","xPTS","ROLE"];
  row = writeSectionHeader(sheet, row, "STARTING XI", "#001a00", "#00ff9d");
  sheet.getRange(row,1,1,sqHeaders.length).setValues([sqHeaders])
       .setBackground("#002a00").setFontColor("#00ff9d").setFontWeight("bold");
  row++;
  squad.filter(p=>p.is_starting).sort((a,b)=>parseFloat(b.xpts||0)-parseFloat(a.xpts||0)).forEach(p => {
    const role = p.is_captain?"[C]":p.is_vice?"[V]":"";
    sheet.getRange(row,1,1,6).setValues([[p.name,p.team,p.pos,"£"+p.price+"m",p.xpts,role]])
         .setBackground(p.is_captain?"#1a1500":"#001a00")
         .setFontColor(p.is_captain?"#ffd60a":"#c5d4f0");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "BENCH", "#0a0a0a", "#7a8fba");
  squad.filter(p=>!p.is_starting).forEach(p => {
    sheet.getRange(row,1,1,5).setValues([[p.name,p.team,p.pos,"£"+p.price+"m",p.xpts]])
         .setBackground("#0a0a0a").setFontColor("#7a8fba");
    row++;
  });
  sheet.autoResizeColumns(1,6);
}

function runAITeamPostMortem() {
  Logger.log("=== AI TEAM POST-MORTEM ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) return;
  // หา GW ล่าสุดที่จบแล้ว
  // ตรวจ finished | data_checked | is_current (fallback กรณี FPL ยังประมวลผลไม่เสร็จ)
  const lastGWEvent = boot.events
    .filter(e => e.finished || e.data_checked || (e.is_current && new Date(e.deadline_time) < new Date()))
    .sort((a, b) => b.id - a.id)[0];
  const lastGW = lastGWEvent?.id;
  if (!lastGW) return;

  const live = fetchJSON("https://fantasy.premierleague.com/api/event/"+lastGW+"/live/");
  if (!live) return;
  const liveMap = {};
  (live.elements||[]).forEach(e => liveMap[e.id]=e.stats?.total_points||0);

  const nameToId = {};
  boot.elements.forEach(e => nameToId[e.web_name]=e.id);

  const aiState = loadAIState(ss.getSheetByName("AI_TEAM_STATE")||getOrCreateSheet(ss,"AI_TEAM_STATE"));
  const aiSquad = aiState.squad||[];

  let aiGWPts = 0;
  const aiResults = aiSquad.filter(p=>p.is_starting).map(p => {
    const pid=nameToId[p.name];
    const pts=pid?(liveMap[pid]||0):0;
    const multi=p.is_captain?2:1;
    aiGWPts+=pts*multi;
    return { name:p.name, pts, net_pts:pts*multi, is_cap:p.is_captain };
  });

  const userHistory = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/history/");
  const userGWData  = userHistory?.current?.find(g=>g.event===lastGW);
  const userGWPts   = userGWData?.points||0;
  const diff        = aiGWPts - userGWPts;

  const histSheet = getOrCreateSheet(ss, "AI_TEAM_HISTORY");
  if (histSheet.getLastRow()===0) {
    histSheet.getRange(1,1,1,6).setValues([["GW","AI_PTS","USER_PTS","DIFF","AI_CAP","TIMESTAMP"]])
             .setBackground("#1c2a50").setFontColor("#b44eff").setFontWeight("bold");
  }
  histSheet.appendRow(["GW"+lastGW, aiGWPts, userGWPts, (diff>0?"+":"")+diff,
    aiSquad.find(p=>p.is_captain)?.name||"?", new Date()]);

  Logger.log("AI:"+aiGWPts+" | User:"+userGWPts+" | Diff:"+(diff>0?"+":"")+diff);
  Logger.log("=== AI POST-MORTEM DONE ===");
}


// ============================================================
// 18. POST-MORTEM — GW REVIEW
// ============================================================

function runPostMortem() {
  Logger.log("=== GW POST-MORTEM START ===");
  const ss      = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot    = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const entry   = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/");
  const history = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/history/");
  const fix     = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot||!entry||!history) return;

  const playerMap = {};
  boot.elements.forEach(e => playerMap[e.id]={name:e.web_name, total_pts:e.total_points, now_cost:e.now_cost});
  const teamMap   = {};
  boot.teams.forEach(t => teamMap[t.id]=t.short_name);
  const CHIP_NAME = { bboost:"BB", "3xc":"TC", freehit:"FH", wildcard:"WC" };

  // หา GW ล่าสุดที่จบแล้ว
  // ตรวจ finished | data_checked | is_current (fallback กรณี FPL ยังประมวลผลไม่เสร็จ)
  const lastGWEvent = boot.events
    .filter(e => e.finished || e.data_checked || (e.is_current && new Date(e.deadline_time) < new Date()))
    .sort((a, b) => b.id - a.id)[0];
  const lastGW = lastGWEvent?.id;
  if (!lastGW) { Logger.log("❌ No finished GW"); return; }
  Logger.log("Analyzing GW" + lastGW + "...");

  Utilities.sleep(300);
  const picks = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/event/"+lastGW+"/picks/");
  Utilities.sleep(300);
  const liveData = fetchJSON("https://fantasy.premierleague.com/api/event/"+lastGW+"/live/");
  Utilities.sleep(300);
  const transfers = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/transfers/");
  if (!picks||!liveData) { Logger.log("❌ No picks/live data"); return; }

  const liveMap = {};
  (liveData.elements||[]).forEach(e => {
    liveMap[e.id] = { pts:e.stats?.total_points||0, minutes:e.stats?.minutes||0,
      goals:e.stats?.goals_scored||0, assists:e.stats?.assists||0,
      cs:e.stats?.clean_sheets||0, bonus:e.stats?.bonus||0,
      yellow:e.stats?.yellow_cards||0 };
  });

  const gwHistory  = history.current||[];
  const lastGWData = gwHistory.find(g=>g.event===lastGW)||{};
  const prevGWData = gwHistory.find(g=>g.event===lastGW-1)||{};
  const myGWPts    = lastGWData.points||0;
  const hitTaken   = lastGWData.event_transfers_cost||0;
  const myNetPts   = myGWPts - hitTaken;
  const myRankBefore = prevGWData.overall_rank||0;
  const myRankAfter  = lastGWData.overall_rank||0;
  const rankChange   = myRankBefore - myRankAfter;
  const chipPlayed   = lastGWData.chip ? (CHIP_NAME[lastGWData.chip]||lastGWData.chip) : "";

  const myPicks    = picks.picks||[];
  const capPick    = myPicks.find(p=>p.is_captain);
  const vicePick   = myPicks.find(p=>p.is_vice_captain);
  const capId      = capPick?.element;
  const viceId     = vicePick?.element;
  const capLive    = liveMap[capId]||{};
  const capPts     = capLive.pts||0;
  const capNetPts  = capPts * (chipPlayed==="TC"?3:2);
  const vicePts    = (liveMap[viceId]||{}).pts||0;

  const starting   = myPicks.filter(p=>p.position<=11);
  const bestCap    = starting.map(p=>({...p,pts:liveMap[p.element]?.pts||0})).sort((a,b)=>b.pts-a.pts)[0];
  const bestCapPts = bestCap?.pts||0;
  const bestCapNetPts = bestCapPts*2;
  const capDecisionGain = capNetPts - bestCapNetPts;

  const squadDetails = myPicks.map(p => {
    const live=liveMap[p.element]||{};
    const player=playerMap[p.element]||{};
    const rawPts=live.pts||0;
    return {
      player_id:p.element, name:player.name||"?", slot:p.position,
      is_start:p.position<=11, is_cap:p.is_captain, is_vice:p.is_vice_captain,
      multiplier:p.multiplier||1, minutes:live.minutes||0, goals:live.goals||0,
      assists:live.assists||0, cs:live.cs||0, bonus:live.bonus||0,
      raw_pts:rawPts, net_pts:rawPts*(p.multiplier||1),
    };
  }).sort((a,b)=>b.net_pts-a.net_pts);

  const gwTransfers = (transfers||[]).filter(t=>t.event===lastGW);
  const transferDetails = gwTransfers.map(t => {
    const soldPts   = liveMap[t.element_out]?.pts||0;
    const boughtPts = liveMap[t.element_in]?.pts||0;
    const gain      = boughtPts - soldPts;
    return {
      sold:playerMap[t.element_out]?.name||"?", bought:playerMap[t.element_in]?.name||"?",
      sold_pts:soldPts, bought_pts:boughtPts, gain,
      verdict: gain>4?"GREAT":gain>0?"GOOD":gain===0?"NEUTRAL":gain>-4?"POOR":"BAD",
    };
  });
  const hitCostNetted = hitTaken>0 ? transferDetails.reduce((s,t)=>s+t.gain,0)-hitTaken : 0;

  const myPlayerIds = new Set(myPicks.map(p=>p.element));
  const missedOpp   = boot.elements.filter(p=>!myPlayerIds.has(p.id)&&p.minutes>0)
    .map(p=>({...p, gw_pts:liveMap[p.id]?.pts||0}))
    .filter(p=>p.gw_pts>=12).sort((a,b)=>b.gw_pts-a.gw_pts).slice(0,5)
    .map(p=>({ name:p.web_name, team:teamMap[p.team]||"?", gw_pts:p.gw_pts }));

  // AI analysis
  const aiPostmortem = analyzePostMortem({
    lastGW, myGWPts, myNetPts, hitTaken, chipPlayed, rankChange, myRankAfter,
    capName:playerMap[capId]?.name||"?", capPts, capNetPts,
    bestCapName:playerMap[bestCap?.element]?.name||"?", bestCapPts,
    capDecisionGain, transferDetails, hitCostNetted, missedOpp,
  });

  // เขียน POST_MORTEM sheet
  const sheet = getOrCreateSheet(ss, "POST_MORTEM");
  sheet.insertRowsBefore(1, 55);
  let row = 1;

  sheet.getRange(row,1,1,6).merge()
       .setValue("GW"+lastGW+" POST-MORTEM — "+new Date().toLocaleDateString("th-TH"))
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(12);
  row++;

  row = writeSectionHeader(sheet, row, "GW SUMMARY", "#0a1a0a", "#00f5ff");
  [["GW Points",myGWPts,"Hit Cost",hitTaken?"-"+hitTaken:"None"],
   ["Net Points",myNetPts,"Chip",chipPlayed||"None"],
   ["Rank Before",(myRankBefore||0).toLocaleString(),"Rank After",(myRankAfter||0).toLocaleString()],
   ["Rank Change",(rankChange>0?"▲ +":"▼ ")+Math.abs(rankChange).toLocaleString(),"Bench Pts",
    squadDetails.filter(p=>!p.is_start).reduce((s,p)=>s+p.raw_pts,0)],
  ].forEach(r => {
    sheet.getRange(row,1).setValue(r[0]).setFontColor("#7a8fba").setFontWeight("bold");
    sheet.getRange(row,2).setValue(r[1]).setFontColor(
      r[0]==="Rank Change"?(rankChange>0?"#00ff9d":rankChange<0?"#ff2d55":"#c5d4f0"):"#ffffff"
    ).setFontWeight(r[0]==="Rank Change"?"bold":"normal");
    sheet.getRange(row,3).setValue(r[2]).setFontColor("#7a8fba").setFontWeight("bold");
    sheet.getRange(row,4).setValue(r[3]).setFontColor("#ffffff");
    sheet.getRange(row,1,1,4).setBackground("#0c1225");
    row++;
  });
  row++;

  row = writeSectionHeader(sheet, row, "CAPTAIN ANALYSIS", "#1a1500", "#ffd60a");
  [["Captain",playerMap[capId]?.name||"?","Points",capPts+"pts (x"+(chipPlayed==="TC"?3:2)+"="+capNetPts+"pts)"],
   ["Vice",playerMap[viceId]?.name||"?","Points",vicePts+"pts"],
   ["Best Pick",playerMap[bestCap?.element]?.name||"?","Points",bestCapPts+"pts (x2="+bestCapNetPts+"pts)"],
   ["Decision",capDecisionGain>=0?"✅ ถูก (+"+capDecisionGain+"pts)":"❌ ควรเลือก "+(playerMap[bestCap?.element]?.name||"?")+" ("+capDecisionGain+"pts)","",""],
  ].forEach(r => {
    const isDec = r[0]==="Decision";
    sheet.getRange(row,1).setValue(r[0]).setFontColor("#7a8fba").setFontWeight("bold");
    sheet.getRange(row,2).setValue(r[1]).setFontColor(isDec?(capDecisionGain>=0?"#00ff9d":"#ff2d55"):"#ffffff").setFontWeight(isDec?"bold":"normal");
    if (r[2]) { sheet.getRange(row,3).setValue(r[2]).setFontColor("#7a8fba").setFontWeight("bold"); sheet.getRange(row,4).setValue(r[3]).setFontColor("#ffffff"); }
    sheet.getRange(row,1,1,4).setBackground("#1a1500");
    row++;
  });
  row++;

  if (transferDetails.length > 0) {
    row = writeSectionHeader(sheet, row, "TRANSFER REVIEW", "#001a00", "#00ff9d");
    sheet.getRange(row,1,1,6).setValues([["SOLD","SOLD PTS","BOUGHT","BOUGHT PTS","GAIN","VERDICT"]])
         .setBackground("#002a00").setFontColor("#00ff9d").setFontWeight("bold");
    row++;
    transferDetails.forEach(t => {
      sheet.getRange(row,1,1,6).setValues([[t.sold,t.sold_pts,t.bought,t.bought_pts,(t.gain>0?"+":"")+t.gain,t.verdict]])
           .setBackground(t.gain>0?"#001a00":t.gain<-4?"#1a0000":"#0c1225")
           .setFontColor(t.gain>0?"#00ff9d":t.gain<0?"#ff6b6b":"#c5d4f0");
      row++;
    });
    if (hitTaken>0) {
      sheet.getRange(row,1,1,4).setValues([["Hit:-"+hitTaken+"pts","Net:"+hitCostNetted+"pts",hitCostNetted>0?"✅ Worth it":"❌ Not worth it",""]])
           .setBackground("#1a0a00").setFontColor(hitCostNetted>0?"#00ff9d":"#ff2d55").setFontWeight("bold");
      row++;
    }
    row++;
  }

  row = writeSectionHeader(sheet, row, "SQUAD PERFORMANCE", "#0a0a1a", "#b44eff");
  sheet.getRange(row,1,1,9).setValues([["NAME","SLOT","MIN","G","A","CS","BONUS","RAW","NET"]])
       .setBackground("#0f1830").setFontColor("#b44eff").setFontWeight("bold");
  row++;
  squadDetails.forEach(p => {
    const bg = p.net_pts>=12?"#003300":p.net_pts>=6?"#001a00":p.minutes===0?"#1a0000":"#0c1225";
    const fc = p.net_pts>=12?"#00ff9d":p.minutes===0?"#ff6b6b":"#c5d4f0";
    const slot = p.is_start?p.slot:"B"+(p.slot-11);
    sheet.getRange(row,1,1,9).setValues([[
      p.name+(p.is_cap?" [C]":p.is_vice?" [V]":""),slot,p.minutes,p.goals,p.assists,p.cs,p.bonus,p.raw_pts,p.net_pts,
    ]]).setBackground(bg).setFontColor(fc);
    if (p.is_cap) sheet.getRange(row,1).setFontColor("#ffd60a");
    row++;
  });
  row++;

  if (missedOpp.length > 0) {
    row = writeSectionHeader(sheet, row, "MISSED OPPORTUNITIES", "#1a0a00", "#ff6a00");
    sheet.getRange(row,1,1,3).setValues([["NAME","TEAM","GW PTS"]]).setBackground("#1a0a00").setFontColor("#ff6a00").setFontWeight("bold");
    row++;
    missedOpp.forEach(p => {
      sheet.getRange(row,1,1,3).setValues([[p.name,p.team,p.gw_pts]]).setBackground("#1a0a00").setFontColor("#ff9a00");
      row++;
    });
    row++;
  }

  if (aiPostmortem) {
    row = writeSectionHeader(sheet, row, "AI POST-MORTEM ANALYSIS", "#0a0a1a", "#b44eff");
    sheet.getRange(row,1,1,6).merge().setValue(aiPostmortem)
         .setBackground("#08080f").setFontColor("#c5d4f0")
         .setFontFamily("Courier New").setFontSize(10).setWrap(true).setVerticalAlignment("top");
    sheet.setRowHeight(row,200); row++;
  }

  sheet.getRange(row,1,1,6).setBackground("#1c2a50"); row++;
  sheet.autoResizeColumns(1,6);

  sendPostMortemEmail(ss, lastGW, {
    myGWPts, myNetPts, hitTaken, chipPlayed, rankChange, myRankAfter,
    capName:playerMap[capId]?.name||"?", capNetPts, capDecisionGain,
    bestCapName:playerMap[bestCap?.element]?.name||"?", bestCapPts,
    transferDetails, missedOpp, aiPostmortem,
  });

  logRun(ss, "PostMortem", "GW"+lastGW+" analyzed", "SUCCESS");
  Logger.log("=== POST-MORTEM DONE ===");

  // รัน AI Team Post-Mortem ต่อทันที เพื่ออัปเดต AI_TEAM_HISTORY
  try {
    Logger.log("▶ Running AI Team Post-Mortem...");
    runAITeamPostMortem();
  } catch(e) {
    Logger.log("⚠ AI Post-Mortem: " + e.message);
  }
}

// ============================================================
// 18. POST-MORTEM — Next-Week Blind Test (3 Teams Comparison)
// ============================================================
/**
 * ข้อ 3: Blind Test เฉพาะสัปดาห์ถัดไป (ไม่จำลองทั้งซีซัน) — เปรียบเทียบ 3 ทีม:
 *   A) ทีมจริงของคุณ      — จัด XI ที่ดีที่สุดจาก 15 คนเดิม (ไม่มีการโยกย้าย)
 *   B) Gemini Alpha (STANDARD)   — โยกย้ายตาม threshold ปกติ (SIM_FT_MIN_GAIN/SIM_HIT_MIN_GAIN)
 *   C) Gemini Beta  (AGGRESSIVE) — โยกย้ายแบบเสี่ยง/เน้น differential (ข้อ 2 — AGGR_*)
 *
 * ใช้ข้อมูลสดจาก FPL API ของฤดูกาล 26/27 + blend กับ baseline 25/26 ถ้า
 * GW <= CONFIG.BASELINE_BLEND_GW (ข้อ 4, ใช้ฟังก์ชันร่วมกับ runXPtsCalculator)
 */

// ── สร้าง pool ผู้เล่นสดสำหรับ GW ถัดไป ──────────────────────────
// targetGW: GW ที่จะ project | mustIncludeIds: player ID ที่ต้องอยู่ใน pool เสมอ (squad ผู้ใช้)
function _buildLiveNextGWPool(boot, fix, targetGW, mustIncludeIds) {
  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  // candidate pool = squad ผู้ใช้ (ต้องมีครบ) + top-N ต่อตำแหน่ง (by total_points) สำหรับหา transfer target
  const capPerPos = { 1:15, 2:25, 3:25, 4:20 };
  const idSet = new Set(mustIncludeIds);
  [1,2,3,4].forEach(posId => {
    boot.elements.filter(p => p.element_type===posId)
      .sort((a,b)=>b.total_points-a.total_points)
      .slice(0, capPerPos[posId])
      .forEach(p => idSet.add(p.id));
  });

  // ── ข้อ 4: GW1-5 blend กับ baseline 25/26 (ใช้ฟังก์ชันร่วมกับ runXPtsCalculator) ──
  const ss          = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const useBaseline = targetGW <= CONFIG.BASELINE_BLEND_GW;
  const baselineMap = useBaseline ? _getBaseline2526Map(ss) : {};
  const blendW      = useBaseline
    ? Math.max(0, (CONFIG.BASELINE_BLEND_GW - (targetGW-1)) / CONFIG.BASELINE_BLEND_GW)
    : 0;
  if (useBaseline) {
    Logger.log("🔄 [NextWeekBlindTest] BASELINE BLEND: GW"+targetGW+"/"+CONFIG.BASELINE_BLEND_GW+
      " | weight="+(blendW*100).toFixed(0)+"% | players matched: "+Object.keys(baselineMap).length);
  }

  const teamForm = buildTeamForm(boot.teams, fix.filter(f=>f.finished));
  const upcoming = fix.filter(f => !f.finished && f.event===targetGW);

  const pool = [];
  const ids  = Array.from(idSet);
  ids.forEach((pid, i) => {
    const p = boot.elements.find(e=>e.id===pid);
    if (!p) return;
    if (i % 20 === 0) Logger.log("  [NextWeekBlindTest] pool "+i+"/"+ids.length+"...");
    Utilities.sleep(150);

    const summary = fetchJSON("https://fantasy.premierleague.com/api/element-summary/"+pid+"/");
    const history = summary?.history || [];
    const recent5 = [...history].sort((a,b)=>b.round-a.round).slice(0,5);

    let avgPts5 = recent5.length ? recent5.reduce((s,g)=>s+g.total_points,0)/recent5.length : 0;
    let avgMin5 = recent5.length ? recent5.reduce((s,g)=>s+(g.minutes||0),0)/recent5.length : 0;
    let avgBPS5 = recent5.length ? recent5.reduce((s,g)=>s+(g.bps||0),0)/recent5.length : 0;
    let xgcAvg5 = recent5.length ? recent5.reduce((s,g)=>s+parseFloat(g.expected_goals_conceded||0),0)/recent5.length : 0;

    // ── ข้อ 4: blend กับ baseline 25/26 (เหมือน runXPtsCalculator) ──
    if (useBaseline) {
      const base = baselineMap[p.web_name];
      if (base) {
        avgPts5 = avgPts5*(1-blendW) + base.avgPts*blendW;
        avgMin5 = avgMin5*(1-blendW) + base.avgMin*blendW;
        avgBPS5 = avgBPS5*(1-blendW) + base.avgBPS*blendW;
        xgcAvg5 = xgcAvg5*(1-blendW) + base.avgXGC*blendW;
      }
    }

    // ── fixture(s) สำหรับ targetGW (รองรับ DGW) ──
    const myFixtures = upcoming.filter(f=>f.team_h===p.team || f.team_a===p.team);
    const numFix = myFixtures.length;
    const hasFix = numFix > 0;
    const isDGW  = numFix >= 2;
    let fdr=3, venue="H", oppId=null;
    if (hasFix) {
      const f0 = myFixtures[0];
      const isHome = f0.team_h===p.team;
      fdr   = isHome ? f0.team_h_difficulty : f0.team_a_difficulty;
      venue = isHome ? "H" : "A";
      oppId = isHome ? f0.team_a : f0.team_h;
    }

    const fdrFactor  = hasFix ? (CONFIG.FDR_FACTORS[Math.round(fdr)]||1.0) : 0;
    const venFactor  = venue==="H" ? CONFIG.HOME_ATT_BONUS : 1.0;
    const minFactor  = avgMin5>=CONFIG.MIN_HIGH ? CONFIG.MIN_FACTOR_HIGH
                      : avgMin5>=CONFIG.MIN_MID ? CONFIG.MIN_FACTOR_MID : CONFIG.MIN_FACTOR_LOW;
    const bpsFactor  = CONFIG.BPS_TIERS.find(([t])=>avgBPS5>=t)?.[1]||1.0;
    const pen = p.penalties_order||0, corner=p.corners_and_indirect_freekicks_order||0, fk=p.direct_freekicks_order||0;
    const spBonus = pen===1?CONFIG.SP_PEN_FIRST:[corner,fk].includes(1)?CONFIG.SP_CORNER_FIRST:[pen,corner,fk].includes(2)?CONFIG.SP_SECOND:1.0;
    const avFactor   = p.status==="a"?1.0:p.status==="d"?0.5:0.0;

    // Clean sheet probability (GK/DEF/MID)
    const posId = p.element_type;
    let csProbability = 0;
    if (posId<=3 && hasFix) {
      const csBase    = CONFIG.CS_PROB_BASE[Math.round(fdr)]||0.12;
      const teamXGC   = xgcAvg5>0 ? xgcAvg5 : 1.5;
      const xgcFactor = teamXGC<=0.8?1.2:teamXGC<=1.2?1.0:teamXGC<=1.8?0.85:0.7;
      const myFormPts = teamForm[p.team]?.pts||7;
      const formFactor= myFormPts>=12?1.15:myFormPts>=8?1.0:myFormPts>=4?0.9:0.75;
      const csVenue   = venue==="H"?CONFIG.HOME_CS_BONUS:CONFIG.AWAY_CS_PENALTY;
      csProbability   = Math.min(CONFIG.CS_PROB_MAX, csBase*xgcFactor*formFactor*csVenue);
    }
    const csPoints   = [0,6,6,1,0][posId]||0;
    const csExpected = csProbability * csPoints;

    const xptsPerFix = hasFix
      ? (avgPts5*fdrFactor*venFactor*avFactor*spBonus*minFactor*bpsFactor + csExpected)
      : 0;
    const simXpts = +(isDGW ? xptsPerFix*CONFIG.SIM_DGW_BOOST : xptsPerFix).toFixed(2);

    pool.push({
      pid, name:p.web_name, team:teamMap[p.team]||"?", pos:posMap[posId]||"?", posId,
      price:+(p.now_cost/10).toFixed(1), simXpts,
      avgPts:+avgPts5.toFixed(2), avgMin:+avgMin5.toFixed(1),
      hasFix, fdr, venue, isDGW, numFix, opp: oppId?teamMap[oppId]:"BGW",
      tsb: +p.selected_by_percent || 0,
    });
  });

  return pool.sort((a,b)=>b.simXpts-a.simXpts);
}

// ── รวม xPts ของ XI + captain (captain นับซ้ำอีก 1 เท่า = รวม 2x) ──
function _blindProjectedXpts(squad) {
  const starting = squad.filter(p=>p.is_starting);
  const sum = starting.reduce((s,p)=>s+(p.xpts||0), 0);
  const cap = starting.find(p=>p.is_captain);
  return sum + (cap?.xpts || 0);
}

// ── เขียน block 1 ทีม (เริ่มที่ column `col`, กว้าง 4 cols) ──
function _writeBlindTeamBlock(sheet, col, title, squad, projXpts, itb, ftRemaining, xferLog, hits, mode, accentColor) {
  let row = 3;
  sheet.getRange(row,col,1,4).merge().setValue(title)
       .setBackground("#0c1225").setFontColor(accentColor||"#ffd60a").setFontWeight("bold").setFontSize(11);
  sheet.setRowHeight(row, 26);
  row++;

  const netLabel = hits>0 ? projXpts.toFixed(1)+" pts (หัก hit -"+(hits*CONFIG.HIT_COST)+")" : projXpts.toFixed(1)+" pts";
  sheet.getRange(row,col).setValue("Proj. xPts").setFontColor("#7a8fba").setFontWeight("bold");
  sheet.getRange(row,col+1,1,3).merge().setValue(netLabel)
       .setFontColor("#00ff9d").setFontWeight("bold").setFontSize(12);
  row++;

  sheet.getRange(row,col).setValue("ITB").setFontColor("#7a8fba").setFontWeight("bold");
  sheet.getRange(row,col+1).setValue("£"+itb+"m").setFontColor("#ffffff");
  sheet.getRange(row,col+2).setValue("FT").setFontColor("#7a8fba").setFontWeight("bold");
  sheet.getRange(row,col+3).setValue(ftRemaining).setFontColor("#ffffff");
  row++;
  row++; // blank

  const xi = squad.filter(p=>p.is_starting).sort((a,b)=>(b.xpts||0)-(a.xpts||0));
  const bn = squad.filter(p=>!p.is_starting);

  sheet.getRange(row,col,1,4).setValues([["XI","POS","£m","xPTS"]])
       .setBackground("#002a00").setFontColor("#00ff9d").setFontWeight("bold");
  row++;
  xi.forEach(p=>{
    const role = p.is_captain?" (C)":p.is_vice?" (V)":"";
    sheet.getRange(row,col,1,4).setValues([[p.name+role, p.pos, p.price, (p.xpts||0).toFixed(1)]])
         .setBackground(p.is_captain?"#1a1500":"#001a00")
         .setFontColor(p.is_captain?"#ffd60a":"#c5d4f0");
    row++;
  });

  sheet.getRange(row,col,1,4).setValues([["BENCH","POS","£m","xPTS"]])
       .setBackground("#0a0a0a").setFontColor("#7a8fba").setFontWeight("bold");
  row++;
  bn.forEach(p=>{
    sheet.getRange(row,col,1,4).setValues([[p.name, p.pos, p.price, (p.xpts||0).toFixed(1)]])
         .setBackground("#0a0a0a").setFontColor("#7a8fba");
    row++;
  });

  row++; // blank
  if (xferLog.length) {
    sheet.getRange(row,col,1,4).merge().setValue("TRANSFERS ("+mode+")")
         .setBackground("#1a0a00").setFontColor("#ff9a00").setFontWeight("bold");
    row++;
    xferLog.forEach(l=>{
      sheet.getRange(row,col,1,4).merge().setValue(l)
           .setFontColor("#c5d4f0").setFontSize(9).setWrap(true).setBackground("#0c1225");
      sheet.setRowHeight(row, 32);
      row++;
    });
  } else if (mode!=="ACTUAL") {
    sheet.getRange(row,col,1,4).merge().setValue("ไม่มีการโยกย้าย (bank FT)")
         .setFontColor("#7a8fba").setFontSize(9).setBackground("#0c1225");
    row++;
  }
  return row;
}

function runNextWeekBlindTest() {
  Logger.log("=== NEXT-WEEK BLIND TEST START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const fix  = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot || !fix) { Logger.log("❌ ดึงข้อมูล FPL ไม่ได้"); return; }

  const targetGW = (
    boot.events.find(e => e.is_next) || boot.events.find(e => e.is_current) ||
    boot.events[boot.events.length - 1]
  ).id;

  // หา GW ล่าสุดที่จบแล้ว เพื่อดึง squad ปัจจุบันของผู้ใช้
  const lastGWEvent = boot.events
    .filter(e => e.finished || e.data_checked || (e.is_current && new Date(e.deadline_time) < new Date()))
    .sort((a,b)=>b.id-a.id)[0];
  const lastGW = lastGWEvent?.id;

  let picks = null;
  if (lastGW) {
    picks = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/event/"+lastGW+"/picks/");
  }
  if (!picks?.picks) {
    // preseason fallback: ลอง targetGW (เช่น GW1) ตรงๆ — เผื่อตั้งทีมไว้แล้วแต่ยังไม่มี GW จบ
    picks = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/event/"+targetGW+"/picks/");
  }
  if (!picks?.picks || picks.picks.length < 15) {
    Logger.log("❌ ไม่พบ squad ปัจจุบัน (FPL_TEAM_ID="+CONFIG.FPL_TEAM_ID+") — ตรวจสอบว่าตั้งทีมแล้วหรือยัง");
    const sheet = getOrCreateSheet(ss, "NEXT_WEEK_BLIND_TEST");
    sheet.clearContents();
    sheet.getRange(1,1).setValue("❌ ไม่พบ squad ปัจจุบัน — ตรวจสอบ CONFIG.FPL_TEAM_ID และว่าตั้งทีมในเว็บ FPL แล้ว");
    return;
  }

  const itb = +((picks.entry_history?.bank||0)/10).toFixed(1);
  // ประมาณ FT: ถ้า GW ก่อนหน้าไม่ได้โยกย้ายเลย → มักมี 2 FT (rollover, สูงสุดตามกฎใหม่); ไม่งั้น 1
  const ft  = (picks.entry_history?.event_transfers === 0) ? 2 : 1;
  const squadIds = picks.picks.map(p=>p.element);
  Logger.log("GW"+targetGW+" | squad: "+squadIds.length+" players | ITB:£"+itb+"m | FT(est):"+ft);

  // ── สร้าง live pool (รวม baseline blend ถ้า GW<=BASELINE_BLEND_GW ตามข้อ 4) ──
  const pool = _buildLiveNextGWPool(boot, fix, targetGW, squadIds);
  if (!pool.length) { Logger.log("❌ pool ว่าง"); return; }

  // ── Team A: ทีมจริงของคุณ — จัด XI ที่ดีที่สุดจาก 15 คนเดิม (ไม่มีการโยกย้าย) ──
  let squadA = squadIds.map(pid => {
    const p = pool.find(x=>x.pid===pid);
    if (!p) return null;
    return { name:p.name, team:p.team, pos:p.pos, posId:p.posId, price:p.price,
             xpts:p.simXpts, is_starting:false, is_captain:false, is_vice:false };
  }).filter(Boolean);

  if (squadA.length < 15) {
    Logger.log("⚠ squad A มี "+squadA.length+"/15 (บางคนไม่อยู่ใน pool) — เติมจาก pool");
    squadA = _blindValidateSquad(squadA, pool, itb);
  }
  _blindAssignXI(squadA, pool);
  _blindForceXI(squadA);
  const projA = _blindProjectedXpts(squadA);

  // ── Team B: Gemini Alpha (STANDARD) ──────────────────────────
  const stateB = { squad: squadA.map(p=>({...p})), itb, ft };
  const resB   = _blindTransfer(stateB, pool, "STANDARD");
  _blindForceXI(resB.squad);
  const projB  = _blindProjectedXpts(resB.squad) - resB.hits*CONFIG.HIT_COST;

  // ── Team C: Gemini Beta (AGGRESSIVE — ข้อ 2) ─────────────────
  const stateC = { squad: squadA.map(p=>({...p})), itb, ft };
  const resC   = _blindTransfer(stateC, pool, "AGGRESSIVE");
  _blindForceXI(resC.squad);
  const projC  = _blindProjectedXpts(resC.squad) - resC.hits*CONFIG.HIT_COST;

  Logger.log("Proj xPts — A(actual):"+projA.toFixed(1)+" | B(standard):"+projB.toFixed(1)+" | C(aggressive):"+projC.toFixed(1));

  // ── เขียนชีท NEXT_WEEK_BLIND_TEST ─────────────────────────────
  const sheet = getOrCreateSheet(ss, "NEXT_WEEK_BLIND_TEST");
  sheet.clearContents(); sheet.clearFormats();

  sheet.getRange(1,1,1,15).merge()
    .setValue("⚽ NEXT-WEEK BLIND TEST — GW"+targetGW+"  (เป้าหมายซีซัน: "+CONFIG.TARGET_PTS+"pts)")
    .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(14);
  sheet.setRowHeight(1, 34);

  const r1 = _writeBlindTeamBlock(sheet, 1,  "1) ทีมจริงของคุณ",            squadA,     projA, itb,      ft,               [],         0,         "ACTUAL",     "#00f5ff");
  const r2 = _writeBlindTeamBlock(sheet, 6,  "2) Gemini Alpha (STANDARD)",  resB.squad, projB, resB.itb, resB.ftRemaining, resB.log,   resB.hits, "STANDARD",   "#00ff9d");
  const r3 = _writeBlindTeamBlock(sheet, 11, "3) Gemini Beta (AGGRESSIVE)", resC.squad, projC, resC.itb, resC.ftRemaining, resC.log,   resC.hits, "AGGRESSIVE", "#ff2d55");

  for (let c=1; c<=15; c++) sheet.setColumnWidth(c, c%5===0 ? 16 : 95);

  // ── AI commentary (เทียบ 3 ทีม + บอกโหมด tactical ปัจจุบัน) ──
  const tactical = determineTacticalMode(targetGW);
  const prompt = "APEX NEXT-WEEK BLIND TEST — GW"+targetGW+" (เป้าหมายซีซัน "+CONFIG.TARGET_PTS+"pts)\n"+
    "A) ทีมจริง (ไม่เปลี่ยนทีม): "+projA.toFixed(1)+" xPts\n"+
    "B) Gemini Alpha (STANDARD): "+projB.toFixed(1)+" xPts | โยกย้าย: "+(resB.log.join("; ")||"ไม่มี")+"\n"+
    "C) Gemini Beta (AGGRESSIVE): "+projC.toFixed(1)+" xPts | โยกย้าย: "+(resC.log.join("; ")||"ไม่มี")+"\n"+
    "Tactical Mode ปัจจุบัน: "+tactical.mode+" — "+tactical.reason+"\n"+
    "วิเคราะห์: แนะนำว่าควรใช้ทีมไหนสำหรับ GW"+targetGW+" และทำไม (พิจารณา xPts, ความเสี่ยง hit, และ tactical mode) ตอบไทย กระชับ 3-4 บรรทัด";
  const ai = callGemini(prompt);

  const maxRow = Math.max(r1, r2, r3) + 1;
  let row = writeSectionHeader(sheet, maxRow, "AI ANALYSIS", "#0a0a1a", "#b44eff");
  sheet.getRange(row,1,1,15).merge().setValue(ai||"(ไม่มี Gemini key หรือ callGemini ล้มเหลว)")
       .setFontColor("#c5d4f0").setBackground("#08080f").setFontFamily("Courier New").setFontSize(10)
       .setWrap(true).setVerticalAlignment("top");
  sheet.setRowHeight(row, 130);

  sheet.setFrozenRows(2);
  logRun(ss, "NextWeekBlindTest",
    "GW"+targetGW+" | A:"+projA.toFixed(1)+" B:"+projB.toFixed(1)+" C:"+projC.toFixed(1)+" | Mode:"+tactical.mode,
    "SUCCESS");
  Logger.log("=== NEXT-WEEK BLIND TEST DONE ===");
}

function analyzePostMortem(data) {
  const userChoseCorrectly = data.capDecisionGain >= 0;
  const capVerdict = userChoseCorrectly
    ? "✅ เลือก "+data.capName+" ถูก ("+data.capNetPts+"pts) ดีกว่า "+data.bestCapName+" ("+data.bestCapPts*2+"pts) อยู่ "+data.capDecisionGain+"pts"
    : "❌ เลือก "+data.capName+" ("+data.capNetPts+"pts) ผิด — ควรเลือก "+data.bestCapName+" ("+data.bestCapPts*2+"pts) จะได้เพิ่ม "+Math.abs(data.capDecisionGain)+"pts";
  const xferSummary = data.transferDetails?.map(t=>"ขาย "+t.sold+"("+t.sold_pts+"pts) -> ซื้อ "+t.bought+"("+t.bought_pts+"pts) ["+t.verdict+"]").join("; ")||"ไม่มี";
  const missedSummary = data.missedOpp?.map(p=>p.name+"("+p.gw_pts+"pts)").join(", ")||"ไม่มี";
  return callGemini(`APEX QUANT — GW${data.lastGW} Post-Mortem
แต้ม: ${data.myGWPts}pts (net:${data.myNetPts}) Hit:${data.hitTaken?"-"+data.hitTaken:"ไม่มี"} Chip:${data.chipPlayed||"ไม่ได้ใช้"}
Rank: ${data.rankChange>0?"▲ขึ้น":"▼ลง"} ${Math.abs(data.rankChange).toLocaleString()} -> ${(data.myRankAfter||0).toLocaleString()}
Captain: ${capVerdict}
Transfers: ${xferSummary}
Missed: ${missedSummary}
วิเคราะห์: 1.VERDICT 2.CAPTAIN(${userChoseCorrectly?"ถูก":"ผิด-ควรเลือก "+data.bestCapName}) 3.TRANSFER 4.MISTAKE 5.LESSON
ห้ามขัดแย้งกับข้อมูล captain ด้านบน ตอบไทย กระชับ`);
}


// ============================================================
// 19. SEASON MANAGER — PAUSE / RESUME
// ============================================================

function runSeasonManager() {
  Logger.log("=== SEASON MANAGER CHECK ===");
  try {
    const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
    if (!boot) return;

    const events        = boot.events||[];
    const allFinished   = events.filter(e => e.finished||e.is_finished);
    const isSeasonEnd   = allFinished.length >= 38;
    const nextSeasonGW1 = events.find(e => e.id===1 && !e.finished);
    const now           = new Date();
    const props         = PropertiesService.getScriptProperties();

    if (isSeasonEnd) {
      // ── ตรวจสอบ trigger ตัวเอง: ต้องมี runSeasonManager เพียง 1 ตัวเท่านั้น ──
      // (ป้องกัน bug เดิม: สร้าง trigger ใหม่ทุกครั้งที่รัน → ทวีคูณจนชน quota 20 ตัว)
      const myTriggers = ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction()==="runSeasonManager");

      if (myTriggers.length !== 1) {
        Logger.log("Season ended — fixing triggers (พบ runSeasonManager " + myTriggers.length + " ตัว)...");
        pauseAllTriggers(); // ลบ trigger ทั้งหมด รวม runSeasonManager เดิม
        try {
          ScriptApp.newTrigger("runSeasonManager").timeBased().everyDays(3).atHour(2).create();
          Logger.log("✓ ตั้ง monitoring trigger ใหม่ (1 ตัว, ทุก 3 วัน)");
        } catch(e2) {
          Logger.log("⚠ สร้าง monitoring trigger ไม่ได้: " + e2.message);
        }
      } else {
        Logger.log("Season ended — monitoring trigger ปกติ (1 ตัว) ไม่ต้องทำอะไร");
      }

      // ── ส่ง season-end email แค่ครั้งเดียวต่อซีซัน (กัน spam) ──
      const lastEvent = events[events.length-1];
      const seasonKey = "S_" + (lastEvent?.deadline_time || "unknown");
      if (props.getProperty("SEASON_END_EMAIL_SENT") !== seasonKey) {
        sendSeasonEndEmail();
        props.setProperty("SEASON_END_EMAIL_SENT", seasonKey);
        Logger.log("✓ ส่ง season-end email แล้ว");
      } else {
        Logger.log("Season-end email ส่งไปแล้ว — skip");
      }

    } else if (nextSeasonGW1) {
      const deadline  = new Date(nextSeasonGW1.deadline_time);
      const daysUntil = (deadline - now) / (1000*60*60*24);
      if (daysUntil <= 7 && daysUntil > 0) {
        Logger.log("New season in " + Math.round(daysUntil) + " days — restarting...");
        resumeAllTriggers();

        const startKey = "S_" + nextSeasonGW1.deadline_time;
        if (props.getProperty("SEASON_START_EMAIL_SENT") !== startKey) {
          sendSeasonStartEmail(Math.round(daysUntil), deadline);
          props.setProperty("SEASON_START_EMAIL_SENT", startKey);
          props.deleteProperty("SEASON_END_EMAIL_SENT"); // reset สำหรับซีซันใหม่
        }
      } else {
        Logger.log("Next season in " + Math.round(daysUntil) + " days");
      }
    } else {
      Logger.log("Season active — ไม่มีอะไรต้องทำ");
    }
  } catch(e) {
    Logger.log("❌ runSeasonManager error: " + e.message);
  }
}

// ── EMERGENCY: ลบ trigger ทั้งหมด (ใช้แก้ปัญหา trigger ค้าง/ซ้ำ) ──
function cleanupAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const counts = {};
  triggers.forEach(t => {
    const h = t.getHandlerFunction();
    counts[h] = (counts[h]||0)+1;
  });

  Logger.log("=== CLEANUP ALL TRIGGERS ===");
  Logger.log("พบ " + triggers.length + " triggers:");
  Object.entries(counts).forEach(([h,c]) =>
    Logger.log("  " + h + ": " + c + "x" + (c>1?" ⚠ DUPLICATE":"")));

  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("✓ ลบ trigger ทั้งหมด " + triggers.length + " ตัวเรียบร้อย");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("🧹 ลบ trigger ทั้งหมด " + triggers.length + " ตัวแล้ว — รัน '⚙ Setup Triggers' ต่อ", "APEX", 10);
}

function pauseAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const n = triggers.length;
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("✓ ลบ trigger ทั้งหมด " + n + " ตัว (รวม runSeasonManager)");
}

function resumeAllTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction()==="runSeasonManager")
    .forEach(t => ScriptApp.deleteTrigger(t));
  setupTriggers();
  Logger.log("✓ All triggers resumed");
}

function sendSeasonEndEmail() {
  try {
    const email   = Session.getActiveUser().getEmail();
    const ss      = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const entry   = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/");
    const history = fetchJSON("https://fantasy.premierleague.com/api/entry/"+CONFIG.FPL_TEAM_ID+"/history/");
    const finalRank = entry?.summary_overall_rank||0;
    const totalPts  = entry?.summary_overall_points||0;
    const bestGW    = (history?.current||[]).sort((a,b)=>b.points-a.points)[0];
    const subject   = "APEX PROTOCOL — Season " + CONFIG.CURRENT_SEASON + " FINAL REPORT";
    GmailApp.sendEmail(email, subject, `Season ended.\nFinal Rank: ${finalRank.toLocaleString()}\nTotal Pts: ${totalPts}\nBest GW: GW${bestGW?.event||"?"} (${bestGW?.points||0}pts)\n\nSystem paused. Will restart 1 week before GW1 ${_nextSeasonLabel()}.`);
    Logger.log("✓ Season end email sent");
  } catch(e) { Logger.log("⚠ Email: "+e.message); }
}

function sendSeasonStartEmail(daysLeft, deadline) {
  try {
    const email = Session.getActiveUser().getEmail();
    const nextS = _nextSeasonLabel();
    GmailApp.sendEmail(email, "APEX PROTOCOL — Season "+nextS+" Starting in "+daysLeft+" days!",
      "Season "+nextS+" starts in "+daysLeft+" days!\nDeadline: "+deadline.toLocaleString("th-TH")+"\n\nSystem restarted. Run runQuantPreseason() to build your team.");
    Logger.log("✓ Season start email sent");
  } catch(e) { Logger.log("⚠ Email: "+e.message); }
}


// ============================================================
// 20. DASHBOARD
// ============================================================

function buildDashboard() {
  Logger.log("=== BUILD DASHBOARD ===");
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = getOrCreateSheet(ss, "DASHBOARD");
  sheet.clearContents(); sheet.clearFormats();
  [1,2,3,4,5].forEach(i => sheet.setColumnWidth(i, 200));
  let row = 1;

  // Header
  sheet.getRange(row,1,1,5).merge()
       .setValue("APEX PROTOCOL v2.0 — FPL COMMAND CENTER")
       .setBackground("#050810").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(16)
       .setHorizontalAlignment("center");
  sheet.setRowHeight(row, 40); row++;
  sheet.getRange(row,1,1,5).merge()
       .setValue("Updated: "+new Date().toLocaleString("th-TH"))
       .setBackground("#0c1225").setFontColor("#7a8fba").setFontSize(10).setHorizontalAlignment("center");
  row += 2;

  // ── ตรวจ pre-season mode ─────────────────────────────────────────
  // FPL API ยังไม่เปิดซีซัน 26/27 หรือ GW1 ยังไม่เริ่ม → แสดงข้อมูล pre-season แทน
  const squadSheet  = ss.getSheetByName("SQUAD");
  const initSheet   = ss.getSheetByName("INITIAL_TEAM_2627");
  const tgtSheet    = ss.getSheetByName("SEASON_TARGET");
  const hasSquad    = squadSheet && squadSheet.getLastRow() > 2 &&
                      squadSheet.getRange(2,1).getValue() !== "";
  const hasTarget   = tgtSheet   && tgtSheet.getLastRow() > 2 &&
                      tgtSheet.getRange(2,2).getValue() !== "";

  // ── SQUAD SUMMARY ──────────────────────────────────────────────
  row = writeSectionHeader(sheet, row, "SQUAD SUMMARY", "#1c2a50", "#00f5ff");
  if (hasSquad) {
    // มีข้อมูล SQUAD จริง (ซีซันเริ่มแล้ว) → แสดงปกติ
    const data = squadSheet.getDataRange().getValues();
    const summary = {};
    for (let i = 1; i < Math.min(data.length, 14); i++) {
      if (data[i][0] && data[i][1]) summary[data[i][0]] = data[i][1];
    }
    [["Manager",    summary["Manager"]||"-",     "Overall Rank", summary["Overall Rank"]||"-"],
     ["Total Points",summary["Total Points"]||"-","Squad Value",  summary["Squad Value"]||"-"],
     ["In The Bank",summary["In The Bank"]||"-",  "Captain",      summary["Captain"]||"-"],
     ["Chips Used", summary["Chips Used"]||"-",   "Chips Left",   summary["Chips Left"]||"-"],
    ].forEach(r => {
      [0,1,2,3].forEach(ci =>
        sheet.getRange(row,ci+1).setValue(r[ci])
             .setFontColor(ci%2===0?"#7a8fba":"#ffffff").setFontWeight(ci%2===0?"bold":"normal")
             .setBackground("#0c1225")
      );
      row++;
    });
  } else if (initSheet && initSheet.getLastRow() > 2) {
    // Pre-season: แสดงทีมเริ่มต้น 26/27 ที่เตรียมไว้
    sheet.getRange(row,1,1,5).merge()
         .setValue("🏆 PRE-SEASON MODE — ทีมเริ่มต้น 26/27 (รัน runQuantPreseason() หรือ blindSimPredict2627())")
         .setBackground("#1a1500").setFontColor("#ffd60a").setFontWeight("bold").setWrap(true);
    sheet.setRowHeight(row, 28); row++;
    // แสดงข้อมูลจาก INITIAL_TEAM_2627
    const initData = initSheet.getDataRange().getValues();
    initData.slice(1, Math.min(initData.length, 20)).forEach(r => {
      if (!r[0]) return;
      sheet.getRange(row,1,1,Math.min(r.length,5))
           .setValues([r.slice(0,5)]).setBackground("#0c1225").setFontColor("#c5d4f0");
      row++;
    });
  } else {
    // ยังไม่มีข้อมูลอะไรเลย
    sheet.getRange(row,1,1,5).merge()
         .setValue("⏳ Pre-Season — รัน runScout() → runQuantPreseason() เพื่อเตรียมข้อมูล")
         .setBackground("#0c1225").setFontColor("#7a8fba").setFontStyle("italic");
    row++;
  }
  row++;

  // ── ALERTS ────────────────────────────────────────────────────
  const alertsSheet = ss.getSheetByName("ALERTS");
  row = writeSectionHeader(sheet, row, "LATEST ALERTS", "#1a0808", "#ff2d55");
  if (alertsSheet && alertsSheet.getLastRow() > 1) {
    const alerts = alertsSheet.getRange(2,1,Math.min(6,alertsSheet.getLastRow()-1),7).getValues();
    alerts.forEach(r => {
      const fc = String(r[2]).includes("INJURY")?"#ff2d55":String(r[2]).includes("RETURN")?"#00ff9d":
                 String(r[2]).includes("PRICE_RISE")?"#00f5ff":"#ffd60a";
      sheet.getRange(row,1,1,4).setValues([[r[1],r[3],r[4],"£"+r[5]]]).setBackground("#1a0808").setFontColor(fc);
      row++;
    });
  } else {
    sheet.getRange(row,1).setValue("ไม่มี alerts").setFontColor("#7a8fba").setFontStyle("italic"); row++;
  }
  row++;

  // ── SEASON TARGET ─────────────────────────────────────────────
  row = writeSectionHeader(sheet, row, "SEASON TARGET", "#0a1a0a", "#00f5ff");
  if (hasTarget) {
    // ซีซันเริ่มแล้ว → แสดง pace tracker ปกติ
    tgtSheet.getRange(2,1,6,4).getValues().forEach(r => {
      if (!r[0]) return;
      sheet.getRange(row,1,1,4).setValues([r]).setBackground("#0a1a0a").setFontColor("#c5d4f0");
      row++;
    });
  } else {
    // Pre-season → แสดง goal สรุปเฉยๆ
    [["เป้าหมาย","≥ " + CONFIG.TARGET_PTS + " pts", "Target Rank","Top 100"],
     ["GW1 เริ่ม","21 ส.ค. 2569 (เร็วๆนี้)", "Pace ที่ต้องการ", "~65.8 pts/GW"],
     ["สถานะ","⏳ Pre-Season — รอซีซัน 26/27 เริ่ม","",""],
    ].forEach(r => {
      [0,1,2,3].forEach(ci =>
        sheet.getRange(row,ci+1).setValue(r[ci])
             .setFontColor(ci%2===0?"#7a8fba":ci===1&&r[0]==="สถานะ"?"#ffd60a":"#ffffff")
             .setFontWeight(ci%2===0?"bold":"normal").setBackground("#0a1a0a")
      );
      row++;
    });
  }
  row++;

  // AI Analysis preview
  const analysisSheet = ss.getSheetByName("ANALYSIS");
  if (analysisSheet) {
    row = writeSectionHeader(sheet, row, "AI ANALYSIS (PREVIEW)", "#0a0a1a", "#b44eff");
    const txt = analysisSheet.getRange(3,1).getValue();
    if (txt) {
      sheet.getRange(row,1,1,5).merge()
           .setValue(String(txt).slice(0,500)+(String(txt).length>500?"\n...(ดูเพิ่มใน ANALYSIS tab)":""))
           .setBackground("#08080f").setFontColor("#c5d4f0")
           .setFontFamily("Courier New").setFontSize(10).setWrap(true).setVerticalAlignment("top");
      sheet.setRowHeight(row, 180); row++;
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1,1,row,5).setBorder(false,false,false,false,true,true,"#1c2a50",SpreadsheetApp.BorderStyle.SOLID);
  const sheets = ss.getSheets();
  const dashIdx = sheets.findIndex(s => s.getName()==="DASHBOARD");
  if (dashIdx > 0) ss.moveActiveSheet(1);
  Logger.log("✅ Dashboard built: "+row+" rows");
}

function refreshDashboard() {
  buildDashboard();
  Logger.log("✓ Dashboard refreshed");
}


// ============================================================
// 21. EMAIL SYSTEM
// ============================================================

function emailCSS() {
  return `body{font-family:Arial,sans-serif;background:#0a0d18;color:#c5d4f0;margin:0;padding:16px}
.wrap{max-width:620px;margin:0 auto}
.hdr{background:#050810;border:1px solid #1c2a50;border-radius:8px;padding:20px;text-align:center;margin-bottom:14px}
.logo{font-size:20px;font-weight:bold;color:#00f5ff;letter-spacing:4px}
.sub{color:#7a8fba;font-size:11px;margin-top:3px}
.card{background:#0c1225;border-radius:6px;padding:14px;margin-bottom:12px;border-left:4px solid #1c2a50}
.card.cyan{border-color:#00f5ff}.card.green{border-color:#00ff9d}.card.amber{border-color:#ffd60a}
.card.red{border-color:#ff2d55}.card.purple{border-color:#b44eff}
.card-title{font-size:13px;font-weight:bold;margin-bottom:10px;letter-spacing:1px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#0f1830;color:#7a8fba;padding:6px 8px;text-align:left;font-weight:normal;font-size:11px}
td{padding:6px 8px;border-bottom:1px solid #1c2a50;color:#c5d4f0}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:bold}
.b-green{background:#003300;color:#00ff9d}.b-red{background:#1a0000;color:#ff2d55}
.b-amber{background:#1a1500;color:#ffd60a}.b-cyan{background:#001a1a;color:#00f5ff}
.stat{display:inline-block;text-align:center;padding:10px 14px;background:#080d1a;border-radius:6px;margin:4px}
.stat-val{font-size:20px;font-weight:bold;color:#fff}
.stat-lbl{font-size:10px;color:#7a8fba;margin-top:2px}
.btn{display:inline-block;background:#00f5ff;color:#000;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;letter-spacing:2px;margin-top:12px}
.footer{text-align:center;color:#3d4f72;font-size:10px;margin-top:16px}
.ts{color:#7a8fba;font-size:10px;text-align:right;margin-bottom:8px}
.green{color:#00ff9d}.red{color:#ff2d55}.cyan{color:#00f5ff}.amber{color:#ffd60a}`;
}

function sendCompletionEmail(status, errorMsg) {
  try {
    const email = Session.getActiveUser().getEmail();
    const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const ssUrl = ss.getUrl();
    const now   = new Date().toLocaleString("th-TH");
    let subject, htmlBody;
    if (status==="SUCCESS") {
      subject  = "✅ APEX PROTOCOL — Weekly Analysis Ready";
      htmlBody = buildWeeklyEmail(ss, ssUrl, now);
    } else if (status==="DEADLINE_CHECK") {
      subject  = "⏰ APEX PROTOCOL — Pre-Deadline Analysis";
      htmlBody = buildDeadlineEmail(ss, ssUrl, now);
    } else {
      subject  = "❌ APEX PROTOCOL — Pipeline Failed";
      htmlBody = buildErrorEmail(errorMsg, ssUrl, now);
    }
    GmailApp.sendEmail(email, subject, "", { htmlBody });
    Logger.log("✓ Email: "+subject);
  } catch(e) { Logger.log("⚠ Email failed: "+e.message); }
}

function buildWeeklyEmail(ss, ssUrl, now) {
  const squad  = readSheetData(ss, "SQUAD");
  const xpts   = readSheetData(ss, "XPTS");
  const news   = readSheetData(ss, "NEWS");
  const price  = readSheetData(ss, "PRICE_TRACKER");
  const target = readSheetData(ss, "SEASON_TARGET");
  const analysis = ss.getSheetByName("ANALYSIS");

  const sqSum = {};
  squad.slice(0,13).forEach(r => { const k=Object.keys(r); if (r[k[0]]&&r[k[1]]) sqSum[r[k[0]]]=r[k[1]]; });
  const captains = xpts.filter(r=>r["xPTS"]&&parseFloat(r["xPTS"])>0)
    .sort((a,b)=>parseFloat(b["xPTS"])-parseFloat(a["xPTS"])).slice(0,5);
  const injured  = news.filter(r=>["INJURED","SUSPENDED","DOUBTFUL"].includes(String(r["STATUS"]||""))).slice(0,5);
  const buyNow   = price.filter(r=>r["URGENCY"]==="BUY_NOW").slice(0,4);
  const sellNow  = price.filter(r=>r["URGENCY"]==="SELL_NOW").slice(0,4);
  const tgtRows  = target.slice(0,6);
  const aiPreview = analysis ? String(analysis.getRange(3,1).getValue()).slice(0,500).replace(/\n/g,"<br>") : "";

  const capRows = captains.map((p,i) =>
    `<tr><td><b>${i===0?"👑 ":""}${p["NAME"]||""}</b></td><td>${p["TEAM"]||""}</td>
    <td><span class="badge ${parseFloat(p["FDR"])<=2?"b-green":parseFloat(p["FDR"])<=3?"b-amber":"b-red"}">${p["FDR"]||"-"}</span></td>
    <td>${p["CS_PROB"]||"-"}</td><td class="cyan">${p["xPTS"]||"-"}</td><td class="amber"><b>${p["CAPTAIN_xPTS"]||"-"}</b></td></tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${emailCSS()}</style></head>
<body><div class="wrap">
<div class="hdr"><div class="logo">APEX PROTOCOL</div><div class="sub">WEEKLY ANALYSIS REPORT</div></div>
<div class="ts">${now}</div>
<div class="card cyan"><div class="card-title">SQUAD STATUS</div>
<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">
<div class="stat"><div class="stat-val cyan">${sqSum["Overall Rank"]||"-"}</div><div class="stat-lbl">OVERALL RANK</div></div>
<div class="stat"><div class="stat-val">${sqSum["Total Points"]||"-"}</div><div class="stat-lbl">TOTAL PTS</div></div>
<div class="stat"><div class="stat-val green">${sqSum["Squad Value"]||"-"}</div><div class="stat-lbl">VALUE</div></div>
<div class="stat"><div class="stat-val amber">${sqSum["In The Bank"]||"-"}</div><div class="stat-lbl">ITB</div></div>
</div><div style="margin-top:8px;font-size:12px">Chips Left: <b class="amber">${sqSum["Chips Left"]||"None"}</b></div></div>
${captains.length?`<div class="card amber"><div class="card-title">CAPTAIN CANDIDATES (xPts)</div><table>
<tr><th>NAME</th><th>TEAM</th><th>FDR</th><th>CS%</th><th>xPTS</th><th>CAP xPTS</th></tr>${capRows}</table></div>`:""}
${injured.length?`<div class="card red"><div class="card-title">INJURY / SUSPENSION (ทีมฉัน)</div><table>
<tr><th>NAME</th><th>TEAM</th><th>STATUS</th><th>CHANCE</th><th>NEWS</th></tr>
${injured.map(p=>`<tr><td><b>${p["NAME"]||""}</b></td><td>${p["TEAM"]||""}</td><td><span class="badge b-red">${p["STATUS"]||""}</span></td><td>${p["CHANCE"]||"-"}</td><td style="font-size:10px;color:#7a8fba">${String(p["NEWS"]||"").slice(0,60)}</td></tr>`).join("")}</table></div>`:""}
${(buyNow.length||sellNow.length)?`<div class="card green"><div class="card-title">PRICE ALERTS</div>
${buyNow.length?`<div style="color:#00ff9d;font-size:11px;margin-bottom:4px">BUY NOW</div><table><tr><th>NAME</th><th>TEAM</th><th>NET RATE</th></tr>${buyNow.map(p=>`<tr><td><b>${p["NAME"]}</b></td><td>${p["TEAM"]}</td><td class="green">${p["NET_RATE%"]}</td></tr>`).join("")}</table>`:""}
${sellNow.length?`<div style="color:#ff2d55;font-size:11px;margin:8px 0 4px">SELL NOW</div><table><tr><th>NAME</th><th>TEAM</th><th>NET RATE</th></tr>${sellNow.map(p=>`<tr><td><b>${p["NAME"]}</b></td><td>${p["TEAM"]}</td><td class="red">${p["NET_RATE%"]}</td></tr>`).join("")}</table>`:""}
</div>`:""}
${tgtRows.length?`<div class="card purple"><div class="card-title">SEASON TARGET</div><table>
${tgtRows.map(r=>`<tr><td style="color:#7a8fba;font-size:11px">${Object.values(r)[0]||""}</td><td><b>${Object.values(r)[1]||""}</b></td></tr>`).join("")}</table></div>`:""}
${aiPreview?`<div class="card purple"><div class="card-title">AI ANALYSIS PREVIEW</div><div style="font-size:11px;line-height:1.7">${aiPreview}...</div></div>`:""}
<div style="text-align:center"><a href="${ssUrl}" class="btn">VIEW DASHBOARD</a></div>
<div class="footer">APEX PROTOCOL v2.0 — ${now}</div>
</div></body></html>`;
}

function buildDeadlineEmail(ss, ssUrl, now) {
  const xpts   = readSheetData(ss, "XPTS");
  const news   = readSheetData(ss, "NEWS");
  const league = readSheetData(ss, "MINI_LEAGUE");
  const captains = xpts.filter(r=>r["xPTS"]&&parseFloat(r["xPTS"])>0)
    .sort((a,b)=>parseFloat(b["xPTS"])-parseFloat(a["xPTS"])).slice(0,3);
  const injured  = news.filter(r=>["INJURED","SUSPENDED"].includes(String(r["STATUS"]||""))).slice(0,5);
  const diffs    = league.filter(r=>r["DIFF SCORE"]&&parseFloat(r["DIFF SCORE"])>0).slice(0,5);
  return `<!DOCTYPE html><html><head><style>${emailCSS()}</style></head>
<body><div class="wrap">
<div class="hdr"><div class="logo">APEX PROTOCOL</div><div class="sub">PRE-DEADLINE ANALYSIS</div></div>
<div class="ts">${now}</div>
${captains.length?`<div class="card amber"><div class="card-title">CAPTAIN RECOMMENDATION</div><table>
<tr><th>NAME</th><th>TEAM</th><th>FDR</th><th>xPTS</th><th>CAP xPTS</th></tr>
${captains.map((p,i)=>`<tr><td><b>${i===0?"👑 ":""}${p["NAME"]||""}</b></td><td>${p["TEAM"]||""}</td><td>${p["FDR"]||"-"}</td><td class="cyan">${p["xPTS"]||"-"}</td><td class="amber"><b>${p["CAPTAIN_xPTS"]||"-"}</b></td></tr>`).join("")}</table></div>`:""}
${injured.length?`<div class="card red"><div class="card-title">LAST MINUTE INJURY</div><table>
<tr><th>NAME</th><th>TEAM</th><th>STATUS</th></tr>
${injured.map(p=>`<tr><td><b class="red">${p["NAME"]}</b></td><td>${p["TEAM"]}</td><td><span class="badge b-red">${p["STATUS"]}</span></td></tr>`).join("")}</table></div>`:""}
${diffs.length?`<div class="card green"><div class="card-title">DIFFERENTIALS</div><table>
<tr><th>NAME</th><th>TEAM</th><th>LEAGUE OWN%</th><th>DIFF SCORE</th></tr>
${diffs.map(p=>`<tr><td><b>${p["NAME"]}</b></td><td>${p["TEAM"]}</td><td class="green">${p["LEAGUE OWN%"]}</td><td class="amber">${p["DIFF SCORE"]}</td></tr>`).join("")}</table></div>`:""}
<div style="text-align:center"><a href="${ssUrl}" class="btn">VIEW DASHBOARD</a></div>
<div class="footer">APEX PROTOCOL v2.0 — ${now}</div>
</div></body></html>`;
}

function buildErrorEmail(errorMsg, ssUrl, now) {
  return `<!DOCTYPE html><html><head><style>${emailCSS()}</style></head>
<body><div class="wrap">
<div class="hdr"><div class="logo" style="color:#ff2d55">APEX PROTOCOL</div><div class="sub">PIPELINE FAILED</div></div>
<div class="card red"><div class="card-title">Error Details</div>
<p style="font-family:monospace;font-size:12px;color:#ff6b6b">${errorMsg||"Unknown error"}</p>
<p style="font-size:11px;color:#7a8fba">ตรวจสอบที่ Apps Script -> Executions</p></div>
<div style="text-align:center"><a href="${ssUrl}" class="btn" style="background:#ff2d55;color:#fff">CHECK LOGS</a></div>
<div class="footer">APEX PROTOCOL v2.0 — ${now}</div>
</div></body></html>`;
}

function sendPostMortemEmail(ss, gw, data) {
  try {
    const email = Session.getActiveUser().getEmail();
    const ssUrl = ss.getUrl();
    const now   = new Date().toLocaleString("th-TH");
    const subject = "APEX — GW"+gw+" Post-Mortem | "+(data.rankChange>0?"▲+":"▼")+Math.abs(data.rankChange||0).toLocaleString()+" Rank";
    const xferRows = (data.transferDetails||[]).map(t =>
      `<tr><td><b>${t.sold}</b></td><td>${t.sold_pts}pts</td><td>-></td><td><b>${t.bought}</b></td><td>${t.bought_pts}pts</td>
      <td style="color:${t.gain>0?"#00ff9d":"#ff2d55"}">${t.gain>0?"+":""}${t.gain}pts</td><td>${t.verdict}</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><style>${emailCSS()}</style></head>
<body><div class="wrap">
<div class="hdr"><div class="logo">APEX PROTOCOL</div><div class="sub">GW${gw} POST-MORTEM</div></div>
<div class="ts">${now}</div>
<div class="card cyan"><div class="card-title">GW${gw} SUMMARY</div>
<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">
<div class="stat"><div class="stat-val">${data.myGWPts}</div><div class="stat-lbl">GW PTS</div></div>
<div class="stat"><div class="stat-val">${data.myNetPts}</div><div class="stat-lbl">NET PTS</div></div>
<div class="stat"><div class="stat-val ${data.rankChange>0?"green":"red"}">${data.rankChange>0?"▲+":"▼"}${Math.abs(data.rankChange||0).toLocaleString()}</div><div class="stat-lbl">RANK</div></div>
<div class="stat"><div class="stat-val">${(data.myRankAfter||0).toLocaleString()}</div><div class="stat-lbl">CURRENT</div></div>
</div>${data.hitTaken>0?`<div style="margin-top:8px;font-size:12px;color:#ff2d55">Hit: -${data.hitTaken}pts</div>`:""}
${data.chipPlayed?`<div style="font-size:12px;color:#ffd60a">Chip: ${data.chipPlayed}</div>`:""}</div>
<div class="card ${data.capDecisionGain>=0?"green":"red"}"><div class="card-title">CAPTAIN REVIEW</div><table>
<tr><th></th><th>PLAYER</th><th>NET PTS</th><th>VERDICT</th></tr>
<tr><td>My Captain</td><td><b>${data.capName||"?"}</b></td><td class="${data.capDecisionGain>=0?"green":"red"}">${data.capNetPts||0}pts</td><td>${data.capDecisionGain>=0?"✅ Correct":"❌ Wrong"}</td></tr>
<tr><td>Best Pick</td><td><b>${data.bestCapName||"?"}</b></td><td>${(data.bestCapPts||0)*2}pts</td><td>${data.capDecisionGain<0?"Should have picked":"-"}</td></tr>
</table></div>
${(data.transferDetails||[]).length>0?`<div class="card green"><div class="card-title">TRANSFER REVIEW</div><table><tr><th>OUT</th><th>PTS</th><th></th><th>IN</th><th>PTS</th><th>GAIN</th><th>VERDICT</th></tr>${xferRows}</table></div>`:""}
${(data.missedOpp||[]).length>0?`<div class="card" style="border-color:#ff6a00"><div class="card-title">MISSED OPPORTUNITIES</div><table><tr><th>PLAYER</th><th>TEAM</th><th>GW PTS</th></tr>${data.missedOpp.map(p=>`<tr><td><b>${p.name}</b></td><td>${p.team}</td><td style="color:#ff9a00"><b>${p.gw_pts}pts</b></td></tr>`).join("")}</table></div>`:""}
${data.aiPostmortem?`<div class="card purple"><div class="card-title">AI ANALYSIS</div><div style="font-size:11px;line-height:1.8;white-space:pre-wrap">${data.aiPostmortem}</div></div>`:""}
<div style="text-align:center"><a href="${ssUrl}" class="btn">VIEW POST-MORTEM</a></div>
<div class="footer">APEX PROTOCOL v2.0 — GW${gw} | ${now}</div>
</div></body></html>`;
    GmailApp.sendEmail(email, subject, "", { htmlBody:html });
    Logger.log("✓ Post-mortem email: GW"+gw);
  } catch(e) { Logger.log("⚠ "+e.message); }
}


// ============================================================
// 22. CUSTOM MENU + RUN ALL + TRIGGERS
// ============================================================

// ── Manual GW1 Squad Input ─────────────────────────────────────────────────────
// ใช้เมื่อ FPL API ยังไม่คืน picks ก่อน deadline (เช่น ก่อน GW1 เริ่ม)
// 1. กดเมนู "📝 Set GW1 Squad Manually" เพื่อสร้าง/เปิด SQUAD_INPUT sheet
// 2. กรอกชื่อผู้เล่น 15 คน (NAME | TEAM | POS | PRICE | XPTS) แล้ว Save
// 3. รัน runAITeamManager() — จะดึงจาก SQUAD_INPUT โดยอัตโนมัติ
function setupManualGW1Squad() {
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = getOrCreateSheet(ss, "SQUAD_INPUT");
  if (sheet.getLastRow() > 0 && sheet.getRange(1,1).getValue() === "NAME") {
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
    ss.toast("กรอกผู้เล่น 15 คนแล้วกด runAITeamManager()", "SQUAD_INPUT", 10);
    return;
  }
  sheet.clearContents(); sheet.clearFormats();
  sheet.getRange(1,1,1,5).setValues([["NAME","TEAM","POS","PRICE","XPTS"]])
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  const tmpl = [
    ["Raya","ARS","GK",6.0,6.5],["Flekken","FUL","GK",4.5,4.2],
    ["Alexander-Arnold","LIV","DEF",7.0,6.8],["Gabriel","ARS","DEF",6.0,5.9],
    ["Saliba","ARS","DEF",6.0,5.8],["Pedro Porro","TOT","DEF",5.5,5.2],
    ["Mykolenko","EVE","DEF",4.5,4.0],
    ["Saka","ARS","MID",10.0,9.5],["B.Fernandes","MUN","MID",8.5,8.2],
    ["Mbeumo","BRE","MID",7.5,7.0],["Andreas","FUL","MID",5.0,5.1],
    ["Palmer","CHE","MID",10.5,9.8],
    ["Haaland","MCI","FWD",15.0,12.0],["Watkins","AVL","FWD",9.0,8.0],
    ["Wood","NFO","FWD",6.5,6.2],
  ];
  sheet.getRange(2,1,tmpl.length,5).setValues(tmpl).setBackground("#0c1225").setFontColor("#c5d4f0");
  sheet.autoResizeColumns(1,5);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  ss.toast("📝 ลบตัวอย่างและกรอกทีมจริง 15 คน (GK×2 DEF×5 MID×5 FWD×3) แล้วรัน runAITeamManager()", "GW1 Setup", 20);
}

// ── Sync AI_TEAM_STATE → GEMINI_PICKS (สำหรับ GitHub export / server integration) ──
function writeGeminiPicksFromState() {
  const ss        = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const stateSheet= ss.getSheetByName("AI_TEAM_STATE");
  const aiState   = stateSheet ? loadAIState(stateSheet) : {};
  if (!aiState.squad || !aiState.squad.length) {
    Logger.log("⚠ AI_TEAM_STATE ว่าง — รัน runAITeamManager() ก่อน");
    ss.toast("⚠ ยังไม่มีข้อมูลทีม — รัน runAITeamManager() ก่อน", "APEX", 8);
    return;
  }
  const squad   = aiState.squad;
  const xi      = squad.filter(p=>p.is_starting).sort((a,b)=>(b.xpts||0)-(a.xpts||0));
  const bench   = squad.filter(p=>!p.is_starting);
  const captain = squad.find(p=>p.is_captain);
  const vice    = squad.find(p=>p.is_vice);
  const picksObj = {
    engine:"apex_protocol", gw:aiState.last_gw||1,
    captain:captain?.name||"?", captain_xpts:captain?.xpts||0,
    vice_captain:vice?.name||"?",
    starting_xi:xi.map(p=>p.name),
    bench:bench.map(p=>p.name),
    transfer_out:null, transfer_in:null,
    transfer_reason:"AI-generated (APEX PROTOCOL v2.0)",
    chip:null,
    projected_xpts:+(xi.reduce((s,p)=>s+(p.xpts||0),0)+(captain?.xpts||0)).toFixed(1),
    confidence:"high",
    key_risk:"ดูรายละเอียดใน AI_TEAM sheet",
    tactical_mode:aiState.tactical_mode||"STANDARD",
    squad_full:squad.map(p=>({name:p.name,team:p.team,pos:p.pos,price:p.price,
                               xpts:p.xpts,is_starting:p.is_starting,
                               is_captain:p.is_captain,is_vice:p.is_vice})),
  };
  const sheet = getOrCreateSheet(ss, "GEMINI_PICKS");
  sheet.clearContents(); sheet.clearFormats();
  sheet.getRange(1,1,1,2).setValues([["KEY","VALUE"]])
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  const rows = Object.entries(picksObj).map(([k,v])=>[k,typeof v==="object"?JSON.stringify(v):v]);
  sheet.getRange(2,1,rows.length,2).setValues(rows).setBackground("#0c1225").setFontColor("#c5d4f0");
  // JSON string สำหรับ server อ่าน
  const jSheet = getOrCreateSheet(ss, "GEMINI_PICKS_JSON");
  jSheet.clearContents(); jSheet.getRange(1,1).setValue(JSON.stringify(picksObj));
  Logger.log("✓ GEMINI_PICKS sync | Cap:"+picksObj.captain+" projXpts:"+picksObj.projected_xpts);
  ss.toast("✓ GEMINI_PICKS อัพเดทแล้ว — พร้อม export ขึ้น GitHub", "APEX", 8);
}

// เมนู APEX จะปรากฏใน Google Sheets ทุกครั้งที่เปิด Spreadsheet
// ไม่ต้อง run เอง — ติดตั้งอัตโนมัติผ่าน onOpen trigger
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚽ APEX PROTOCOL")
    .addItem("▶ RUN ALL (Full Pipeline)", "runAll")
    .addSeparator()
    .addItem("Scout + xPts + AI Team", "runCoreData")
    .addItem("News + Squad + Price", "runQuickUpdate")
    .addSeparator()
    .addItem("Captain Pick (AI)", "runQuantCaptain")
    .addItem("Transfer Advice (AI)", "runQuantTransfer")
    .addItem("Weekly Brief (AI)", "runQuantBrief")
    .addSeparator()
    .addItem("Post-Mortem (หลัง GW จบ)", "runPostMortem")
    .addItem("Next-Week Blind Test (3 ทีม)", "runNextWeekBlindTest")
    .addItem("Refresh Dashboard", "refreshDashboard")
    .addSeparator()
    .addItem("⚙ Setup Triggers", "setupTriggers")
    .addItem("🧹 Emergency: Clean All Triggers", "cleanupAllTriggers")
    .addSeparator()
    .addItem("📝 Set GW1 Squad Manually", "setupManualGW1Squad")
    .addItem("🔄 Sync AI_TEAM_STATE → GEMINI_PICKS", "writeGeminiPicksFromState")
    .addToUi();
}

// ── RUN ALL — รันทุกอย่างครบ 14 steps ────────
// เรียกได้จากเมนู APEX หรือกด run ใน Apps Script
function runAll() {
  Logger.log("=== RUN ALL START ===");
  const ui   = SpreadsheetApp.getUi();
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const start = new Date();

  // แสดง toast แจ้งเริ่ม
  ss.toast("กำลังรัน Full Pipeline... (~45-60 นาที)", "APEX PROTOCOL", 30);

  const steps = [
    ["SeasonManager",   runSeasonManager],
    ["Scout",           runScout],
    ["FixtureSwing",    runFixtureSwing],
    ["PricePrediction", runPricePrediction],
    ["RotationRisk",    runRotationRisk],
    ["NewsScout",       runNewsScout],
    ["SquadTracker",    runSquadTracker],
    ["SeasonTarget",    runSeasonTarget],
    ["MiniLeague",      runMiniLeague],
    ["XPtsCalculator",  runXPtsCalculator],
    ["HitCalculator",   runHitCalculator],
    ["AITeamManager",   runAITeamManager],
    ["QuantBrief",      runQuantBrief],
    ["Dashboard",       refreshDashboard],
  ];

  const failed  = [];
  const passed  = [];

  steps.forEach(([name, fn], idx) => {
    ss.toast("Step " + (idx+1) + "/" + steps.length + ": " + name + "...", "APEX", 60);
    try {
      Logger.log("▶ [" + (idx+1) + "/" + steps.length + "] " + name);
      fn();
      Logger.log("✓ " + name);
      passed.push(name);
    } catch(e) {
      Logger.log("✗ " + name + ": " + e.message);
      failed.push(name + ": " + e.message);
    }
  });

  const elapsed = Math.round((new Date() - start) / 60000);
  const status  = failed.length > 0 ? "PARTIAL" : "SUCCESS";
  const summary = passed.length + "/" + steps.length + " steps OK (" + elapsed + " min)";

  if (failed.length > 0) {
    ss.toast("⚠ เสร็จ " + passed.length + " steps | Failed: " + failed.length, "APEX", 10);
    sendCompletionEmail("FAILED", "Run All — " + summary + "\n\nFailed:\n" + failed.join("\n"));
  } else {
    ss.toast("✅ Run All เสร็จสมบูรณ์! " + summary, "APEX PROTOCOL", 10);
    sendCompletionEmail("SUCCESS");
  }
  Logger.log("=== RUN ALL DONE | " + summary + " ===");
}

// ── CORE DATA — Scout + xPts + AI Team (~25 นาที) ─
function runCoreData() {
  Logger.log("=== CORE DATA START ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ss.toast("Running: Scout → xPts → AI Team...", "APEX", 30);
  const steps = [
    ["Scout",          runScout],
    ["FixtureSwing",   runFixtureSwing],
    ["RotationRisk",   runRotationRisk],
    ["XPtsCalculator", runXPtsCalculator],
    ["HitCalculator",  runHitCalculator],
    ["AITeamManager",  runAITeamManager],
    ["Dashboard",      refreshDashboard],
  ];
  const failed = [];
  steps.forEach(([name, fn]) => {
    try { fn(); Logger.log("✓ " + name); }
    catch(e) { Logger.log("✗ " + name + ": " + e.message); failed.push(name); }
  });
  ss.toast(failed.length ? "⚠ Failed: "+failed.join(",") : "✅ Core Data เสร็จแล้ว", "APEX", 8);
  Logger.log("=== CORE DATA DONE ===");
}

// ── QUICK UPDATE — News + Squad + Price (~3 นาที) ─
function runQuickUpdate() {
  Logger.log("=== QUICK UPDATE START ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ss.toast("Running: News → Squad → Price...", "APEX", 15);
  const steps = [
    ["NewsScout",       runNewsScout],
    ["SquadTracker",    runSquadTracker],
    ["PricePrediction", runPricePrediction],
    ["RealtimeAlert",   runRealtimeAlert],
    ["Dashboard",       refreshDashboard],
  ];
  const failed = [];
  steps.forEach(([name, fn]) => {
    try { fn(); Logger.log("✓ " + name); }
    catch(e) { Logger.log("✗ " + name + ": " + e.message); failed.push(name); }
  });
  ss.toast(failed.length ? "⚠ Failed: "+failed.join(",") : "✅ Quick Update เสร็จแล้ว", "APEX", 8);
  Logger.log("=== QUICK UPDATE DONE ===");
}

function setupTriggers() {
  // ลบ triggers เก่าทั้งหมด
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("✓ Cleared old triggers");

  // 1. Weekly Pipeline — ทุกพฤหัส 20:00
  ScriptApp.newTrigger("runWeeklyPipeline")
    .timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(20).create();
  Logger.log("✓ Weekly Pipeline: ทุกพฤหัส 20:00");

  // 2. Pre-Deadline Check — ทุกศุกร์ 10:00
  ScriptApp.newTrigger("runPreDeadlineCheck")
    .timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(10).create();
  Logger.log("✓ Pre-Deadline: ทุกศุกร์ 10:00");

  // 3. Post-Mortem — ทุกอาทิตย์ 22:00
  ScriptApp.newTrigger("runPostMortem")
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).create();
  Logger.log("✓ Post-Mortem: ทุกอาทิตย์ 22:00");

  // 4. Mini-League — ทุกพุธ 20:00 (mid-week update)
  ScriptApp.newTrigger("runMiniLeague")
    .timeBased().onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(20).create();
  Logger.log("✓ Mini-League: ทุกพุธ 20:00");

  // 5. News Scout — ทุกวัน 08:00
  ScriptApp.newTrigger("runNewsScout")
    .timeBased().everyDays(1).atHour(8).create();
  Logger.log("✓ News Scout: ทุกวัน 08:00");

  const triggers = ScriptApp.getProjectTriggers();
  Logger.log("✅ Triggers set: " + triggers.length);
  triggers.forEach(t => Logger.log("  - " + t.getHandlerFunction()));
}

function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log("=== TRIGGERS (" + triggers.length + ") ===");
  const counts = {};
  triggers.forEach(t => {
    const h = t.getHandlerFunction();
    counts[h] = (counts[h]||0)+1;
    Logger.log(h + " | " + t.getTriggerSource() + " | " + t.getEventType());
  });
  Logger.log("--- Summary ---");
  Object.entries(counts).forEach(([h,c]) =>
    Logger.log("  " + h + ": " + c + "x" + (c>1?" ⚠ DUPLICATE":"")));
}


// ============================================================
// 23. HELPERS
// ============================================================

// คืน label ซีซันถัดจาก CONFIG.CURRENT_SEASON เช่น "2026/27" -> "2027/28"
function _nextSeasonLabel() {
  const y = parseInt(String(CONFIG.CURRENT_SEASON).slice(0,4)) || new Date().getFullYear();
  return (y+1) + "/" + String((y+2)%100).padStart(2,"0");
}

// คืน label ซีซันปัจจุบันจาก deadline ของ GW1 (events = ซีซันปัจจุบันเสมอ) เช่น "2026/27"
function currentSeasonLabel(boot) {
  const evs = (boot && boot.events) || [];
  const gw1 = evs.find(e => e.id === 1) || evs[0];
  const y = gw1 ? new Date(gw1.deadline_time).getUTCFullYear() : new Date().getFullYear();
  return y + "/" + String((y+1)%100).padStart(2,"0");
}

function fetchJSON(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      headers: { "User-Agent":"Mozilla/5.0" }, muteHttpExceptions:true,
    });
    if (res.getResponseCode() !== 200) {
      Logger.log("HTTP " + res.getResponseCode() + " — " + url);
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch(e) { Logger.log("fetchJSON error: "+e.message); return null; }
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeSectionHeader(sheet, row, title, bg, fc) {
  sheet.getRange(row,1,1,5).merge()
       .setValue(title).setBackground(bg).setFontColor(fc)
       .setFontWeight("bold").setFontSize(11).setHorizontalAlignment("left");
  sheet.setRowHeight(row, 28);
  return row + 1;
}

function logRun(ss, step, detail, status) {
  const sheet = getOrCreateSheet(ss, "RUN_LOG");
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,4).setValues([["TIMESTAMP","STEP","DETAIL","STATUS"]]);
  }
  sheet.appendRow([new Date(), step, detail, status]);
}

function readSheetData(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h,i) => { obj[h] = row[i]; });
    return obj;
  });
}

function statusLabel(s) {
  return s==="a"?"AVAILABLE":s==="d"?"DOUBTFUL":s==="i"?"INJURED":s==="s"?"SUSPENDED":s==="u"?"UNAVAILABLE":s||"?";
}

function callGemini(prompt) {
  try {
    const url  = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key="+CONFIG.GEMINI_KEY;
    const res  = UrlFetchApp.fetch(url, {
      method:"post", contentType:"application/json",
      payload:JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{maxOutputTokens:11000, temperature:0.3},
      }),
      muteHttpExceptions:true,
    });
    if (res.getResponseCode() !== 200) {
      Logger.log("Gemini HTTP "+res.getResponseCode()+": "+res.getContentText().slice(0,300));
      return null;
    }
    const data = JSON.parse(res.getContentText());
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch(e) { Logger.log("Gemini error: "+e.message); return null; }
}

// callGeminiJSON: บังคับ Gemini ตอบ JSON เท่านั้น (response_mime_type)
// ป้องกัน reasoning preamble ของ 3.6-flash ทำให้ JSON.parse ล้มเหลว
// ใช้แทน callGemini() เสมอเมื่อต้องการ structured JSON response
function callGeminiJSON(prompt) {
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key="+CONFIG.GEMINI_KEY;
    const res = UrlFetchApp.fetch(url, {
      method:"post", contentType:"application/json",
      payload:JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{
          maxOutputTokens:11000, temperature:0.3,
          response_mime_type:"application/json",   // บังคับ JSON ล้วน ไม่มี preamble
        },
      }),
      muteHttpExceptions:true,
    });
    if (res.getResponseCode() !== 200) {
      Logger.log("Gemini JSON HTTP "+res.getResponseCode()+": "+res.getContentText().slice(0,300));
      return null;
    }
    const data = JSON.parse(res.getContentText());
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) return null;

    // พยายาม parse ตรง → fallback สกัด JSON block → fallback repair
    try { return JSON.parse(text); } catch {}

    // สกัด JSON จาก markdown code block (```json...```)
    const fence = "```";
    const fi = text.indexOf(fence);
    if (fi >= 0) {
      const fi2 = text.indexOf(fence, fi+3);
      if (fi2 >= 0) {
        const inner = text.slice(fi+3, fi2).replace(/^json\n?/,"").trim();
        try { return JSON.parse(inner); } catch {}
      }
    }

    // สกัด JSON object/array แรกที่เจอในข้อความ
    const start = text.search(/[\[{]/);
    if (start >= 0) {
      const snippet = text.slice(start);
      // หา closing bracket ที่ match กับ opening
      let depth = 0, i = 0;
      for (; i < snippet.length; i++) {
        if (snippet[i]==="{" || snippet[i]==="[") depth++;
        if (snippet[i]==="}" || snippet[i]==="]") { depth--; if (depth===0) break; }
      }
      try { return JSON.parse(snippet.slice(0, i+1)); } catch {}
    }

    Logger.log("callGeminiJSON: parse ล้มเหลวทุก fallback | raw="+text.slice(0,200));
    return null;
  } catch(e) { Logger.log("callGeminiJSON error: "+e.message); return null; }
}

function testSetup() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  Logger.log("✓ "+ss.getName());
  Logger.log("✓ Setup OK");
}

// ============================================================
// APEX BLIND SIMULATOR v2.0
// จำลองการตัดสินใจ FPL แบบ blind-test ทีละ GW
//
// กฎเหล็ก (enforce โดยโค้ด):
//   - รู้ฟอร์ม/ราคา: เฉพาะ GW ที่ผ่านมา (< targetGW) เท่านั้น
//   - รู้ fixture: schedule ที่ประกาศแล้วตั้งแต่ต้นซีซัน
//   - ไม่รู้: lineup, บาดเจ็บ, ผลแมตช์ของ GW นั้น
//
// Squad rules (FPL standard):
//   - 15 คนเสมอ: GK×2, DEF×5, MID×5, FWD×3
//   - Starting XI = 11: GK×1 + outfield×10 (min DEF3, MID2, FWD1)
//   - max 3 คนต่อ PL team
//   - Transfer: ต้องเป็น position เดียวกันเท่านั้น
//
// Chips (ใช้ได้ 2 ครั้ง/ซีซัน, แต่ละ GW ใช้ได้ 1 ชิพ):
//   GW1-19 pool:  Wildcard 1, Triple Captain, Bench Boost, Free Hit
//   GW20-38 pool: Wildcard 2, (ที่เหลือจาก pool แรก)
//
// วิธีใช้:
//   1. blindSimPrep()        → ดึงข้อมูลทั้งซีซัน (ครั้งเดียว ~15 นาที)
//   2. blindSimGW(N)         → จำลอง GW ที่ N ทีละ GW
//      OR blindSimFull()     → รัน GW1-38 ทีเดียว (~30 นาที)
//   3. blindSimSummary()     → สรุป + AI วิเคราะห์
//   4. blindSimReset()       → เริ่มใหม่ (เก็บ PREP data ไว้)
// ============================================================

// ── PROMOTED TEAMS 26/27 (เลื่อนชั้นจาก Championship) ────
// Coventry City   (แชมป์ Championship 25/26)
// Ipswich Town    (อันดับ 2 Championship 25/26)
// Hull City       (ชนะ Playoff Final vs Middlesbrough วันที่ 23 พ.ค. 2026)
// Southampton ถูกตัดสิทธิ์ playoff (Spygate — filming opposition training)
// ──────────────────────────────────────────────────────────

// ── CONSTANTS ─────────────────────────────────
// SIM_SQUAD_CONFIG ดึงค่าจาก CONFIG (แก้ใน CONFIG section ด้านบน)
const SIM_SQUAD_CONFIG = {
  size:       { GK:2, DEF:5, MID:5, FWD:3 },
  min_xi:     { GK:1, DEF:3, MID:2, FWD:1 },
  max_xi:     11,
  maxPerClub: 3,
  budget:     100.0,

  // alloc: [{ max_budget, type, label }]
  // type: "premium" | "mid" | "budget" | "diff" | "dm" | "starter" | "bench"
  alloc: {
    GK: [
      { max:5.5, type:"starter", label:"GK#1 Starter"  },  // ราคาพอสมควร ลงทุกนัด
      { max:4.5, type:"bench",   label:"GK#2 Bench"    },  // ถูกที่สุด รอสำรอง
    ],
    DEF: [
      { max:6.5, type:"premium", label:"DEF Premium"   },  // WB/DEF ราคาแพง attacking
      { max:6.0, type:"mid",     label:"DEF Mid #1"    },  // CB/WB กลาง
      { max:5.5, type:"mid",     label:"DEF Mid #2"    },  // CB กลาง-ถูก
      { max:4.8, type:"budget",  label:"DEF Budget"    },  // CB ถูก รอ CS
      { max:6.0, type:"diff",    label:"DEF Diff"      },  // TSB<10% differential
    ],
    MID: [
      { max:11.0, type:"premium", label:"MID Premium"  },  // Salah/Saka/Mbappe tier
      { max:8.0,  type:"mid",     label:"MID Mid #1"   },  // quality mid-range
      { max:7.0,  type:"mid",     label:"MID Mid #2"   },  // mid-range หรือ DM
      { max:5.5,  type:"dm",      label:"MID DM/Budget"},  // CDM / budget MID
      { max:7.0,  type:"diff",    label:"MID Diff"     },  // TSB<10% differential
    ],
    FWD: [
      { max:10.0, type:"premium", label:"FWD Premium"  },  // Haaland tier
      { max:7.5,  type:"mid",     label:"FWD Mid"      },  // reliable starter
      { max:7.0,  type:"diff",    label:"FWD Diff"     },  // TSB<10% differential
    ],
  },
};

const POS_ID = { GK:1, DEF:2, MID:3, FWD:4 };
const ID_POS = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

// ── STATE SCHEMA (BLIND_SIM_STATE A1 = JSON) ──
// {
//   squad:     [{ name, team, pos, price, is_starting, is_captain, is_vice }],
//   itb:       float,
//   chips:     { wc1, wc2, tc1, tc2, bb1, bb2, fh }  (tc/bb แต่ละใบใช้ได้ 1 ครั้งต่อครึ่งซีซัน)
//   ft:        int (free transfers, max 2),
//   totalPts:  int,
//   totalHits: int,
//   lastGW:    int,
//   history:   [{ gw, pts, netPts, captain, capPts, capCorrect,
//                 transfers, hits_taken, chip, itb }]
// }

// ============================================================
// PHASE 1: PREP — ดึงข้อมูลทั้งซีซัน (ทำครั้งเดียว)
// ============================================================
function blindSimPrep() {
  Logger.log("=== BLIND SIM PREP v2 START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  const fix  = fetchJSON("https://fantasy.premierleague.com/api/fixtures/");
  if (!boot || !fix) { Logger.log("❌ API failed"); return; }

  // ── ล้างข้อมูล blind sim เดิมก่อนเสมอ ── (กัน data สะสมจากรันก่อนหน้า)
  ["BLIND_SIM_DATA","BLIND_SIM_META","BLIND_SIM_STATE",
   "BLIND_SIM_RESULTS","BLIND_SIM_SQUAD","BLIND_SIM_SUMMARY"].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) { s.clearContents(); s.clearFormats(); }
  });

  ss.toast("ดึงข้อมูลทั้งซีซัน ~15 นาที...", "BLIND SIM v2", 60);

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const SIM_QUOTA = { 1:15, 2:50, 3:55, 4:30 };

  // คัด Top 150 ตามตำแหน่ง
  const top150 = [];
  [1,2,3,4].forEach(posId => {
    boot.elements
      .filter(p => p.element_type === posId)
      .sort((a,b) => b.total_points - a.total_points)
      .slice(0, SIM_QUOTA[posId])
      .forEach(p => top150.push(p));
  });
  Logger.log("Fetching " + top150.length + " players...");

  // สร้าง fixture lookup: player_id -> { GW -> {fdr, venue, opp, num_fixtures} }
  // num_fixtures > 1 = DGW (ทีมเตะ 2 นัดใน GW นั้น)
  const playerFixMap = {};
  top150.forEach(p => {
    playerFixMap[p.id] = {};
    fix.forEach(f => {
      if (!f.event) return;
      if (f.team_h === p.team || f.team_a === p.team) {
        const isHome  = f.team_h === p.team;
        const gwN     = f.event;
        if (!playerFixMap[p.id][gwN]) {
          playerFixMap[p.id][gwN] = {
            fdr:   isHome ? f.team_h_difficulty : f.team_a_difficulty,
            venue: isHome ? "H" : "A",
            opp:   teamMap[isHome ? f.team_a : f.team_h] || "?",
            num_fixtures: 1,
          };
        } else {
          // DGW: ทีมนี้เตะ 2 นัดใน GW เดียวกัน
          // ใช้ avg FDR ของ 2 แมตช์
          const ex = playerFixMap[p.id][gwN];
          const fdr2 = isHome ? f.team_h_difficulty : f.team_a_difficulty;
          ex.fdr    = +((ex.fdr + fdr2) / 2).toFixed(1);
          ex.opp    += "+" + (teamMap[isHome ? f.team_a : f.team_h] || "?");
          ex.num_fixtures = 2;
        }
      }
    });
  });

  // ดึง element-summary ทีละคน
  const allRows = [];
  top150.forEach((p, i) => {
    Utilities.sleep(300);
    if (i % 20 === 0) {
      Logger.log("  " + i + "/" + top150.length);
      ss.toast(i+"/"+top150.length+" fetched...", "BLIND SIM", 60);
    }
    const summary = fetchJSON(
      "https://fantasy.premierleague.com/api/element-summary/" + p.id + "/"
    );
    if (!summary) return;

    const posStr   = ID_POS[p.element_type] || "MID";
    const penOrder = p.penalties_order || 0;
    const cornOrder = p.corners_and_indirect_freekicks_order || 0;

    (summary.history || []).forEach(gw => {
      const gwN = parseInt(gw.round);
      const fix = playerFixMap[p.id]?.[gwN] || { fdr:3, venue:"H", opp:"?" };
      allRows.push([
        p.id, p.web_name, teamMap[p.team]||"?", posStr,
        p.element_type,
        gwN,
        parseInt(gw.total_points)||0,
        parseInt(gw.minutes)||0,
        parseInt(gw.goals_scored)||0,
        parseInt(gw.assists)||0,
        parseInt(gw.clean_sheets)||0,
        parseInt(gw.bonus)||0,
        parseInt(gw.bps)||0,
        +((gw.value || p.now_cost)/10).toFixed(1),
        +parseFloat(gw.expected_goal_involvements||0).toFixed(2),
        +parseFloat(gw.expected_goals_conceded||0).toFixed(2),
        fix.fdr, fix.venue, fix.opp, fix.num_fixtures||1,
        penOrder, cornOrder,
      ]);
    });
  });

  const HEADERS = [
    "PLAYER_ID","NAME","TEAM","POS","POS_ID",
    "GW","PTS","MIN","GOALS","AST","CS","BONUS","BPS",
    "PRICE","XGI","XGC",
    "FDR","VENUE","OPP","NUM_FIX",
    "PEN_ORDER","CORNER_ORDER",
  ];

  // ── เก็บ player metadata ครบ 150 คน (รวมคนที่ไม่มี GW history) ──
  const metaSheet = getOrCreateSheet(ss, "BLIND_SIM_META");
  metaSheet.clearContents(); metaSheet.clearFormats();
  const metaH = ["PLAYER_ID","NAME","TEAM","POS","POS_ID","START_PRICE","PEN_ORDER","CORNER_ORDER"];
  metaSheet.getRange(1,1,1,metaH.length).setValues([metaH])
           .setBackground("#1c2a50").setFontColor("#ffd60a").setFontWeight("bold");
  const metaRows = top150.map(p => [
    p.id, p.web_name, teamMap[p.team]||"?",
    ID_POS[p.element_type]||"MID", p.element_type,
    +(p.now_cost/10).toFixed(1),
    p.penalties_order||0,
    p.corners_and_indirect_freekicks_order||0,
  ]);
  metaSheet.getRange(2,1,metaRows.length,metaH.length).setValues(metaRows);
  Logger.log("✓ Meta saved: "+metaRows.length+" players");

  const ds = getOrCreateSheet(ss, "BLIND_SIM_DATA");
  ds.clearContents(); ds.clearFormats();
  ds.getRange(1,1,1,HEADERS.length).setValues([HEADERS])
    .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  if (allRows.length > 0)
    ds.getRange(2,1,allRows.length,HEADERS.length).setValues(allRows);
  ds.setFrozenRows(1);
  ds.autoResizeColumns(1, HEADERS.length);

  // Reset state
  _blindResetState(ss);

  logRun(ss, "BlindSimPrep", top150.length+"p | "+allRows.length+" rows", "SUCCESS");
  ss.toast("✅ Prep เสร็จ! "+allRows.length+" rows — รัน blindSimGW(1) ได้เลย", "BLIND SIM", 10);
  Logger.log("=== BLIND SIM PREP DONE ===");
}

// ============================================================
// PHASE 2: SIMULATE GW N
// ============================================================
function blindSimGW(targetGW) {
  if (!targetGW || targetGW < 1 || targetGW > 38) {
    Logger.log("❌ targetGW ต้องเป็น 1-38"); return;
  }
  Logger.log("=== BLIND SIM GW" + targetGW + " ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // โหลด raw data
  const ds = ss.getSheetByName("BLIND_SIM_DATA");
  if (!ds) { Logger.log("❌ รัน blindSimPrep() ก่อน"); return; }

  const raw   = ds.getDataRange().getValues();
  const hdr   = raw[0];
  const col   = name => hdr.indexOf(name);
  const allHistory = raw.slice(1).map(r => ({
    id:         r[col("PLAYER_ID")],
    name:       r[col("NAME")],
    team:       r[col("TEAM")],
    pos:        String(r[col("POS")]),
    posId:      parseInt(r[col("POS_ID")]) || 4,
    gw:         parseInt(r[col("GW")]),
    pts:        parseInt(r[col("PTS")])    || 0,
    min:        parseInt(r[col("MIN")])    || 0,
    bonus:      parseInt(r[col("BONUS")])  || 0,
    bps:        parseInt(r[col("BPS")])    || 0,
    price:      parseFloat(r[col("PRICE")]) || 5.0,
    xgi:        parseFloat(r[col("XGI")])  || 0,
    xgc:        parseFloat(r[col("XGC")])  || 0,
    fdr:        parseInt(r[col("FDR")])    || 3,
    venue:      String(r[col("VENUE")])    || "H",
    opp:        String(r[col("OPP")])      || "?",
    num_fixtures:parseInt(r[col("NUM_FIX")])||1, // DGW=2
    pen:        parseInt(r[col("PEN_ORDER")])    || 0,
    corner:     parseInt(r[col("CORNER_ORDER")]) || 0,
  }));

  // แบ่ง: ข้อมูลที่รู้ก่อน GW นี้ vs ผลจริงของ GW นี้
  const preData    = allHistory.filter(r => r.gw < targetGW);
  const actualData = allHistory.filter(r => r.gw === targetGW);
  const actualMap  = {};
  actualData.forEach(r => actualMap[r.name] = r);

  // โหลด state
  const ss2   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const stSh  = getOrCreateSheet(ss2, "BLIND_SIM_STATE");
  let   state = _blindLoadState(stSh);

  // ── STEP 1: Build player pool (ใช้แค่ preData) ──
  const pool = _blindBuildPool(preData, targetGW, allHistory);
  Logger.log("Pool: " + pool.length + " | GK:" +
    pool.filter(p=>p.pos==="GK").length + " DEF:" +
    pool.filter(p=>p.pos==="DEF").length + " MID:" +
    pool.filter(p=>p.pos==="MID").length + " FWD:" +
    pool.filter(p=>p.pos==="FWD").length);

  // ── STEP 2: Build/Update squad ──────────────────
  let chipUsed    = null;
  let gwTransfers = [];      // เก็บ log transfer สำหรับ history
  let gwFtUsed    = 0;       // FT ที่ใช้ใน GW นี้
  let gwHitsUsed  = 0;       // Hits ที่ใช้ใน GW นี้
  let ftBefore    = state.ft||1; // FT ก่อน GW นี้

  if (state.squad.length === 0) {
    // GW1: สร้างทีมแรก 15 คน (ใช้ FT ทั้งหมด = ไม่มี FT เหลือ)
    Logger.log("Building initial 15-man squad...");
    const built = _blindBuild15(pool, state.itb);
    state.squad = built.squad;
    state.itb   = built.itb;
    state.ft    = 1;  // GW1 จบแล้วได้ FT ใหม่ 1 ใบ
    gwTransfers = ["[GW1 Initial Squad Built]"];
  } else {
    // ── Chip Decision ────────────────────────────
    chipUsed = _blindDecideChip(state, pool, targetGW, actualMap);
    if (chipUsed) {
      Logger.log("CHIP: " + chipUsed + " @ GW" + targetGW +
        " | top xPts:" + (pool[0]?.simXpts||0) +
        " | topFdr:" + (pool[0]?.fdr||3) +
        " | isDGW:" + pool.some(p=>p.isDGW));
      if (chipUsed === "WC1")  { state.chips.wc1 = false; }
      if (chipUsed === "WC2")  { state.chips.wc2 = false; }
      if (chipUsed === "TC1")  { state.chips.tc1 = false; }
      if (chipUsed === "TC2")  { state.chips.tc2 = false; }
      if (chipUsed === "BB1")  { state.chips.bb1 = false; }
      if (chipUsed === "BB2")  { state.chips.bb2 = false; }
      if (chipUsed === "FH")   { state.chips.fh  = false; }
    }

    // ── Wildcard / Free Hit: build ทีมใหม่ ──────
    if (["WC1","WC2","FH"].includes(chipUsed)) {
      const sqVal    = state.squad.reduce((s,p)=>s+p.price,0);
      const newBudget = chipUsed==="FH" ? SIM_SQUAD_CONFIG.budget : sqVal + state.itb;
      const built    = _blindBuild15(pool, newBudget);
      state.squad    = built.squad;
      state.itb      = chipUsed==="FH" ? SIM_SQUAD_CONFIG.budget - sqVal : built.itb;
      // WC/FH: FT reset เป็น 1 หลัง GW (unlimited xfer แต่ไม่สะสม)
      state.ft       = 1;
      gwTransfers    = ["[" + chipUsed + ": Full squad rebuilt]"];
    } else {
      // ── Standard Transfers ───────────────────
      const xferRes   = _blindTransfer(state, pool);
      state.squad     = xferRes.squad;
      state.itb       = xferRes.itb;
      gwFtUsed        = xferRes.ftUsed;
      gwHitsUsed      = xferRes.hits;
      state.totalHits += xferRes.hits;
      gwTransfers     = xferRes.log;

      // ── FT ROLLOVER (FPL rules) ──────────────
      // FT ที่เหลือ = FT ก่อน GW - FT ที่ใช้
      // หลัง GW: ได้ FT ใหม่ 1 ใบ (max 2)
      const ftUsedThisGW = xferRes.ftUsed;
      const ftRemain     = Math.max(0, ftBefore - ftUsedThisGW);
      state.ft           = Math.min(2, ftRemain + 1);
      // ตัวอย่าง:
      //   ftBefore=2, used=2 → remain=0, ft=1
      //   ftBefore=2, used=1 → remain=1, ft=2
      //   ftBefore=2, used=0 → remain=2, ft=2 (cap)
      //   ftBefore=1, used=1 → remain=0, ft=1
      //   ftBefore=1, used=0 → remain=1, ft=2

      if (xferRes.log.length) Logger.log("Transfers: " + xferRes.log.join(" | "));
    }
  }

  // ── STEP 3: Validate squad = exactly 15, correct positions ──
  state.squad = _blindValidateSquad(state.squad, pool, state.itb);

  // ── STEP 4: Assign Starting XI ──────────────────
  _blindAssignXI(state.squad, pool);

  // ── STEP 5: Validate XI = exactly 11 ────────────
  const xiCount = state.squad.filter(p=>p.is_starting).length;
  if (xiCount !== 11) {
    Logger.log("⚠ XI count=" + xiCount + " — forcing fix");
    _blindForceXI(state.squad);
  }

  // ── STEP 6: Captain pick ─────────────────────────
  const capMulti = (chipUsed==="TC1"||chipUsed==="TC2") ? 3 : 2;
  const xi = state.squad.filter(p=>p.is_starting).sort((a,b)=>b.xpts-a.xpts);
  state.squad.forEach(p => { p.is_captain=false; p.is_vice=false; });
  if (xi[0]) xi[0].is_captain = true;
  if (xi[1]) xi[1].is_vice    = true;

  // ── STEP 7: คำนวณแต้มจริง ─────────────────────
  let simPts = 0;
  const capPlayer = state.squad.find(p=>p.is_captain);
  const capActual = actualMap[capPlayer?.name];
  const capRawPts = parseInt(capActual?.pts)||0;
  const capNetPts = capRawPts * capMulti;

  const squadSnap = state.squad.map(p => {
    const actual   = actualMap[p.name] || {};
    const rawPts   = parseInt(actual.pts)||0;
    const isCap    = p.is_captain;
    const isBB     = chipUsed==="BB1" || chipUsed==="BB2";
    // คำนวณ contribution
    let contribution = 0;
    if (p.is_starting || isBB) {
      contribution = isCap ? rawPts * capMulti : rawPts;
    }
    simPts += contribution;
    return { ...p, actualPts:rawPts, contribution, actualMin:parseInt(actual.min)||0 };
  });

  // Best captain (hindsight — เพื่อ analysis เท่านั้น ไม่ใช่โกง)
  const bestCapOption = xi.map(p => ({
    name: p.name, pts: parseInt(actualMap[p.name]?.pts)||0,
  })).sort((a,b)=>b.pts-a.pts)[0];
  const capCorrect  = capRawPts >= (bestCapOption?.pts||0);
  const capDiff     = capNetPts - (bestCapOption?.pts||0)*capMulti;

  // Hit cost
  const gwHits     = state.history.length > 0
    ? (state.totalHits - (state.history.slice(-1)[0]?.cumHits||0)) : 0;
  const hitCostGW  = gwHits * 4;
  const netSimPts  = simPts - hitCostGW;

  // FT rollover จัดการใน Step 2 แต่ละ branch แล้ว (GW1/WC/FH/Standard)
  // ห้ามแก้ state.ft ที่นี่

  // บันทึก history
  const cumHits = state.totalHits;
  state.totalPts += netSimPts;
  state.lastGW    = targetGW;
  state.history.push({
    gw:targetGW, pts:simPts, netPts:netSimPts,
    captain:capPlayer?.name||"?", capPts:capRawPts, capCorrect,
    capDiff, chip:chipUsed||"",
    hits_taken:gwHits, hitCost:hitCostGW,
    itb:state.itb, cumHits, cumPts:state.totalPts,
    // Transfer details
    transfers:    gwTransfers,
    ft_before:    ftBefore,
    ft_used:      gwFtUsed,
    ft_after:     state.ft,
    hits_used:    gwHitsUsed,
    // Chip context (บันทึกเหตุผลใช้/ไม่ใช้)
    chip_reason:  chipUsed ? _blindChipReason(chipUsed, pool, state, targetGW) : "",
    top_xpts:     pool[0]?.simXpts||0,
    is_dgw:       pool.some(p=>p.isDGW),
  });

  _blindSaveState(stSh, state);

  // ── STEP 8: เขียน results ────────────────────────
  _blindWriteResult(ss, targetGW, simPts, netSimPts,
    capPlayer?.name||"?", capRawPts, capCorrect, bestCapOption,
    gwHits, chipUsed, state.totalPts, state.itb);

  _blindWriteSquadSnap(ss, targetGW, squadSnap, simPts, netSimPts,
    capPlayer?.name||"?", capRawPts, chipUsed, state.itb);

  Logger.log(
    "GW"+targetGW+" | XI:"+state.squad.filter(p=>p.is_starting).length+
    " | Sim:"+simPts+" | Net:"+netSimPts+
    " | Cap:"+capPlayer?.name+"("+capRawPts+"pts,×"+capMulti+")" +
    (capCorrect?" ✅":" ❌ best="+bestCapOption?.name+"("+bestCapOption?.pts+"pts)") +
    " | Cum:"+state.totalPts
  );
  ss.toast("GW"+targetGW+": "+netSimPts+"pts | Total:"+state.totalPts, "BLIND SIM", 6);
  return { gw:targetGW, pts:simPts, netPts:netSimPts, cumPts:state.totalPts };
}

// ============================================================
// CORE: BUILD PLAYER POOL
// ============================================================
function _blindBuildPool(preData, targetGW, allHistory) {
  // ── KEY: ใช้ player_id แทน name เพื่อหลีกเลี่ยง duplicate web_name ──
  const byId = {};

  // Step 1: init จาก BLIND_SIM_META (ครบ 150 คนเสมอ รวมผู้เล่นที่ไม่ได้ลงเล่น)
  try {
    const ss     = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const metaSh = ss.getSheetByName("BLIND_SIM_META");
    if (metaSh) {
      const mData = metaSh.getDataRange().getValues();
      const mHdr  = mData[0];
      const mc    = n => mHdr.indexOf(n);
      mData.slice(1).forEach(r => {
        const pid = parseInt(r[mc("PLAYER_ID")]);
        if (!pid) return;
        byId[pid] = {
          meta: {
            pid,
            name:  String(r[mc("NAME")]     ||"?"),
            team:  String(r[mc("TEAM")]     ||"?"),
            pos:   String(r[mc("POS")]      ||"MID"),
            posId: parseInt(r[mc("POS_ID")])||4,
            price: parseFloat(r[mc("START_PRICE")])||5.0,
            pen:   parseInt(r[mc("PEN_ORDER")]  )||0,
            corner:parseInt(r[mc("CORNER_ORDER")])||0,
          },
          hist:[],
        };
      });
    }
  } catch(e) { Logger.log("Meta load err: "+e.message); }

  // Step 2: fallback — เพิ่ม player ที่ไม่อยู่ใน meta (จาก allHistory)
  allHistory.forEach(r => {
    if (!byId[r.id]) byId[r.id] = { meta:r, hist:[] };
  });

  // Step 3: เพิ่ม GW history ก่อน targetGW
  preData.forEach(r => {
    if (byId[r.id]) byId[r.id].hist.push(r);
  });

  return Object.values(byId).map(({ meta, hist }) => {
    const sorted = hist.sort((a,b) => b.gw - a.gw);
    const last5  = sorted.slice(0, 5);

    // avgPts: ถ้ามีประวัติใช้จริง; GW1 fallback ใช้ price tier
    const avgPts = last5.length
      ? +(last5.reduce((s,g)=>s+g.pts,0)/last5.length).toFixed(2)
      : (meta.price>=10?8.5:meta.price>=9?7.5:meta.price>=8?6.5:
         meta.price>=7?5.5:meta.price>=6?4.5:meta.price>=5.5?4.0:3.0);
    const avgMin = last5.length ? +(last5.reduce((s,g)=>s+g.min,0)/last5.length).toFixed(1) : 75;
    const avgBPS = last5.length ? +(last5.reduce((s,g)=>s+g.bps,0)/last5.length).toFixed(1) : 0;
    const avgXGC = last5.length ? last5.reduce((s,g)=>s+g.xgc,0)/last5.length : 1.5;
    const price  = sorted[0]?.price || meta.price || 5.0;

    // Fixture GW นี้ (รู้ล่วงหน้า schedule)
    const gwRow = allHistory.find(r => r.id===meta.pid && r.gw===targetGW)
                || sorted.find(r => r.gw===targetGW);
    const fdr      = gwRow?.fdr     || 3;
    const venue    = gwRow?.venue   || "H";
    const hasFix   = !!gwRow;
    // DGW: เล่น 2 นัด (num_fixtures=2 เก็บไว้ใน BLIND_SIM_DATA)
    const numFix   = gwRow?.numFix  || gwRow?.num_fixtures || 1;
    const isDGW    = numFix >= 2;

    // xPts per fixture
    const fdrFactor = hasFix ? (CONFIG.FDR_FACTORS[Math.round(fdr)]||1.0) : 0;
    const venFactor = venue==="H" ? 1.05 : 1.0;
    const minFactor = avgMin>=CONFIG.MIN_HIGH ? CONFIG.MIN_FACTOR_HIGH : avgMin>=CONFIG.MIN_MID ? CONFIG.MIN_FACTOR_MID : CONFIG.MIN_FACTOR_LOW;
    const bpsFactor = CONFIG.BPS_TIERS.find(([t])=>avgBPS>=t)?.[1]||1.0;
    const spBonus   = meta.pen===1?CONFIG.SP_PEN_FIRST:meta.corner===1?CONFIG.SP_CORNER_FIRST:1.0;

    let csProbability = 0;
    if (meta.posId <= 3 && hasFix) {
      const csBase  = CONFIG.CS_PROB_BASE[Math.round(fdr)]||0.12;
      const xgcFact = avgXGC<=0.8?1.2:avgXGC<=1.2?1.0:avgXGC<=1.8?0.85:0.7;
      csProbability = Math.min(CONFIG.CS_PROB_MAX, csBase * xgcFact * (venue==="H"?1.1:0.95));
    }
    const csPoints = [0,6,6,1,0][meta.posId]||0;

    // xPts ปกติ
    const xptsPerFix = +(
      avgPts * fdrFactor * venFactor * minFactor * bpsFactor * spBonus +
      csProbability * csPoints
    ).toFixed(2);

    // DGW: คูณด้วย 1.85 (ไม่ถึง 2 เพราะ CS ได้แค่ครั้งเดียว และ bonus แบ่งกัน)
    const simXpts = isDGW ? +(xptsPerFix * CONFIG.SIM_DGW_BOOST).toFixed(2) : xptsPerFix;

    return {
      pid:meta.pid,
      name:meta.name, team:meta.team, pos:meta.pos, posId:meta.posId,
      price, simXpts, avgPts, avgMin, hasFix, fdr, venue,
      isDGW, numFix,
      opp: gwRow?.opp||"?",
    };
  })
  .filter(p => p.price > 0 && ["GK","DEF","MID","FWD"].includes(p.pos))
  .sort((a,b) => b.simXpts - a.simXpts);
}

// ============================================================
// POSITION SCORING — composite score per position
// ============================================================

// ── Helpers ─────────────────────────────────────────────────
function _safe(v) { return parseFloat(v)||0; }

// ── Detect Defensive MID (CDM) ──────────────────────────────
// CDM proxy: xGI ต่ำ + CBI สูง + BPS สูงสัมพัทธ์ + xGC ต่ำ (team defensive)
function _isDM(p) {
  if (!p) return false;
  const xgi = _safe(p.avgXGI||0);
  const cbi = _safe(p.avgCBI||0);
  const bps = _safe(p.avgBPS||0);
  const xgc = _safe(p.avgXGC||2);
  // CDM: xGI < 2.0 (ไม่ได้เน้นยิง/โหม่ง) + CBI > 2 (defensive action บ่อย)
  //      + BPS > 15 (ทำ action ที่ได้ bonus) + team xGC < 1.5
  return xgi < 2.0 && (cbi > 2.0 || bps > 15) && xgc < 1.8;
}

// ── Main Position Score ──────────────────────────────────────
function _positionScore(p, pos, variant) {
  if (!p || !pos) return 0;
  // variant: "att_mid" = attacking MID, "def_mid" = defensive MID (CDM)
  const avgMin    = _safe(p.avgMin);
  const avgPts    = _safe(p.avgPts);
  const price     = _safe(p.price) || 5.0;
  const ppm       = price > 0 ? avgPts/price : 0;
  const xgi       = _safe(p.avgXGI||p.xgi5||0);
  const xgc       = _safe(p.avgXGC);       // team xGC per match
  const cbi       = _safe(p.avgCBI||0);
  const bp        = _safe(p.avgBonus||p.avgBP||0);
  const bps       = _safe(p.avgBPS||0);
  const saves     = _safe(p.avgSaves||0);
  const startRate = Math.min(1.0, avgMin / 90);
  const afford    = Math.max(0, (10 - price)) / 10;

  // CS proxy: ยิ่ง xGC ต่ำ = CS โอกาสสูง
  const xgcPenalty = Math.max(0, xgc - 0.5);
  const csProxy    = Math.max(0, 3.0 - xgcPenalty); // range 0-3

  // BPS/BP normalised (สูงสุด ~40 BPS, ~3 BP ต่อนัด)
  const bpsNorm = Math.min(1.0, bps / 30);
  const bpNorm  = Math.min(1.0, bp  / 2.5);
  const cbiNorm = Math.min(1.0, cbi / 5);

  let score = 0;

  if (pos === "GK") {
    // GK: CS สำคัญที่สุด + Saves + ลงครบ + PPM
    // ไม่มี differential slot (GK ไม่ควรเสี่ยง)
    const savesNorm = Math.min(1.0, saves / 5);
    score = (csProxy  * 3.5) +   // CS proxy (team xGC ต่ำ)
            (savesNorm* 2.5) +   // saves/game
            (startRate* 2.0) +   // ลงครบ 90 นาที
            (ppm      * 1.5) +   // value
            (afford   * 0.5);
  }
  else if (pos === "DEF") {
    // DEF: CS + ลงครบ + CBI (defensive actions) + PPM + ราคา
    score = (csProxy  * 3.5) +
            (ppm      * 2.5) +
            (startRate* 2.0) +
            (cbiNorm  * 1.0) +   // CBI = bonus point source
            (afford   * 1.0);
  }
  else if (pos === "MID" && variant === "def_mid") {
    // CDM / Defensive MID: CS + BPS + CBI สำคัญ + ราคาถูก (budget pick)
    // xGC ต่ำ = ทีม defensive = CDM ได้ CS บ่อย
    // BPS สูง = bonus จาก tackle, clearance, pass
    score = (csProxy  * 3.0) +   // CS potential
            (bpsNorm  * 2.5) +   // BPS = bonus ที่จะได้
            (cbiNorm  * 2.0) +   // defensive actions
            (ppm      * 1.5) +   // value
            (startRate* 1.0);
  }
  else if (pos === "MID") {
    // Attacking MID (default): xGI + PPM + ลงครบ + ราคา
    score = (xgi      * 3.0) +
            (ppm      * 2.5) +
            (startRate* 2.0) +
            (afford   * 2.5);
  }
  else if (pos === "FWD") {
    // FWD: xGI สูง + PPM + ลงครบ + ราคา
    score = (xgi      * 3.5) +
            (ppm      * 2.5) +
            (startRate* 2.0) +
            (afford   * 2.0);
  }

  return +score.toFixed(3);
}

// ── Differential Score ───────────────────────────────────────
// TSB < 10% + posScore สูง → differential bonus
// diffScore = posScore × (1 + (10-TSB)/10)
function _diffScore(p, posScore) {
  if (!p || isNaN(posScore)) return 0;
  const tsb = _safe(p.tsb || p.ownership || p.selectedBy || 100);
  if (tsb >= 10 || tsb <= 0) return 0;
  const diffBonus = (10 - tsb) / 10; // TSB 5% → bonus 0.5, TSB 1% → bonus 0.9
  return +(posScore * (1 + diffBonus)).toFixed(3);
}

// ============================================================
// CORE: BUILD 15-MAN SQUAD (strict FPL rules)
// ============================================================
function _blindBuild15(pool, budget) {
  const cfg      = SIM_SQUAD_CONFIG;
  const squad    = [];
  const teamCnt  = {};
  const used     = new Set();
  let   itb      = budget;

  ["GK","DEF","MID","FWD"].forEach(pos => {
    const slots    = cfg.alloc[pos];
    const gwIsDGW2 = pool.some(p=>p.isDGW);

    // ── Position-aware scoring ─────────────────────────────
    const allPos = pool.filter(p => p.pos===pos).map(p => {
      // ใช้ "att_mid" สำหรับ regular MID, "def_mid" จะ score แยกใน DM zone
      const variant = (pos==="MID" && _isDM(p)) ? "def_mid" : pos;
      const pScore  = _positionScore(p, pos, variant);
      const dScore  = _diffScore(p, pScore);
      const dgwBst  = gwIsDGW2&&p.isDGW ? CONFIG.SIM_DGW_SORT_BONUS : 0;
      return { ...p, pScore, dScore, totalScore: pScore + dgwBst, variant };
    });

    // Regular: TSB >= 10%
    const regularCands = allPos
      .filter(p => _safe(p.tsb||p.ownership||100) >= 10)
      .sort((a,b) => b.totalScore - a.totalScore);

    // Differential: TSB < 10% + dScore > 0 (เรียงตาม dScore)
    const diffCands = allPos
      .filter(p => _safe(p.tsb||p.ownership||100) < 10 && p.dScore > 0)
      .sort((a,b) => b.dScore - a.dScore);

    let placed = 0;

    // slots ใหม่เป็น array of { max, type, label }
    slots.forEach((slotCfg, slotIdx) => {
      // Support both old format (number) and new format (object)
      const maxBudget = typeof slotCfg === "object" ? slotCfg.max  : slotCfg;
      const slotType  = typeof slotCfg === "object" ? slotCfg.type : "regular";
      const slotLabel = typeof slotCfg === "object" ? slotCfg.label : pos+"#"+slotIdx;

      const diffInSquad = squad.filter(p=>p.isDiff).length;
      const dmInSquad   = squad.filter(p=>p.isDM).length;

      let pick     = null;
      let pickType = "regular";

      // ── ตัดสินใจตาม slotType ────────────────────────────

      // DIFF slot: หา differential (TSB < 10%) + pScore ดี
      if (slotType === "diff") {
        if (diffInSquad < 3 && diffCands.length > 0) {
          for (let bc = maxBudget; bc >= 3.5; bc -= 0.5) {
            pick = diffCands.find(c =>
              !used.has(c.name) && c.price <= Math.min(bc, itb) &&
              (teamCnt[c.team]||0) < cfg.maxPerClub
            );
            if (pick) { pickType = "DIFF"; break; }
          }
        }
        // ถ้าหา diff ไม่ได้ → fallthrough ไป regular
      }

      // DM slot: หา CDM/Defensive MID (xGI ต่ำ, CBI สูง)
      if (!pick && slotType === "dm") {
        const dmCands = allPos
          .filter(p => _isDM(p))
          .map(p => ({ ...p, dmScore: _positionScore(p, "MID", "def_mid") }))
          .sort((a,b) => b.dmScore - a.dmScore);
        for (let bc = maxBudget; bc >= 3.5; bc -= 0.5) {
          pick = dmCands.find(c =>
            !used.has(c.name) && c.price <= Math.min(bc, itb) &&
            (teamCnt[c.team]||0) < cfg.maxPerClub
          );
          if (pick) { pickType = "DM"; break; }
        }
      }

      // BUDGET slot: หา value pick ราคาถูก (เรียงตาม pScore/price ratio)
      if (!pick && slotType === "budget") {
        const budgetCands = regularCands
          .filter(p => p.price <= maxBudget)
          .sort((a,b) => {
            // budget: ดู PPM-like (pScore ต่อราคา)
            const aPPM = a.pScore / (a.price||5);
            const bPPM = b.pScore / (b.price||5);
            return bPPM - aPPM;
          });
        for (let bc = maxBudget; bc >= 3.5; bc -= 0.5) {
          pick = budgetCands.find(c =>
            !used.has(c.name) && c.price <= Math.min(bc, itb) &&
            (teamCnt[c.team]||0) < cfg.maxPerClub
          );
          if (pick) { pickType = "BUDGET"; break; }
        }
      }

      // PREMIUM / MID / STARTER / BENCH: regular sort (pScore สูงสุดในงบ)
      // (ถ้า DIFF/DM/BUDGET ไม่ได้ก็ fallthrough มาที่นี่)

      // ── Regular pick ─────────────────────────────────────
      if (!pick) {
        for (let bc = maxBudget; bc >= 3.5; bc -= 0.5) {
          pick = regularCands.find(c =>
            !used.has(c.name) && c.price<=Math.min(bc,itb) &&
            (teamCnt[c.team]||0)<cfg.maxPerClub
          );
          if (pick) { pickType="regular"; break; }
        }
        // Fallback: allPos ทั้งหมด (รวม diff)
        if (!pick) pick = allPos.find(c =>
          !used.has(c.name)&&c.price<=itb&&(teamCnt[c.team]||0)<cfg.maxPerClub
        );
      }

      if (!pick) {
        Logger.log("⚠ No candidate: "+pos+" "+slotLabel);
        return;
      }

      // Log
      const scoreVal = (pick.pScore||pick.dmScore||pick.simXpts||0);
      const tsbVal   = _safe(pick.tsb||pick.ownership||0);
      Logger.log("  ["+slotLabel+"] "+pickType+": "+pick.name+
        " £"+pick.price+"m score:"+scoreVal.toFixed(2)+
        (tsbVal>0?" TSB:"+tsbVal+"%":"")+(pick.source==="PROMOTED_2627"?" ⭐":""));

      squad.push({
        name:pick.name, team:pick.team, pos:pick.pos, posId:pick.posId,
        price:pick.price,
        xpts:     pick.totalScore || pick.simXpts || pick.pScore || pick.dmScore || 0,
        pScore:   pick.pScore || pick.dmScore || 0,
        slotType: slotType,
        slotLabel:slotLabel,
        isDiff:   pickType==="DIFF",
        isDM:     pickType==="DM",
        isBudget: pickType==="BUDGET",
        source:   pick.source||"",
        is_starting:false, is_captain:false, is_vice:false,
      });
      used.add(pick.name);
      teamCnt[pick.team] = (teamCnt[pick.team]||0)+1;
      itb -= pick.price;
      placed++;
    });
    Logger.log(pos + ": " + placed + "/" + slots.length + " placed | ITB:£"+itb.toFixed(1)+"m | "+
      squad.filter(p=>p.pos===pos).map(p=>"["+p.slotLabel+"]"+p.name).join(", "));
  });

  Logger.log("Squad total: " + squad.length + " | Composition: " +
    ["GK","DEF","MID","FWD"].map(p=>p+":"+squad.filter(s=>s.pos===p).length).join(" ") +
    " | ITB:£"+itb.toFixed(1)+"m");

  // ── Fallback padding: ถ้า placed < 15 → เติมตำแหน่งที่ขาดด้วยผู้เล่นถูกสุดที่มีในพูล ──
  // (ป้องกันทีมไม่ครบ 15 เวลา budget เหลือน้อยหรือ pool มีตัวเลือกจำกัด)
  const posNeeded = { GK:0, DEF:0, MID:0, FWD:0 };
  Object.entries(SIM_SQUAD_CONFIG.size).forEach(([p,n]) => {
    posNeeded[p] = n - squad.filter(s=>s.pos===p).length;
  });
  const usedPad  = new Set(squad.map(p=>p.name));
  const tcntPad  = {};  squad.forEach(p=>tcntPad[p.team]=(tcntPad[p.team]||0)+1);
  ["GK","DEF","MID","FWD"].forEach(pos => {
    let needed = posNeeded[pos];
    if (needed <= 0) return;
    // เรียงถูกสุด, ไม่จำกัด budget max (ใช้ itb ที่เหลือ)
    pool.filter(p=>p.pos===pos && !usedPad.has(p.name) && (tcntPad[p.team]||0)<cfg.maxPerClub)
        .sort((a,b)=>a.price-b.price)
        .forEach(p => {
          if (needed <= 0 || p.price > itb) return;
          squad.push({ name:p.name, team:p.team, pos:p.pos, posId:p.posId,
                       price:p.price, xpts:p.simXpts||p.avgPts||0,
                       is_starting:false, is_captain:false, is_vice:false,
                       slotLabel:"fallback" });
          usedPad.add(p.name); tcntPad[p.team]=(tcntPad[p.team]||0)+1;
          itb -= p.price; needed--;
          Logger.log("  [FALLBACK] เพิ่ม "+p.name+" ("+pos+",£"+p.price+"m) เพราะ squad ไม่ครบ 15");
        });
  });
  if (squad.length < 15) Logger.log("⚠ squad "+squad.length+"/15 — pool อาจมีตัวเลือกไม่พอ");

  // ── Upgrade pass: ถ้าเหลือ itb > 1.5m → upgrade ผู้เล่น xPts ต่ำสุดที่ถูก ──
  if (itb > 1.5) {
    const used2 = new Set(squad.map(p=>p.name));
    const teamCnt2 = {};
    squad.forEach(p=>teamCnt2[p.team]=(teamCnt2[p.team]||0)+1);

    squad.sort((a,b)=>(a.pScore||a.xpts||0)-(b.pScore||b.xpts||0)).forEach(cheap => {
      if (itb <= 1.0) return;
      const upgrade = pool.find(p=>
        p.pos===cheap.pos && !used2.has(p.name) &&
        p.price <= cheap.price + itb &&
        p.simXpts > cheap.xpts + 1.5 &&
        (teamCnt2[p.team]||0) < 3
      );
      if (!upgrade) return;
      const diff = upgrade.price - cheap.price;
      if (diff > itb) return;
      Logger.log("  Upgrade: "+cheap.name+"→"+upgrade.name+" +£"+diff.toFixed(1)+"m +xPts:"+(upgrade.simXpts-cheap.xpts).toFixed(1));
      const idx = squad.findIndex(p=>p.name===cheap.name);
      squad[idx] = { name:upgrade.name, team:upgrade.team, pos:upgrade.pos, posId:upgrade.posId,
                     price:upgrade.price, xpts:upgrade.simXpts,
                     is_starting:false, is_captain:false, is_vice:false };
      used2.delete(cheap.name); used2.add(upgrade.name);
      teamCnt2[cheap.team]=Math.max(0,(teamCnt2[cheap.team]||1)-1);
      teamCnt2[upgrade.team]=(teamCnt2[upgrade.team]||0)+1;
      itb -= diff;
    });
  }

  _blindAssignXI(squad, null);
  return { squad, itb:+itb.toFixed(1) };
}

// ============================================================
// CORE: TRANSFER (position-strict, FT/hit aware)
// ============================================================
// mode: "STANDARD" (default) | "AGGRESSIVE" (ข้อ 2 — late-season chase)
function _blindTransfer(state, pool, mode) {
  mode = mode || "STANDARD";
  let squad  = state.squad.map(p=>({...p}));
  const teamCnt = {};
  squad.forEach(p => teamCnt[p.team]=(teamCnt[p.team]||0)+1);
  const used  = new Set(squad.map(p=>p.name));
  let itb     = state.itb;
  const log   = [];
  let ftUsed  = 0, hits = 0;
  let ftAvail = state.ft||1;

  // อัปเดต xpts จาก pool
  squad.forEach(p => {
    const poolPlayer = pool.find(x=>x.name===p.name);
    p.xpts   = poolPlayer?.simXpts   || 0;
    p.hasFix = poolPlayer?.hasFix    || false;
    p.avgPts = poolPlayer?.avgPts    || 0;
  });

  // เรียงจาก "priority ออก" สูงสุดก่อน:
  // penalty -6 ถ้าไม่มี fixture, -3 ถ้า avgPts ต่ำมาก
  // [ข้อ 2 — ลด churn] ตัวสำรอง (is_starting=false) ได้ bonus +8 กันไม่ให้ถูกเลือก
  // "ขายออก" ง่ายๆ เพราะแทบไม่ได้ลงสนามอยู่แล้ว (เว้นแต่ไม่มี fixture เลย = ยังต้องเปลี่ยน)
  const benchBonus = (p) => (p.is_starting || !p.hasFix) ? 0 : 8;
  const byXpts = squad.slice().sort((a,b)=>{
    const aScore = a.xpts - (!a.hasFix?6:0) - (a.avgPts<3?3:0) + benchBonus(a);
    const bScore = b.xpts - (!b.hasFix?6:0) - (b.avgPts<3?3:0) + benchBonus(b);
    return aScore - bScore;
  });

  // ── mode-aware thresholds (ข้อ 2) ─────────────────────────────
  // STANDARD: FT≥3.0, HIT≥8.0, max 2 transfers/GW (FT+1 hit)
  // AGGRESSIVE: FT≥1.0, HIT≥4.0 (=hit cost พอดี), max FT+AGGR_MAX_HITS_PER_GW
  const FT_MIN_GAIN  = mode==="AGGRESSIVE" ? CONFIG.AGGR_FT_MIN_GAIN  : CONFIG.SIM_FT_MIN_GAIN;
  const HIT_MIN_GAIN = mode==="AGGRESSIVE" ? CONFIG.AGGR_HIT_MIN_GAIN : CONFIG.SIM_HIT_MIN_GAIN;
  const maxXfers = mode==="AGGRESSIVE"
    ? ftAvail + CONFIG.AGGR_MAX_HITS_PER_GW
    : Math.min(ftAvail + 1, 2);
  let xferDone   = 0;

  // ── Pre-check: best possible gain ต่ำกว่า threshold → bank FT แทน ──────
  // ถ้าไม่มีใครดีพอ ไม่ transfer เลย FT จะ rollover เป็น 2 สัปดาห์หน้า
  const bestCandGain = (() => {
    for (const out of byXpts) {
      const best = pool.find(p =>
        p.pos === out.pos && !used.has(p.name) &&
        p.price <= out.price + itb &&
        (teamCnt[p.team]||0) < 3
      );
      if (best && (best.simXpts - out.xpts) >= FT_MIN_GAIN) {
        return best.simXpts - out.xpts;
      }
    }
    return 0;
  })();

  if (bestCandGain < FT_MIN_GAIN) {
    Logger.log("  ["+mode+"] No transfer: best gain=" + bestCandGain.toFixed(1) + " < " + FT_MIN_GAIN + " — banking FT");
    return { squad, itb:+itb.toFixed(1), ftRemaining:ftAvail, ftUsed:0, hits:0, log:["No transfer (bank FT)"], mode };
  }

  for (const out of byXpts) {
    if (xferDone >= maxXfers) break;
    const isHit    = xferDone >= ftAvail;
    const minGain  = isHit ? HIT_MIN_GAIN : FT_MIN_GAIN;

    // หาตัวเข้า: ต้องเป็น POS เดียวกันเท่านั้น
    // STRICT: pos เดียวกันเท่านั้น (FPL rule)
    // Prefer DGW players ถ้าเป็น DGW week; AGGRESSIVE: prefer differential (TSB ต่ำ)
    const gwIsDGW = pool.some(p=>p.isDGW);
    const cands = pool.filter(p =>
      p.pos === out.pos &&
      !used.has(p.name) &&
      p.price <= out.price + itb &&
      p.simXpts - out.xpts >= minGain &&
      (teamCnt[p.team]||0) < SIM_SQUAD_CONFIG.maxPerClub
    ).sort((a,b) => {
      const aDGW = gwIsDGW && a.isDGW ? CONFIG.SIM_DGW_SORT_BONUS : 0;
      const bDGW = gwIsDGW && b.isDGW ? CONFIG.SIM_DGW_SORT_BONUS : 0;
      const aDiff = (mode==="AGGRESSIVE" && _safe(a.tsb)>0 && _safe(a.tsb)<CONFIG.AGGR_DIFF_TSB_MAX) ? 1.5 : 0;
      const bDiff = (mode==="AGGRESSIVE" && _safe(b.tsb)>0 && _safe(b.tsb)<CONFIG.AGGR_DIFF_TSB_MAX) ? 1.5 : 0;
      return (b.simXpts + bDGW + bDiff) - (a.simXpts + aDGW + aDiff);
    });
    if (!cands.length) continue;

    const inP = cands[0];
    const priceDiff = inP.price - out.price;
    if (priceDiff > itb) continue;

    // ทำ transfer
    const idx = squad.findIndex(p=>p.name===out.name);
    squad[idx] = { name:inP.name, team:inP.team, pos:inP.pos, posId:inP.posId,
                   price:inP.price, xpts:inP.simXpts,
                   is_starting:out.is_starting, is_captain:false, is_vice:false };
    used.delete(out.name); used.add(inP.name);
    teamCnt[out.team]  = Math.max(0,(teamCnt[out.team]||1)-1);
    teamCnt[inP.team]  = (teamCnt[inP.team]||0)+1;
    itb -= priceDiff;
    if (isHit) hits++;
    else ftUsed++;
    const diffTag = (mode==="AGGRESSIVE" && _safe(inP.tsb)>0 && _safe(inP.tsb)<CONFIG.AGGR_DIFF_TSB_MAX) ? " 🎯DIFF" : "";
    log.push("OUT:"+out.name+"("+out.xpts+"xPts) → IN:"+inP.name+"("+inP.simXpts+"xPts)"+(isHit?" [HIT-4]":" [FT]")+diffTag);
    xferDone++;
  }

  _blindAssignXI(squad, pool);
  return { squad, itb:+itb.toFixed(1),
    ftRemaining:Math.max(0,ftAvail-ftUsed),
    ftUsed, hits, log, mode };
}

// ============================================================
// CORE: ASSIGN STARTING XI (strict 11, positions enforced)
// ============================================================
function _blindAssignXI(squad, pool) {
  // อัปเดต xpts จาก pool ถ้ามี
  if (pool) squad.forEach(p => {
    p.xpts = pool.find(x=>x.name===p.name)?.simXpts || p.xpts || 0;
  });

  // Reset
  squad.forEach(p => { p.is_starting=false; p.is_captain=false; p.is_vice=false; });

  const cfg = SIM_SQUAD_CONFIG;

  // ── Pass 1: minimum ต่อตำแหน่ง ──────────────
  const posStarted = { GK:0, DEF:0, MID:0, FWD:0 };
  let started = 0;

  // เรียงตาม xPts สูงสุดต่อตำแหน่ง แล้วเลือกตาม minimum
  ["GK","DEF","MID","FWD"].forEach(pos => {
    const min  = cfg.min_xi[pos];
    const pool_pos = squad.filter(p=>p.pos===pos).sort((a,b)=>b.xpts-a.xpts);
    let placed = 0;
    for (const p of pool_pos) {
      if (placed >= min || started >= 11) break;
      p.is_starting = true;
      posStarted[pos]++;
      started++;
      placed++;
    }
  });

  // ── Pass 2: fill ด้วย xPts สูงสุด (outfield เท่านั้น) ──
  squad.filter(p=>!p.is_starting && p.pos!=="GK")
       .sort((a,b)=>b.xpts-a.xpts)
       .forEach(p => {
         if (started < 11) { p.is_starting=true; started++; }
       });

  // Captain = xPts สูงสุดใน XI
  const xi = squad.filter(p=>p.is_starting).sort((a,b)=>b.xpts-a.xpts);
  if (xi[0]) xi[0].is_captain = true;
  if (xi[1]) xi[1].is_vice    = true;
}

// Force fix ถ้า XI ไม่ได้ 11 คน
function _blindForceXI(squad) {
  const xi = squad.filter(p=>p.is_starting).sort((a,b)=>b.xpts-a.xpts);
  const bn = squad.filter(p=>!p.is_starting).sort((a,b)=>b.xpts-a.xpts);

  // ถ้า XI > 11: เอาออก
  while (squad.filter(p=>p.is_starting).length > 11) {
    const lowestXI = squad.filter(p=>p.is_starting&&p.pos!=="GK")
                          .sort((a,b)=>a.xpts-b.xpts)[0];
    if (lowestXI) lowestXI.is_starting = false;
    else break;
  }
  // ถ้า XI < 11: เพิ่ม
  squad.filter(p=>!p.is_starting).sort((a,b)=>b.xpts-a.xpts).forEach(p => {
    if (squad.filter(x=>x.is_starting).length < 11) p.is_starting = true;
  });
}

// Validate squad มี 15 คนครบ ตำแหน่งถูก
function _blindValidateSquad(squad, pool, itb) {
  const cfg = SIM_SQUAD_CONFIG;
  const need = { GK:2, DEF:5, MID:5, FWD:3 };
  const used = new Set(squad.map(p=>p.name));
  const teamCnt = {};
  squad.forEach(p => teamCnt[p.team]=(teamCnt[p.team]||0)+1);

  ["GK","DEF","MID","FWD"].forEach(pos => {
    const current = squad.filter(p=>p.pos===pos).length;
    const missing = need[pos] - current;
    if (missing <= 0) return;
    Logger.log("⚠ Missing " + missing + " " + pos + " — adding from pool");

    const cands = pool.filter(p =>
      p.pos===pos && !used.has(p.name) &&
      (teamCnt[p.team]||0) < cfg.maxPerClub
    ).sort((a,b)=>b.simXpts-a.simXpts);

    for (let i=0; i<missing && i<cands.length; i++) {
      const p = cands[i];
      squad.push({ name:p.name, team:p.team, pos:p.pos, posId:p.posId,
                   price:p.price, xpts:p.simXpts,
                   is_starting:false, is_captain:false, is_vice:false });
      used.add(p.name);
      teamCnt[p.team]=(teamCnt[p.team]||0)+1;
    }
  });

  // ถ้าเกิน 15: ตัดออก (outfield xPts ต่ำสุดก่อน)
  while (squad.length > 15) {
    const cut = squad.filter(p=>p.pos!=="GK").sort((a,b)=>a.xpts-b.xpts)[0];
    if (cut) squad.splice(squad.indexOf(cut),1);
    else break;
  }

  return squad;
}

// ============================================================
// CORE: CHIP DECISION
// ============================================================
function _blindDecideChip(state, pool, gw, actualMap) {
  const chips  = state.chips;
  const hist   = state.history;
  const gwLeft = 38 - gw + 1;
  const isFirst  = gw <= 19;
  const isSecond = gw >= 20;

  // trend ย้อนหลัง
  const last3 = hist.slice(-3);
  const avg3  = last3.length >= 3 ? last3.reduce((s,g)=>s+g.netPts,0)/3 : 50;

  // pool stats
  const topFix  = pool.filter(p=>p.hasFix);
  const topXpts = topFix[0]?.simXpts || 0;
  const topFdr  = topFix[0]?.fdr     || 3;

  // DGW detection: กี่ทีมใน squad มีเกม 2 นัด GW นี้
  const squadNames     = new Set(state.squad.map(p=>p.name));
  const squadDGW       = pool.filter(p=>squadNames.has(p.name)&&p.isDGW).length;
  const squadGoodFdr   = pool.filter(p=>squadNames.has(p.name)&&p.fdr<=3&&p.hasFix).length;
  const squadNoFix     = state.squad.length - pool.filter(p=>squadNames.has(p.name)&&p.hasFix).length;
  const isDGWweek      = pool.filter(p=>p.isDGW).length >= 8; // ≥8 players in pool have DGW

  // ─────────────────────────────────────────────────────────
  // FREE HIT: ใช้ใน BGW หรือ GW ที่ทีมเราเจ็บ/fixture แย่มาก
  // ไม่ fixed trigger — ดูจาก "คุ้มไหมที่จะเปลี่ยนทีมชั่วคราว"
  if (chips.fh) {
    // BGW: หลายคนในทีมไม่มีแมตช์
    if (squadNoFix >= CONFIG.CHIP_FH_NOFIX_THRESHOLD) return "FH";
    // Fixture แย่มาก: avg FDR ของทีมสูง
    const squadAvgFdr = pool.filter(p=>squadNames.has(p.name)&&p.hasFix)
      .reduce((s,p)=>s+p.fdr,0) / Math.max(squadGoodFdr,1);
    if (squadAvgFdr >= CONFIG.CHIP_FH_AVG_FDR_THRESHOLD && gw >= 10) return "FH";
    // Force ก่อนหมดซีซัน
    if (gwLeft <= CONFIG.CHIP_FH_FORCE_GW_LEFT) return "FH";
  }

  // ─────────────────────────────────────────────────────────
  // WILDCARD 1 (GW5-18): rebuild squad เมื่อฟอร์มแย่หรือใกล้ครึ่งซีซัน
  if (chips.wc1 && isFirst && gw >= 5) {
    if (avg3 < CONFIG.CHIP_WC_AVG3_THRESHOLD && last3.length >= 3)  return "WC1";
    if (gw >= CONFIG.CHIP_WC1_FORCE_GW)  return "WC1"; // force ก่อน GW19
  }

  // WILDCARD 2 (GW20-34)
  if (chips.wc2 && isSecond && gw <= 34) {
    if (avg3 < CONFIG.CHIP_WC_AVG3_THRESHOLD && last3.length >= 3)  return "WC2";
    if (gw >= CONFIG.CHIP_WC2_FORCE_GW)  return "WC2";
  }

  // ข้อ 3: ทีม "สดใหม่" ถ้าเพิ่งเล่น WC ภายใน CHIP_POST_WC_WINDOW GW ที่แล้ว
  // → squad ผ่านการ optimize ใหม่ ใช้เกณฑ์ปกติเล่น TC/BB ได้เลย
  // ถ้าไม่ใช่ → ต้องการ xPts/fixture ที่ดีกว่าเกณฑ์ปกติ ก่อนยอมเล่น TC/BB แบบเดี่ยวๆ
  // (ส่งเสริมให้เล่น WC ก่อน 1-2 GW แล้วค่อยตาม TC/BB แทนที่จะเล่นแยกกันแบบสุ่ม)
  const recentWC     = (gw - (state.lastWC||0)) <= CONFIG.CHIP_POST_WC_WINDOW;
  const tcXptsBar    = recentWC ? CONFIG.CHIP_TC_MIN_XPTS    : CONFIG.CHIP_TC_MIN_XPTS    + CONFIG.CHIP_STANDALONE_XPTS_BONUS;
  const bbGoodFdrBar = recentWC ? CONFIG.CHIP_BB_MIN_GOOD_FDR: CONFIG.CHIP_BB_MIN_GOOD_FDR + CONFIG.CHIP_STANDALONE_FDR_BONUS;

  // ─────────────────────────────────────────────────────────
  // TRIPLE CAPTAIN 1 (GW6-19): เลือก DGW > fixture ดี (สด WC ใช้เกณฑ์ปกติ) > force
  if (chips.tc1 && isFirst && gw >= 6) {
    if (isDGWweek && topXpts >= CONFIG.CHIP_TC_DGW_MIN_XPTS) return "TC1"; // DGW = priority สูงสุด
    if (topXpts >= tcXptsBar && topFdr <= 2)  return "TC1"; // fixture ดีมาก (เกณฑ์ขึ้นกับว่าเพิ่งเล่น WC ไหม)
    if (gw >= CONFIG.CHIP_TC1_FORCE_GW)       return "TC1"; // force
  }

  // TRIPLE CAPTAIN 2 (GW20-38)
  if (chips.tc2 && isSecond) {
    if (isDGWweek && topXpts >= CONFIG.CHIP_TC_DGW_MIN_XPTS) return "TC2"; // DGW first
    if (topXpts >= tcXptsBar && topFdr <= CONFIG.CHIP_TC_MAX_FDR) return "TC2";
    if (gwLeft <= CONFIG.CHIP_TC2_FORCE_GW_LEFT) return "TC2"; // force
  }

  // ─────────────────────────────────────────────────────────
  // BENCH BOOST 1 (GW8-19): DGW priority
  // ไม่เล่น TC และ BB ใน GW เดียวกัน (TC ก่อนเสมอ ถ้า TC ยังไม่ได้ใช้)
  if (chips.bb1 && isFirst && gw >= 8) {
    if (chips.tc1) {}                                   // ยังไม่ได้ใช้ TC → ไม่เล่น BB ก่อน
    else {
      if (isDGWweek && squadDGW >= CONFIG.CHIP_BB_MIN_GOOD_FDR-2) return "BB1"; // DGW + หลายคน 2 นัด
      if (squadGoodFdr >= bbGoodFdrBar && !isDGWweek) return "BB1"; // fixture ดีทั่วหน้า
      if (gw >= CONFIG.CHIP_BB1_FORCE_GW) return "BB1"; // force
    }
  }

  // BENCH BOOST 2 (GW20-38)
  if (chips.bb2 && isSecond) {
    if (chips.tc2 && isDGWweek) {}                     // เก็บ BB สำหรับ DGW ถัดไป
    else {
      if (isDGWweek && squadDGW >= CONFIG.CHIP_BB_MIN_GOOD_FDR-2) return "BB2";
      if (squadGoodFdr >= bbGoodFdrBar) return "BB2";
      if (gwLeft <= CONFIG.CHIP_BB2_FORCE_GW_LEFT) return "BB2"; // force
    }
  }

  return null;
}

// ============================================================
// STATE HELPERS
// ============================================================
// ── บันทึกเหตุผลการใช้ chip ──────────────────
function _blindChipReason(chip, pool, state, gw) {
  const topXpts = pool[0]?.simXpts||0;
  const topFdr  = pool[0]?.fdr||3;
  const isDGW   = pool.some(p=>p.isDGW);
  const squadNames = new Set(state.squad.map(p=>p.name));
  const squadDGW  = pool.filter(p=>squadNames.has(p.name)&&p.isDGW).length;
  const goodFdr   = pool.filter(p=>squadNames.has(p.name)&&p.fdr<=3&&p.hasFix).length;
  const noFix     = state.squad.length - pool.filter(p=>squadNames.has(p.name)&&p.hasFix).length;

  if (chip==="FH") {
    if (noFix>=5) return "BGW: "+noFix+" คนในทีมไม่มีแมตช์";
    const avgFdr = pool.filter(p=>squadNames.has(p.name)&&p.hasFix)
      .reduce((s,p)=>s+p.fdr,0)/Math.max(goodFdr,1);
    if (avgFdr>=4.2) return "Fixture แย่: avg FDR "+avgFdr.toFixed(1);
    return "Force use ก่อนหมดซีซัน";
  }
  if (chip==="WC1"||chip==="WC2") {
    const hist = state.history.slice(-3);
    const avg3 = hist.length>=3 ? hist.reduce((s,g)=>s+g.netPts,0)/3 : 50;
    if (avg3<42) return "ฟอร์มแย่ 3 GW avg:"+avg3.toFixed(0)+"pts";
    return "Force use ("+chip+"): ใกล้ครึ่งซีซัน";
  }
  if (chip==="TC1"||chip==="TC2") {
    if (isDGW&&topXpts>=8) return "DGW: "+squadDGW+" คนในทีมมี 2 นัด | top:"+topXpts+"xPts";
    if (topXpts>=9&&topFdr<=2) return "Fixture ดีมาก FDR:"+topFdr+" | "+pool[0]?.name+"="+topXpts+"xPts";
    return "Force use (GW"+gw+") top:"+topXpts+"xPts FDR:"+topFdr;
  }
  if (chip==="BB1"||chip==="BB2") {
    if (isDGW&&squadDGW>=6) return "DGW: "+squadDGW+" คนมี 2 นัด — bench pts คุ้มมาก";
    if (goodFdr>=10) return "Fixture ดีทั่วหน้า: "+goodFdr+" คน FDR≤3";
    return "Force use (GW"+gw+") goodFDR:"+goodFdr;
  }
  return chip;
}

function _blindLoadState(sheet) {
  try {
    const v = sheet.getRange(1,1).getValue();
    return v ? JSON.parse(v) : _blindDefaultState();
  } catch { return _blindDefaultState(); }
}
function _blindSaveState(sheet, state) {
  sheet.getRange(1,1).setValue(JSON.stringify(state));
}
function _blindDefaultState() {
  return {
    squad:[], itb:SIM_SQUAD_CONFIG.budget,
    // tc1/bb1 = ใบที่ 1 (GW1-19), tc2/bb2 = ใบที่ 2 (GW20-38)
    chips:{ wc1:true, wc2:true, tc1:true, tc2:true, bb1:true, bb2:true, fh:true },
    ft:1, totalPts:0, totalHits:0, lastGW:0, history:[],
  };
}
function _blindResetState(ss) {
  const sh = getOrCreateSheet(ss, "BLIND_SIM_STATE");
  sh.getRange(1,1).setValue(JSON.stringify(_blindDefaultState()));
  ["BLIND_SIM_RESULTS","BLIND_SIM_SQUAD","BLIND_SIM_SUMMARY"].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) { s.clearContents(); s.clearFormats(); }
  });

  const resH = ["GW","SIM_PTS","NET_PTS","CAPTAIN","CAP_PTS","CAP_CORRECT",
    "TRANSFERS","HITS","HIT_COST","ITB","CHIP","CUM_PTS"];
  const rs = getOrCreateSheet(ss, "BLIND_SIM_RESULTS");
  rs.getRange(1,1,1,resH.length).setValues([resH])
    .setBackground("#1c2a50").setFontColor("#b44eff").setFontWeight("bold");
}

// ============================================================
// WRITE RESULTS
// ============================================================
function _blindWriteResult(ss, gw, pts, netPts, capName, capPts, capCorrect,
                            bestCap, hits, chip, cumPts, itb) {
  const rs  = getOrCreateSheet(ss, "BLIND_SIM_RESULTS");
  const row = [
    gw, pts, netPts, capName, capPts,
    capCorrect ? "✅" : ("❌ "+bestCap?.name+"("+bestCap?.pts+"pts)"),
    "-", hits, hits*4, "£"+itb+"m", chip||"-", cumPts,
  ];
  rs.appendRow(row);
  const lr = rs.getLastRow();
  const bg = netPts>=65?"#003300":netPts>=50?"#001a00":netPts<=25?"#1a0000":"#0c1225";
  rs.getRange(lr,1,1,row.length).setBackground(bg).setFontColor("#c5d4f0");
  if (!capCorrect) rs.getRange(lr,6).setFontColor("#ff2d55");
  if (chip)        rs.getRange(lr,11).setFontColor("#ffd60a").setFontWeight("bold");
}

function _blindWriteSquadSnap(ss, gw, snap, pts, netPts, capName, capPts, chip, itb) {
  const sh = getOrCreateSheet(ss, "BLIND_SIM_SQUAD");
  if (sh.getLastRow()===0) {
    sh.getRange(1,1,1,10).setValues([[
      "GW","PLAYER","TEAM","POS","PRICE","xPTS(PRE)","ACTUAL_PTS","CONTRIBUTED","ROLE","MIN",
    ]]).setBackground("#1c2a50").setFontColor("#b44eff").setFontWeight("bold");
  }
  const hdrRow = sh.getLastRow()+1;
  sh.getRange(hdrRow,1,1,10).merge()
    .setValue("GW"+gw+" | Sim:"+pts+"pts | Net:"+netPts+
              " | Cap:"+capName+"("+capPts+"pts)"+(chip?" | "+chip:"")+" | ITB:£"+itb+"m")
    .setBackground("#0c1830").setFontColor("#00f5ff").setFontWeight("bold");

  const rows = snap
    .sort((a,b)=>(b.is_starting?1:0)-(a.is_starting?1:0)||(b.actualPts||0)-(a.actualPts||0))
    .map(p=>[
      gw, p.name, p.team, p.pos, "£"+p.price+"m",
      p.xpts||0, p.actualPts||0, p.contribution||0,
      p.is_captain?"[C]":p.is_vice?"[V]":p.is_starting?"XI":"BN",
      p.actualMin||0,
    ]);
  sh.getRange(hdrRow+1,1,rows.length,10).setValues(rows);
  rows.forEach((r,i)=>{
    const row = hdrRow+1+i;
    const bg  = r[8]==="BN"?"#0a0a0a":parseInt(r[6])>=12?"#003300":parseInt(r[6])>=6?"#001a00":"#0c1225";
    const fc  = r[8]==="[C]"?"#ffd60a":r[8]==="BN"?"#7a8fba":"#c5d4f0";
    sh.getRange(row,1,1,10).setBackground(bg).setFontColor(fc);
  });
}

// ============================================================
// PHASE 3: FULL SEASON
// ============================================================
function blindSimFull() {
  Logger.log("=== BLIND SIM FULL GW1-38 ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  if (!ss.getSheetByName("BLIND_SIM_DATA")) {
    Logger.log("❌ รัน blindSimPrep() ก่อน"); return;
  }
  for (let gw=1; gw<=38; gw++) {
    ss.toast("GW"+gw+"/38...", "BLIND SIM", 60);
    try { blindSimGW(gw); }
    catch(e) { Logger.log("✗ GW"+gw+": "+e.message); }
  }
  blindSimSummary();
}

// ============================================================
// PHASE 4: SUMMARY + AI
// ============================================================
function blindSimSummary() {
  Logger.log("=== BLIND SIM SUMMARY ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const stSh = ss.getSheetByName("BLIND_SIM_STATE");
  if (!stSh) { Logger.log("❌ ไม่พบ state"); return; }
  const state = _blindLoadState(stSh);
  const hist  = state.history||[];
  if (!hist.length) { Logger.log("❌ ไม่มี history"); return; }

  const totalPts  = hist.reduce((s,g)=>s+g.netPts,0);
  const totalHits = hist.reduce((s,g)=>s+g.hits_taken,0);
  const capOK     = hist.filter(g=>g.capCorrect).length;
  const bestGW    = hist.reduce((b,g)=>g.netPts>b.netPts?g:b,hist[0]);
  const worstGW   = hist.reduce((b,g)=>g.netPts<b.netPts?g:b,hist[0]);
  const avgPts    = +(totalPts/hist.length).toFixed(1);
  const chips     = hist.filter(g=>g.chip).map(g=>"GW"+g.gw+":"+g.chip).join(", ")||"None";

  const sumSh = getOrCreateSheet(ss, "BLIND_SIM_SUMMARY");
  sumSh.clearContents(); sumSh.clearFormats();
  let row = 1;

  sumSh.getRange(row,1,1,4).merge()
       .setValue("APEX BLIND SIM v2.0 — SEASON " + CONFIG.CURRENT_SEASON + " FINAL REPORT")
       .setBackground("#050810").setFontColor("#b44eff").setFontWeight("bold").setFontSize(14);
  row+=2;

  [["Total Pts (net)",  totalPts,  "GWs played",   hist.length],
   ["Avg Pts/GW",       avgPts,    "Total Hits",    totalHits+" (-"+(totalHits*4)+"pts)"],
   ["Captain Correct",  capOK+"/"+hist.length+" ("+(capOK/hist.length*100).toFixed(0)+"%)",
    "Chips Used",       chips],
   ["Best GW",          "GW"+bestGW.gw+" ("+bestGW.netPts+"pts)",
    "Worst GW",         "GW"+worstGW.gw+" ("+worstGW.netPts+"pts)"],
  ].forEach(r => {
    [0,1,2,3].forEach(ci=>{
      sumSh.getRange(row,ci+1).setValue(r[ci])
           .setFontColor(ci%2===0?"#7a8fba":"#ffffff")
           .setFontWeight(ci%2===0?"bold":"normal").setBackground("#0c1225");
    });
    row++;
  });
  row++;

  sumSh.getRange(row,1,1,6).setValues([["GW","GROSS_PTS","NET_PTS","CAPTAIN","CAP_CORRECT","CHIP"]])
       .setBackground("#0f1830").setFontColor("#b44eff").setFontWeight("bold");
  row++;
  hist.forEach(g=>{
    const bg = g.netPts>=65?"#003300":g.netPts<=25?"#1a0000":"#0c1225";
    sumSh.getRange(row,1,1,6).setValues([[
      "GW"+g.gw, g.pts, g.netPts, g.captain, g.capCorrect?"✅":"❌", g.chip||"-",
    ]]).setBackground(bg).setFontColor("#c5d4f0");
    if (!g.capCorrect) sumSh.getRange(row,5).setFontColor("#ff2d55");
    if (g.chip)        sumSh.getRange(row,6).setFontColor("#ffd60a").setFontWeight("bold");
    row++;
  });
  row++;

  // ── เขียน Chip Sheet ──────────────────────────
  const chipSh = getOrCreateSheet(ss, "BLIND_SIM_CHIPS");
  chipSh.clearContents(); chipSh.clearFormats();
  const chipH = ["GW","CHIP","REASON","TOP_XPTS","IS_DGW","NET_PTS_THAT_GW","VERDICT"];
  chipSh.getRange(1,1,1,chipH.length).setValues([chipH])
        .setBackground("#1c2a50").setFontColor("#ffd60a").setFontWeight("bold");
  const chipRows = hist.filter(g=>g.chip).map(g=>[
    "GW"+g.gw, g.chip, g.chip_reason||"-",
    g.top_xpts||"-", g.is_dgw?"DGW":"normal",
    g.netPts,
    // verdict: ใช้ chip ใน DGW = ดี, ไม่ใช่ = โอกาสพลาด
    (g.is_dgw?"✅ DGW timing":g.netPts>=60?"✅ Good":g.netPts>=45?"➖ OK":"❌ Poor timing"),
  ]);
  if (chipRows.length) chipSh.getRange(2,1,chipRows.length,chipH.length).setValues(chipRows);

  // เพิ่มแถวชิพที่ไม่ได้ใช้แต่น่าจะใช้ (DGW ที่ไม่ได้เล่น TC/BB)
  const dgwMissed = hist.filter(g=>g.is_dgw && !g.chip);
  if (dgwMissed.length) {
    const startRow = (chipRows.length||0)+3;
    chipSh.getRange(startRow,1,1,chipH.length).merge()
          .setValue("DGW ที่ไม่ได้ใช้ chip — โอกาสที่พลาด")
          .setBackground("#1a0a00").setFontColor("#ff9a00").setFontWeight("bold");
    const missedRows = dgwMissed.map(g=>["GW"+g.gw,"-","DGW แต่ไม่ได้ใช้ chip",g.top_xpts||"-","DGW",g.netPts,"⚠ Missed"]);
    chipSh.getRange(startRow+1,1,missedRows.length,chipH.length).setValues(missedRows)
          .setBackground("#1a0a00").setFontColor("#ff9a00");
  }
  chipSh.setFrozenRows(1);
  chipSh.autoResizeColumns(1,chipH.length);

  // ── เขียน Transfer Sheet ───────────────────────
  const xferSh = getOrCreateSheet(ss, "BLIND_SIM_XFERS");
  xferSh.clearContents(); xferSh.clearFormats();
  const xferH = ["GW","FT_BEFORE","FT_USED","HITS","FT_AFTER","CHIP","TRANSFERS"];
  xferSh.getRange(1,1,1,xferH.length).setValues([xferH])
        .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  const xferRows = hist.map(g=>[
    "GW"+g.gw,
    g.ft_before||"-", g.ft_used||0, g.hits_used||0, g.ft_after||"-",
    g.chip||"-",
    (g.transfers||[]).join(" | ")||"No change",
  ]);
  if (xferRows.length) {
    xferSh.getRange(2,1,xferRows.length,xferH.length).setValues(xferRows);
    xferRows.forEach((r,i)=>{
      const row = i+2;
      const bg  = r[3]>0?"#1a0000":r[1]===2&&r[2]===2?"#001a1a":"#0c1225";
      const fc  = r[3]>0?"#ff2d55":"#c5d4f0";
      xferSh.getRange(row,1,1,xferH.length).setBackground(bg).setFontColor(fc);
      if (r[5]&&r[5]!=="-") xferSh.getRange(row,6).setFontColor("#ffd60a").setFontWeight("bold");
    });
  }
  xferSh.setFrozenRows(1);
  xferSh.autoResizeColumns(1,xferH.length);

  // ── AI Analysis ────────────────────────────────
  // สร้าง chip summary สำหรับ AI
  const chipSummary = hist.filter(g=>g.chip)
    .map(g=>"GW"+g.gw+":"+g.chip+"("+g.chip_reason+"->"+g.netPts+"pts"+(g.is_dgw?",DGW":"")+")").join("\n");
  const chipsNotUsed = ["tc1","tc2","bb1","bb2","fh"].filter(c=>state.chips?.[c]);
  const missedDGWs   = hist.filter(g=>g.is_dgw&&!g.chip).map(g=>"GW"+g.gw).join(",");

  const aiReview = callGemini(
`APEX BLIND SIM — Season ${CONFIG.CURRENT_SEASON} Review

ผลรวม: ${totalPts}pts (avg ${avgPts}/GW)
Hits: ${totalHits} ครั้ง (-${totalHits*4}pts) | Captain correct: ${capOK}/${hist.length} GW
Best: GW${bestGW.gw}(${bestGW.netPts}pts) | Worst: GW${worstGW.gw}(${worstGW.netPts}pts)

CHIP USAGE:
${chipSummary||"ไม่ได้ใช้ chip เลย"}
Chips ที่ไม่ได้ใช้: ${chipsNotUsed.join(",")||"ใช้หมดแล้ว"}
DGW ที่ไม่ได้เล่น chip: ${missedDGWs||"ไม่มี"}

GW-by-GW:
${hist.map(g=>"GW"+g.gw+":"+g.netPts+"pts"+(g.capCorrect?"✅":"❌cap")+(g.chip?":"+g.chip:"")+(g.is_dgw?":DGW":"")).join(" | ")}

วิเคราะห์ blind-test ซีซัน ${CONFIG.CURRENT_SEASON}:
1. OVERALL — total ${totalPts}pts เปรียบกับเป้า ${CONFIG.TARGET_PTS}pts อยู่ที่ rank ไหน?
2. CHIPS — ใช้ถูก GW ไหม? DGW ที่พลาด: ${missedDGWs} ควรทำอะไรต่างออกไป?
3. CAPTAIN — pattern ดีไหม? GW ไหนพลาดหนักสุด?
4. HITS — คุ้มไหม?
5. KEY LESSON 3 ข้อสำหรับ 26/27

ตอบภาษาไทย ละเอียด มีตัวเลข`
  );
  if (aiReview) {
    sumSh.getRange(row,1,1,4).merge().setValue("AI SEASON ANALYSIS")
         .setBackground("#0a0a1a").setFontColor("#b44eff").setFontWeight("bold").setFontSize(11);
    row++;
    sumSh.getRange(row,1,1,4).merge().setValue(aiReview)
         .setBackground("#08080f").setFontColor("#c5d4f0")
         .setFontFamily("Courier New").setFontSize(10)
         .setWrap(true).setVerticalAlignment("top");
    sumSh.setRowHeight(row,400);
  }
  sumSh.autoResizeColumns(1,4);
  ss.toast("✅ Total:"+totalPts+"pts | Cap:"+capOK+"/"+hist.length+" | ดูที่ BLIND_SIM_SUMMARY","BLIND SIM",10);
  logRun(ss,"BlindSimSummary","GWs:"+hist.length+" | "+totalPts+"pts","SUCCESS");
}

// ============================================================
// RESET & UTILS
// ============================================================
// ============================================================
// PROMOTED TEAMS DATA — ข้อมูลนักเตะจากทีมที่เลื่อนชั้น 26/27
// Coventry City | Ipswich Town | Hull City
// ============================================================
function blindSimPromotedTeams() {
  Logger.log("=== PROMOTED TEAMS 26/27 ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) { Logger.log("❌ API failed"); return; }

  // ทีมที่เลื่อนชั้น 26/27
  const PROMOTED = {
    "COV": "Coventry City",    // แชมป์ Championship
    "IPS": "Ipswich Town",     // อันดับ 2
    "HUL": "Hull City",        // ชนะ Playoff Final
  };

  // ดึงนักเตะจาก FPL bootstrap (ถ้า FPL 26/27 ยังไม่เปิด จะไม่มีข้อมูล)
  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  // หาทีมที่เลื่อนชั้นใน bootstrap
  const promotedTeamIds = boot.teams
    .filter(t => Object.keys(PROMOTED).includes(t.short_name) ||
                 Object.values(PROMOTED).some(name => t.name.includes(name.split(" ")[0])))
    .map(t => t.id);

  Logger.log("Promoted teams in FPL data: " + promotedTeamIds.length);

  // ถ้า FPL 26/27 ยังไม่มีข้อมูล → สร้าง manual sheet
  const sheet = getOrCreateSheet(ss, "BLIND_SIM_PROMOTED");
  sheet.clearContents(); sheet.clearFormats();

  const hdr = ["TEAM","NAME","POS","PRICE_25_26","TOTAL_PTS_25_26","STATUS",
               "MINUTES","GOALS","ASSISTS","OWNERSHIP%","NOTE"];
  sheet.getRange(1,1,1,hdr.length).setValues([hdr])
       .setBackground("#1c2a50").setFontColor("#00f5ff").setFontWeight("bold");
  let row = 2;

  if (promotedTeamIds.length > 0) {
    // มีข้อมูลใน FPL แล้ว
    const promotedPlayers = boot.elements
      .filter(p => promotedTeamIds.includes(p.team))
      .sort((a,b) => b.total_points - a.total_points);

    Logger.log("Players from promoted teams: " + promotedPlayers.length);

    if (promotedPlayers.length > 0) {
      const dataRows = promotedPlayers.map(p => [
        teamMap[p.team]||"?", p.web_name, posMap[p.element_type]||"?",
        +(p.now_cost/10).toFixed(1), p.total_points,
        p.status==="a"?"AVAILABLE":p.status==="i"?"INJURED":p.status||"?",
        p.minutes, p.goals_scored||0, p.assists||0,
        +p.selected_by_percent, "FPL 26/27 data",
      ]);
      sheet.getRange(row,1,dataRows.length,hdr.length).setValues(dataRows);
      row += dataRows.length;
    }
  } else {
    // FPL 26/27 ยังไม่มี — ใส่ข้อมูล manual จาก Championship 25/26
    // (ข้อมูลสถิติซีซัน 25/26 จาก Championship)
    const manualData = [
      // Coventry City — แชมป์ Championship 25/26 (topscorer: Zan Vipotnik ไป Swansea)
      ["COV","Callum O'Hare",       "MID", 6.0, 0, "AVAILABLE", 0, 0, 0, 0, "Key creative MID - follow FPL price"],
      ["COV","Haji Wright",          "FWD", 6.5, 0, "AVAILABLE", 0, 0, 0, 0, "USMNT striker"],
      ["COV","Joel Latibeaudiere",   "DEF", 5.0, 0, "AVAILABLE", 0, 0, 0, 0, "Regular starter DEF"],
      ["COV","Benjamin Wilson",       "GK",  5.0, 0, "AVAILABLE", 0, 0, 0, 0, "First choice GK"],
      ["COV","Viktor Gyökeres",      "FWD", 0.0, 0, "LEFT CLUB", 0, 0, 0, 0, "ย้ายไป Sporting CP แล้ว"],
      // Ipswich Town — อันดับ 2 Championship 25/26
      ["IPS","Omari Hutchinson",     "MID", 6.5, 0, "AVAILABLE", 0, 0, 0, 0, "Key attacker"],
      ["IPS","Liam Delap",           "FWD", 7.0, 0, "AVAILABLE", 0, 0, 0, 0, "Striker - was on loan from Man City"],
      ["IPS","George Edmundson",     "DEF", 5.0, 0, "AVAILABLE", 0, 0, 0, 0, "CB"],
      ["IPS","Christian Walton",     "GK",  5.0, 0, "AVAILABLE", 0, 0, 0, 0, "GK"],
      // Hull City — ชนะ Playoff Final 23 พ.ค. 2026
      ["HUL","Oli McBurnie",         "FWD", 6.5, 0, "AVAILABLE", 0, 0, 0, 0, "Playoff final winner - scored decisive goal"],
      ["HUL","Mohamed Belloumi",     "MID", 6.0, 0, "AVAILABLE", 0, 0, 0, 0, "Scored in playoff semi-final"],
      ["HUL","Joe Gelhardt",         "FWD", 5.5, 0, "AVAILABLE", 0, 0, 0, 0, "Key attacker"],
      ["HUL","Ivor Pandur",          "GK",  4.5, 0, "AVAILABLE", 0, 0, 0, 0, "GK"],
    ];
    sheet.getRange(row,1,manualData.length,hdr.length).setValues(manualData);

    // Color ตามทีม
    const teamColors = { COV:"#001a6e", IPS:"#00008b", HUL:"#ff8c00" };
    manualData.forEach((r,i) => {
      const bg = r[5]==="LEFT CLUB"?"#1a0000":teamColors[r[0]]||"#0c1225";
      const fc = r[5]==="LEFT CLUB"?"#ff2d55":"#c5d4f0";
      sheet.getRange(row+i,1,1,hdr.length).setBackground(bg).setFontColor(fc);
    });
    row += manualData.length;

    // เพิ่มหมายเหตุ
    row++;
    sheet.getRange(row,1,1,hdr.length).merge()
         .setValue("NOTE: FPL 26/27 ยังไม่เปิด — ราคาเป็น estimate เท่านั้น รอ FPL official release ประมาณ ก.ค. 2026")
         .setBackground("#1a1000").setFontColor("#ffd60a").setFontStyle("italic");
    row++;
    sheet.getRange(row,1,1,hdr.length).merge()
         .setValue("Championship Topscorer: Zan Vipotnik (Swansea City) 23 goals — NOT joining promoted teams")
         .setBackground("#0a0a0a").setFontColor("#7a8fba");
  }

  // ── AI วิเคราะห์ทีมเลื่อนชั้น ─────────────────────
  const aiAnalysis = callGemini(
`วิเคราะห์ทีมที่เลื่อนชั้นสู่ Premier League 26/27 สำหรับ FPL:

1. Coventry City (แชมป์ Championship 25/26)
   - กลับสู่ Premier League ครั้งแรกใน 25 ปี
   - ผู้เล่น key: Callum O'Hare (MID), Haji Wright (FWD)
   - Viktor Gyökeres ย้ายไปแล้ว

2. Ipswich Town (อันดับ 2)
   - เลื่อนชั้นได้ด้วยชัยชนะ 3-0 เหนือ QPR วันสุดท้าย
   - กลับสู่ Premier League หลังจากจบรองบ๊วย 25/26

3. Hull City (ชนะ Playoff Final)
   - ชนะ Middlesbrough ในรอบชิง 23 พ.ค. 2026
   - Oli McBurnie ทำประตูชัยชนะ
   - เป็นทีมแรกนับตั้งแต่ Blackpool 2010 ที่ขึ้นมาจากอันดับ 6

วิเคราะห์สำหรับ FPL ภาษาไทย:
1. ทีมไหนน่า avoid สุด (promoted teams มักแพ้บ่อยใน PL)
2. ผู้เล่นคนไหนอาจ surprise (fixture ง่ายต้นซีซัน)
3. กลยุทธ์ FPL: ควร own นักเตะจากทีมเหล่านี้ไหม?

ตอบภาษาไทย กระชับ มีเหตุผล`
  );

  if (aiAnalysis) {
    row++;
    sheet.getRange(row,1,1,hdr.length).merge()
         .setValue("AI ANALYSIS — FPL 26/27 Promoted Teams")
         .setBackground("#0a0a1a").setFontColor("#b44eff").setFontWeight("bold").setFontSize(11);
    row++;
    sheet.getRange(row,1,1,hdr.length).merge()
         .setValue(aiAnalysis)
         .setBackground("#08080f").setFontColor("#c5d4f0")
         .setFontFamily("Courier New").setFontSize(10).setWrap(true);
    sheet.setRowHeight(row, 350);
  }

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1,hdr.length);
  logRun(ss, "PromotedTeams", "COV+IPS+HUL | GK:1+1+1", "SUCCESS");
  ss.toast("✅ Promoted teams data ready — ดูที่ BLIND_SIM_PROMOTED", "APEX", 8);
  Logger.log("=== PROMOTED TEAMS DONE ===");
}

function blindSimReset() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  _blindResetState(ss);
  ss.toast("✅ Reset เรียบร้อย — รัน blindSimGW(1) ได้เลย","BLIND SIM",8);
  Logger.log("✓ Blind sim reset (PREP data preserved)");
}

// ── helper: รัน GW ถัดจาก lastGW อัตโนมัติ ──
function blindSimNext() {
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const stSh  = ss.getSheetByName("BLIND_SIM_STATE");
  if (!stSh) { Logger.log("❌ รัน blindSimPrep() ก่อน"); return; }
  const state = _blindLoadState(stSh);
  const next  = (state.lastGW||0) + 1;
  if (next > 38) { Logger.log("✓ Season complete! รัน blindSimSummary()"); blindSimSummary(); return; }
  blindSimGW(next);
}

// ============================================================
// APEX PREDICT 26/27 — Season Score Projection
// จำลองฤดูกาล 26/27 โดยใช้:
//   1. สถิติ 25/26 เป็น baseline ผู้เล่น
//   2. ประมาณ FDR จาก EPL 25/26 final standings
//   3. Monte Carlo 3 รอบ (pessimistic / base / optimistic)
//   4. AI วิเคราะห์ผลและคำแนะนำ
//
// EPL 25/26 Final Standings (ข้อมูลจริง):
//   1. Arsenal (85pts) — Champions
//   2. Man City (78pts)
//   3. Man United (71pts)
//   4. Aston Villa (65pts)
//   5. Liverpool (60pts)
//   6. Bournemouth (57pts)
//   7. Sunderland (54pts)
//   8-17. [mid-table]
//   18. West Ham (relegated)
//   19. Burnley (relegated)
//   20. Wolves (relegated — GW38)
//
// Promoted 26/27:
//   Coventry City (Championship champions)
//   Ipswich Town (runners-up)
//   Hull City (playoff winners — beat Middlesbrough 23 May 2026)
// ============================================================

const EPL_2627_STRENGTH = {
  // FDR estimate for 26/27: 1=easiest to attack against, 5=hardest
  // Based on 25/26 final table + transfer window expectations
  "ARS": 5,   // Arsenal — defending champions
  "MCI": 5,   // Man City
  "MUN": 4,   // Man United
  "AVL": 4,   // Aston Villa
  "LIV": 4,   // Liverpool
  "BOU": 3,   // Bournemouth
  "SUN": 3,   // Sunderland (EL)
  "NEW": 3,   // Newcastle (estimated mid)
  "TOT": 3,   // Tottenham
  "CHE": 3,   // Chelsea
  "BRE": 2,   // Brentford
  "BRI": 3,   // Brighton
  "CRY": 2,   // Crystal Palace
  "EVE": 2,   // Everton
  "FUL": 2,   // Fulham
  "NOT": 2,   // Nottm Forest
  "COV": 1,   // Coventry (promoted - weaker defense)
  "IPS": 1,   // Ipswich (promoted)
  "HUL": 1,   // Hull City (promoted - playoff 6th seed)
  // 20th team TBD
};

function blindSimPredict2627() {
  Logger.log("=== APEX PREDICT 26/27 START ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ss.toast("กำลังจำลอง 26/27... (~5 นาที)", "APEX PREDICT", 60);

  // โหลด baseline data จาก 25/26
  const ds = ss.getSheetByName("BLIND_SIM_DATA");
  if (!ds) { Logger.log("❌ รัน blindSimPrep() ก่อน"); return; }

  const raw = ds.getDataRange().getValues();
  const hdr = raw[0];
  const col = name => hdr.indexOf(name);

  // โหลดผู้เล่นทั้งหมด (25/26 stats)
  const allHistory = raw.slice(1).map(r => ({
    id:    r[col("PLAYER_ID")], name:  r[col("NAME")],
    team:  r[col("TEAM")],      pos:   String(r[col("POS")]),
    posId: parseInt(r[col("POS_ID")])||4, gw: parseInt(r[col("GW")]),
    pts:   parseInt(r[col("PTS")])||0,    min: parseInt(r[col("MIN")])||0,
    bps:   parseInt(r[col("BPS")])||0,    price: parseFloat(r[col("PRICE")])||5.0,
    xgc:   parseFloat(r[col("XGC")])||0,
    pen:   parseInt(r[col("PEN_ORDER")])||0,
    corner:parseInt(r[col("CORNER_ORDER")])||0,
  }));

  // ── สร้าง player pool สำหรับ 26/27 ──────────────
  // ใช้ stats ทั้งซีซัน 25/26 เป็น baseline
  const byId = {};
  allHistory.forEach(r => {
    if (!byId[r.id]) byId[r.id] = { meta:r, hist:[] };
    byId[r.id].hist.push(r);
  });

  // ── EPL 26/27 team changes ─────────────────────
  // ตกชั้นออกจาก EPL 26/27 (ไม่รวมในพูล)
  const RELEGATED_2526  = new Set(["WHU","BUR","WOL"]); // West Ham, Burnley, Wolves
  // เลื่อนชั้นขึ้นมา (เพิ่มเข้าพูล)
  const PROMOTED_2627_TEAMS = ["COV","IPS","HUL"]; // Coventry, Ipswich, Hull City

  const basePool = Object.values(byId)
    .filter(({ meta }) => !RELEGATED_2526.has(meta.team)) // ❌ ตัดทีมตกชั้น
    .map(({ meta, hist }) => {
      const avgPts   = hist.length ? +(hist.reduce((s,g)=>s+g.pts,0)/hist.length).toFixed(2) : 3;
      const avgMin   = hist.length ? +(hist.reduce((s,g)=>s+g.min,0)/hist.length).toFixed(1) : 60;
      const avgBPS   = hist.length ? +(hist.reduce((s,g)=>s+g.bps,0)/hist.length).toFixed(1) : 0;
      const avgXGC   = hist.length ? hist.reduce((s,g)=>s+g.xgc,0)/hist.length : 1.5;
      const lastPrice = hist.sort((a,b)=>b.gw-a.gw)[0]?.price || meta.price;

      return {
        pid:meta.id, name:meta.name, team:meta.team, pos:meta.pos, posId:meta.posId,
        price:lastPrice, avgPts, avgMin, avgBPS, avgXGC,
        pen:meta.pen, corner:meta.corner,
        bpsFactor: CONFIG.BPS_TIERS.find(([t])=>avgBPS>=t)?.[1]||1.0,
        minFactor: avgMin>=CONFIG.MIN_HIGH?CONFIG.MIN_FACTOR_HIGH:avgMin>=CONFIG.MIN_MID?CONFIG.MIN_FACTOR_MID:CONFIG.MIN_FACTOR_LOW,
        spBonus:   meta.pen===1?CONFIG.SP_PEN_FIRST:meta.corner===1?CONFIG.SP_CORNER_FIRST:1.0,
      };
    }).filter(p => p.price > 0 && ["GK","DEF","MID","FWD"].includes(p.pos));

  // ── เพิ่มผู้เล่นจากทีมที่เลื่อนชั้น ──────────────
  // Estimate: promoted team players มักได้แต้มน้อยกว่า PL average ~30-40%
  // ราคา: PL entry price (ต่ำ เพราะยังไม่มีประวัติ PL)
  // avgPts baseline: Championship top scorer ~4-5/GW → PL ~3-4/GW
const promotedPlayers = Object.entries(PROMOTED_PLAYERS_DATA).flatMap(([teamCode, teamData]) =>
    teamData.players
      .filter(p => p.apps > 0) // ตัดผู้เล่นที่ไม่มีนัดลงเล่น (เช่น Dovin GK สำรองที่ขายออกแล้ว)
      .map((p, i) => {
        const goalPtsByPos = { GK:10, DEF:6, MID:5, FWD:4 };
        const perGameGoals   = p.goals   / p.apps;
        const perGameAssists = p.assists / p.apps;
        const avgMin = p.mp / p.apps;
        const appPts = avgMin >= 60 ? 2 : avgMin > 0 ? 1 : 0;
        // avgPts: appearance + goals + assists เท่านั้น (CS แยกคำนวณผ่าน csProbability,
        // bonus แยกคำนวณผ่าน bpsFactor — ไม่ดับเบิลนับ เหมือน pattern อื่นในระบบ)
        const avgPts = +(appPts + perGameGoals*goalPtsByPos[p.pos] + perGameAssists*3).toFixed(2);
        const avgBPS = p.apps ? +(p.bps/p.apps).toFixed(1) : 0;
        const noteLC = (p.note||"").toLowerCase();
        const pen    = noteLC.includes("pen") ? 1 : 0;
        const corner = noteLC.includes("corner") ? 1 : 0;
        return {
          pid: 9000 + Object.keys(PROMOTED_PLAYERS_DATA).indexOf(teamCode)*100 + i,
          name: p.name, team: teamCode, pos: p.pos,
          posId: {GK:1,DEF:2,MID:3,FWD:4}[p.pos]||4,
          price: p.price_est,
          avgPts, avgMin: +avgMin.toFixed(1), avgBPS,
          avgXGC: teamData.xGA_per_game, // team-level xGC ใช้แทนรายบุคคล (สมเหตุสมผลสำหรับ GK/DEF/MID)
          pen, corner,
          bpsFactor: CONFIG.BPS_TIERS.find(([t])=>avgBPS>=t)?.[1]||1.0,
          minFactor: avgMin>=CONFIG.MIN_HIGH?CONFIG.MIN_FACTOR_HIGH:avgMin>=CONFIG.MIN_MID?CONFIG.MIN_FACTOR_MID:CONFIG.MIN_FACTOR_LOW,
          spBonus: pen===1?CONFIG.SP_PEN_FIRST:corner===1?CONFIG.SP_CORNER_FIRST:1.0,
          isPromoted: true,
        };
      })
  );

  // รวม pool
  const fullBasePool = [...basePool, ...promotedPlayers];

  Logger.log("Base pool (excl. relegated): " + basePool.length +
    " | Promoted added: " + promotedPlayers.length +
    " | Total: " + fullBasePool.length);
  Logger.log("Relegated excluded: " + [...RELEGATED_2526].join(", "));
  Logger.log("Promoted included: " + PROMOTED_2627_TEAMS.join(", "));

  // ── Generate 26/27 fixture schedule (estimated) ──
  // เนื่องจาก fixture 26/27 ยังไม่ประกาศ (19 มิ.ย. 2026)
  // ใช้ Monte Carlo: generate random fixtures ตาม team strength
  // ทำ 3 scenarios: pessimistic, base, optimistic

  const scenarios = [
    { name:"Pessimistic",  fdrBias:+0.5, label:"⬇ แย่กว่าคาด" },
    { name:"Base",         fdrBias: 0.0, label:"➡ ตามคาด" },
    { name:"Optimistic",   fdrBias:-0.5, label:"⬆ ดีกว่าคาด" },
  ];

  const scenarioResults = [];

  scenarios.forEach(scenario => {
    Logger.log("Running scenario: " + scenario.name);
    ss.toast("Scenario: " + scenario.name + "...", "APEX PREDICT", 60);

    // Generate fixture pool สำหรับ scenario นี้ (ใช้ fullBasePool ที่มี promoted teams แล้ว)
    const pool = fullBasePool.map(p => {
      // สุ่ม fixture ต่อ GW (ทำ 38 GW)
      const teamStrength = EPL_2627_STRENGTH[p.team] || 3;

      // xPts เฉลี่ยต่อ GW (ไม่รู้ fixture จริง → ใช้ avg FDR per team strength)
      // Promoted teams: FDR ง่ายกว่าค่าเฉลี่ยเล็กน้อย (แต่ stats ยังไม่แกร่ง)
      // Relegated teams: ถูกกรองออกแล้ว
      const teamStr  = EPL_2627_STRENGTH[p.team] || 3;
      // avgFDR ของทีมนี้: ทีมแข็ง (5) → fixture มักยาก, ทีมอ่อน (1) → fixture ง่ายกว่า
      // promoted team (COV/IPS/HUL = strength 1) → avg FDR ต่ำกว่า (fixture ง่ายกว่า)
      const teamFDRBias = p.isPromoted ? -0.3 : 0; // promoted: fixture ง่ายกว่าเล็กน้อยต้นซีซัน
      const avgFDR   = Math.min(5, Math.max(1, 3.0 + scenario.fdrBias + teamFDRBias));
      const fdrFactor = CONFIG.FDR_FACTORS[Math.round(avgFDR)]||1.0;

      // CS probability: promoted GK/DEF ได้น้อยกว่า (concede มากกว่า)
      const csCapMulti    = p.isPromoted ? 0.6 : 1.0; // promoted: CS โอกาสต่ำกว่า 40%
      const csProbability = p.posId <= 3
        ? Math.min(CONFIG.CS_PROB_MAX * 0.5, (5-avgFDR)*0.12 * 1.1 * csCapMulti) : 0;
      const csPoints = [0,6,6,1,0][p.posId]||0;

      // Promoted players: apply extra discount (ยังปรับตัวกับ PL ไม่ได้ทันที)
      const newTeamDiscount = p.isPromoted ? 0.85 : 1.0; // ~15% discount ต้นซีซัน

      const simXpts = +(
        p.avgPts * fdrFactor * 1.025 * p.minFactor * p.bpsFactor * p.spBonus * newTeamDiscount +
        csProbability * csPoints
      ).toFixed(2);

      return { ...p, simXpts, hasFix:true, isDGW:false, fdr:Math.round(avgFDR), venue:"H" };
    }).sort((a,b) => b.simXpts - a.simXpts);

    // จำลองซีซัน 26/27 (38 GW)
    const simState = {
      squad:[], itb:SIM_SQUAD_CONFIG.budget,
      chips:{ wc1:true, wc2:true, tc1:true, tc2:true, bb1:true, bb2:true, fh:true },
      ft:1, totalPts:0, totalHits:0, lastGW:0, history:[],
      lastWC: 0, // ข้อ 3: GW ล่าสุดที่เล่น WC (ใช้บังคับ sequencing WC→TC/BB)
    };

    let seasonPts = 0;
    const gwResults = [];

    // เก็บ GW detail สำหรับ Base scenario เท่านั้น (ประหยัด memory)
    const isBase   = scenario.name === "Base";
    const gwDetail = []; // เก็บ squad + transfer detail ทุก GW

    for (let gw = 1; gw <= 38; gw++) {
      let chip       = null;
      let gwXfers    = [];
      let gwFtUsed   = 0;
      let gwHits     = 0;
      const ftBefore = simState.ft;

      // GW1: build squad
      if (simState.squad.length === 0) {
        const built = _blindBuild15(pool, simState.itb);
        simState.squad = built.squad;
        simState.itb   = built.itb;
        simState.ft    = 1;
        gwXfers = ["[Initial squad built]"];
      } else {
        // Chip decision
        chip = _blindDecideChip(simState, pool, gw, {});
        if (chip) {
          // chip key: "TC1" → "tc1", "BB2" → "bb2" etc.
          const chipKey = chip.toLowerCase();
          simState.chips[chipKey] = false;
          if (["WC1","WC2","FH"].includes(chip)) {
            const sqVal = simState.squad.reduce((s,p)=>s+p.price,0);
            const built = _blindBuild15(pool, sqVal + simState.itb);
            simState.squad = built.squad;
            simState.itb   = built.itb;
            simState.ft    = 1;
            gwXfers = ["[" + chip + ": Full squad rebuilt]"];
            // ข้อ 3: WC1/WC2 (ไม่ใช่ FH ซึ่งเป็นแค่ทีมชั่วคราว) = ทีมสดใหม่
            // → เปิดทางให้เล่น TC/BB ตามมาได้ง่ายขึ้นใน CHIP_POST_WC_WINDOW ถัดไป
            if (chip==="WC1"||chip==="WC2") simState.lastWC = gw;
          }
        }

        // Transfers (ถ้าไม่ใช่ WC/FH)
        if (!["WC1","WC2","FH"].includes(chip)) {
          const xferRes = _blindTransfer(simState, pool);
          simState.squad     = xferRes.squad;
          simState.itb       = xferRes.itb;
          gwFtUsed           = xferRes.ftUsed;
          gwHits             = xferRes.hits;
          simState.totalHits += xferRes.hits;
          gwXfers            = xferRes.log;
          simState.ft = Math.min(2, Math.max(0, ftBefore - gwFtUsed) + 1);
        }
      }

      // Assign XI + Captain
      _blindAssignXI(simState.squad, pool);

      // คาดการณ์แต้ม (xPts + ±20% noise)
      let gwXPts = 0, gwSimPts = 0;
      const xi = simState.squad.filter(p=>p.is_starting);
      const capPlayer = simState.squad.find(p=>p.is_captain);
      const capMulti  = (chip==="TC1"||chip==="TC2") ? 3 : 2;

      simState.squad.forEach(p => {
        const xp    = p.xpts || 0;
        const noise = 0.80 + Math.random() * 0.40; // ±20%
        const sim   = xp * noise;
        const isBB  = chip==="BB1"||chip==="BB2";
        if (p.is_starting || isBB) {
          gwXPts   += p.is_captain ? xp  * capMulti : xp;
          gwSimPts += p.is_captain ? sim * capMulti : sim;
        }
      });

      const hitCostGW = gwHits * CONFIG.HIT_COST;
      const netXPts   = Math.round(gwXPts  - hitCostGW);
      const netSimPts = Math.round(gwSimPts - hitCostGW);

      simState.totalPts += netSimPts;
      const cumHitsNow = simState.totalHits;

      simState.history.push({
        gw, pts:Math.round(gwSimPts), netPts:netSimPts,
        captain:capPlayer?.name||"?", cumHits:cumHitsNow, cumPts:simState.totalPts,
      });
      gwResults.push({ gw, pts:Math.round(gwSimPts), netPts:netSimPts,
                       xpts:Math.round(gwXPts), netXPts });

      // เก็บ detail (Base scenario เท่านั้น)
      if (isBase) {
        gwDetail.push({
          gw, chip: chip||"",
          ftBefore, ftUsed: gwFtUsed, hits: gwHits, ft_after: simState.ft,
          itb: simState.itb,
          transfers: gwXfers,
          xpts:     +gwXPts.toFixed(1),
          netXPts,
          captain:  capPlayer?.name||"?",
          capXpts:  +((capPlayer?.xpts||0) * capMulti).toFixed(1),
          xi: simState.squad.filter(p=>p.is_starting).map(p=>({
            name:p.name, pos:p.pos, price:p.price,
            xpts:+(p.xpts||0).toFixed(1),
            isCap:p.is_captain, isVice:p.is_vice,
          })),
          bench: simState.squad.filter(p=>!p.is_starting).map(p=>({
            name:p.name, pos:p.pos, price:p.price, xpts:+(p.xpts||0).toFixed(1),
          })),
        });
      }
    }

    seasonPts = simState.totalPts;
    const avgPerGW  = +(seasonPts/38).toFixed(1);
    const totalHits = simState.totalHits;
    const chipsUsed = Object.entries(simState.chips)
      .filter(([,v])=>!v).map(([k])=>k.toUpperCase()).join(", ")||"None";

    scenarioResults.push({
      scenario: scenario.name, label: scenario.label,
      totalPts: seasonPts, avgPerGW, totalHits,
      chipsUsed, gwResults,
      gwDetail: isBase ? gwDetail : [], // detail เฉพาะ Base
      hitRate: totalHits + "/38 GW",
      vsTarget: seasonPts - CONFIG.TARGET_PTS,
    });

    Logger.log(scenario.name + ": " + seasonPts + "pts | avg:" + avgPerGW + "/GW | hits:" + totalHits);
  });

  // ── เขียน PREDICT_2627 sheet ─────────────────────
  const sheet = getOrCreateSheet(ss, "BLIND_SIM_PREDICT_2627");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;

  // Header
  sheet.getRange(row,1,1,5).merge()
       .setValue("APEX PREDICT — FPL 26/27 SEASON PROJECTION")
       .setBackground("#050810").setFontColor("#b44eff").setFontWeight("bold").setFontSize(14);
  sheet.setRowHeight(row, 36); row += 2;

  // Context
  sheet.getRange(row,1,1,5).merge()
       .setValue("ข้อมูล EPL 25/26 | Arsenal แชมป์ 85pts | relegated: West Ham, Burnley, Wolves | promoted: Coventry, Ipswich, Hull City | fixtures 26/27: ประกาศ 19 มิ.ย. 2026")
       .setBackground("#0c1225").setFontColor("#7a8fba").setFontSize(10).setWrap(true);
  row += 2;

  // Scenario summary
  sheet.getRange(row,1,1,7).setValues([["SCENARIO","TOTAL PTS","AVG/GW","TOTAL HITS","CHIPS USED","VS TARGET (2500)","VERDICT"]])
       .setBackground("#0f1830").setFontColor("#b44eff").setFontWeight("bold");
  row++;

  scenarioResults.forEach(s => {
    const vs     = s.vsTarget;
    const bg     = vs >= 0 ? "#003300" : vs >= -200 ? "#1a1500" : "#1a0000";
    const fc     = vs >= 0 ? "#00ff9d" : vs >= -200 ? "#ffd60a" : "#ff2d55";
    const verdict = vs >= 200 ? "EXCELLENT" : vs >= 0 ? "ON TARGET" :
                    vs >= -100 ? "CLOSE"     : vs >= -200 ? "BELOW"   : "MISS";
    sheet.getRange(row,1,1,7).setValues([[
      s.scenario + " " + s.label,
      s.totalPts, s.avgPerGW, s.hitRate, s.chipsUsed,
      (vs>=0?"+":"")+vs+"pts", verdict,
    ]]).setBackground(bg).setFontColor(fc);
    row++;
  });
  row++;

  // GW-by-GW comparison (all 3 scenarios)
  sheet.getRange(row,1,1,7).setValues([["GW",
    "PESSIMISTIC","","BASE","","OPTIMISTIC",""]])
       .setBackground("#0f1830").setFontColor("#7a8fba").setFontWeight("bold");
  sheet.getRange(row,2).setValue("GW PTS").setFontColor("#ff6b6b");
  sheet.getRange(row,3).setValue("CUMUL").setFontColor("#ff6b6b");
  sheet.getRange(row,4).setValue("GW PTS").setFontColor("#ffd60a");
  sheet.getRange(row,5).setValue("CUMUL").setFontColor("#ffd60a");
  sheet.getRange(row,6).setValue("GW PTS").setFontColor("#00ff9d");
  sheet.getRange(row,7).setValue("CUMUL").setFontColor("#00ff9d");
  row++;

  let cum = [0,0,0];
  for (let gw = 0; gw < 38; gw++) {
    const vals = [gw+1];
    scenarioResults.forEach((s,i) => {
      const r = s.gwResults[gw];
      cum[i] += r?.netPts||0;
      vals.push(r?.netPts||0, cum[i]);
    });
    sheet.getRange(row,1,1,7).setValues([vals])
         .setBackground(gw%2===0?"#0c1225":"#080d1a").setFontColor("#c5d4f0");
    // color pace marker (avg 65.8pts/GW = 2500)
    const paceRow = Math.round((gw+1) * (2500/38));
    [3,5,7].forEach((c,i) => {
      if (cum[i] >= paceRow) sheet.getRange(row,c).setFontColor("#00ff9d");
    });
    row++;
  }
  row++;

  // ── เขียน GW Detail Sheet (Base scenario) ──────
  const baseDetail = scenarioResults.find(s=>s.scenario==="Base")?.gwDetail||[];
  if (baseDetail.length > 0) {
    const detSh = getOrCreateSheet(ss, "PREDICT_2627_GW_DETAIL");
    detSh.clearContents(); detSh.clearFormats();
    let drow = 1;

    detSh.getRange(drow,1,1,10).merge()
         .setValue("APEX PREDICT 26/27 — GW Detail (Base Scenario)")
         .setBackground("#050810").setFontColor("#b44eff").setFontWeight("bold").setFontSize(13);
    detSh.setRowHeight(drow, 32); drow++;

    // Header
    detSh.getRange(drow,1,1,10).setValues([[
      "GW","CHIP","FT_BEFORE","FT_USED","HITS","FT_AFTER","ITB",
      "xPTS (expected)","NET_xPTS","CAPTAIN (xPts)"
    ]]).setBackground("#0f1830").setFontColor("#b44eff").setFontWeight("bold");
    drow++;

    baseDetail.forEach(g => {
      const bg = g.hits>0?"#1a0000":g.chip?"#1a1500":
                 g.xpts>=65?"#003300":g.xpts>=50?"#001a00":"#0c1225";
      const fc = g.hits>0?"#ff2d55":g.chip?"#ffd60a":"#c5d4f0";
      detSh.getRange(drow,1,1,10).setValues([[
        "GW"+g.gw, g.chip||"-", g.ftBefore, g.ftUsed, g.hits,
        g.ft_after, "£"+g.itb.toFixed(1)+"m",
        g.xpts, g.netXPts,
        g.captain + " ("+g.capXpts+"xPts" + ((g.chip==="TC1"||g.chip==="TC2")?" ×3":"×2")+")",
      ]]).setBackground(bg).setFontColor(fc);
      if (g.chip) detSh.getRange(drow,2).setFontWeight("bold").setFontColor("#ffd60a");
      drow++;

      // Squad row
      const xiStr  = g.xi.map(p=>(p.isCap?"[C]":p.isVice?"[V]":"")+p.name+"("+p.pos+","+p.xpts+")").join(" | ");
      const bnStr  = g.bench.map(p=>p.name+"("+p.pos+","+p.xpts+")").join(" | ");
      const xferStr = (g.transfers||[]).join(" | ")||"No change";

      // XI row
      detSh.getRange(drow,1,1,10).merge()
           .setValue("  XI: " + xiStr)
           .setBackground("#001a00").setFontColor("#00ff9d").setFontSize(9).setWrap(false);
      drow++;

      // Bench row
      detSh.getRange(drow,1,1,10).merge()
           .setValue("  BN: " + bnStr)
           .setBackground("#0a0a0a").setFontColor("#7a8fba").setFontSize(9).setWrap(false);
      drow++;

      // Transfer row
      if (xferStr !== "No change") {
        detSh.getRange(drow,1,1,10).merge()
             .setValue("  XFER: " + xferStr)
             .setBackground(g.hits>0?"#1a0000":"#001a1a")
             .setFontColor(g.hits>0?"#ff2d55":"#00f5ff").setFontSize(9).setWrap(false);
        drow++;
      }
    });

    detSh.setFrozenRows(2);
    detSh.setColumnWidth(1, 50);
    detSh.setColumnWidth(2, 60);
    [3,4,5,6].forEach(c => detSh.setColumnWidth(c, 55));
    detSh.setColumnWidth(7, 70);
    detSh.setColumnWidth(8, 80);
    detSh.setColumnWidth(9, 80);
    detSh.setColumnWidth(10, 200);

    // ── เพิ่ม Pivot: Top Captains ──────────────────
    const capCount = {};
    baseDetail.forEach(g => {
      capCount[g.captain] = (capCount[g.captain]||0)+1;
    });

    drow++;
    detSh.getRange(drow,1,1,4).setValues([["TOP CAPTAINS","COUNT","% TIMES","AVG xPTS (cap)"]])
         .setBackground("#1a1500").setFontColor("#ffd60a").setFontWeight("bold");
    drow++;
    Object.entries(capCount).sort((a,b)=>b[1]-a[1]).forEach(([name, count]) => {
      const capGWs = baseDetail.filter(g=>g.captain===name);
      const avgCapXpts = capGWs.length
        ? +(capGWs.reduce((s,g)=>s+g.capXpts,0)/capGWs.length).toFixed(1) : 0;
      detSh.getRange(drow,1,1,4).setValues([[
        name, count, (count/38*100).toFixed(0)+"%", avgCapXpts,
      ]]).setBackground("#0f1000").setFontColor("#c5d4f0");
      drow++;
    });

    Logger.log("✓ GW Detail sheet: " + baseDetail.length + " GWs");
  }

  // Key assumptions
  sheet.getRange(row,1,1,5).merge()
       .setValue("ASSUMPTIONS & LIMITATIONS")
       .setBackground("#0a0a1a").setFontColor("#b44eff").setFontWeight("bold");
  row++;
  const assumptions = [
    ["✓ Baseline", "สถิติผู้เล่นจาก 25/26 ทั้งซีซัน (150 คน)"],
    ["✓ Team strength", "FDR estimate จาก EPL 25/26 final standings"],
    ["✓ Noise", "±20% variance per GW (จำลองความไม่แน่นอน)"],
    ["✓ Chips", "TC×2, BB×2, WC×2, FH×1 — trigger ตาม APEX logic"],
    ["⚠ Fixtures", "ไม่รู้ fixture จริง 26/27 (ประกาศ 19 มิ.ย. 2026) — ใช้ avg FDR แทน"],
    ["⚠ Transfers", "Summer transfer window 15 มิ.ย. - 31 ส.ค. 2026 ยังไม่เกิดขึ้น"],
    ["⚠ Prices", "ราคานักเตะ 26/27 ยังไม่ประกาศ — ใช้ราคาสุดท้าย 25/26"],
    ["⚠ Promoted", "COV/IPS/HUL: ผู้เล่นไม่มีประวัติ PL → xPts ต่ำกว่าจริง"],
  ];
  assumptions.forEach(a => {
    sheet.getRange(row,1).setValue(a[0]).setFontColor("#ffd60a").setFontWeight("bold").setBackground("#0c1225");
    sheet.getRange(row,2,1,4).merge().setValue(a[1]).setFontColor("#c5d4f0").setBackground("#0c1225");
    row++;
  });
  row++;

  // AI Analysis
  ss.toast("AI กำลังวิเคราะห์...", "APEX PREDICT", 30);
  const baseResult     = scenarioResults[1]; // base scenario
  const pessResult     = scenarioResults[0];
  const optResult      = scenarioResults[2];

  const aiPrompt = `คุณคือ APEX QUANT — วิเคราะห์การคาดการณ์คะแนน FPL ซีซัน 26/27

ข้อมูล EPL 25/26:
- Arsenal แชมป์ 85pts | Man City 78 | Man Utd 71 | Aston Villa 65 | Liverpool 60
- Relegated: West Ham, Burnley, Wolves
- Promoted: Coventry City (Championship แชมป์), Ipswich Town (อันดับ 2), Hull City (ชนะ Playoff Final 23 พ.ค. 2026)
- Topscorer: Haaland 27 goals | Bruno Fernandes 21 assists (all-time PL record)

ผลจำลอง 26/27 (Monte Carlo 3 scenarios):
- Pessimistic: ${pessResult.totalPts}pts (avg ${pessResult.avgPerGW}/GW) | hits:${pessResult.hitRate} | vs target: ${pessResult.vsTarget}pts
- Base:         ${baseResult.totalPts}pts (avg ${baseResult.avgPerGW}/GW) | hits:${baseResult.hitRate} | vs target: ${baseResult.vsTarget}pts
- Optimistic:   ${optResult.totalPts}pts (avg ${optResult.avgPerGW}/GW) | hits:${optResult.hitRate} | vs target: ${optResult.vsTarget}pts

เป้าหมาย APEX PROTOCOL: 2500pts / Top 100

วิเคราะห์:
1. **PREDICTION RANGE** — range ${pessResult.totalPts}-${optResult.totalPts}pts บ่งบอกอะไร? น่าจะ rank ไหนในปีหน้า?
2. **KEY THREATS 26/27** — Arsenal ที่ dominance, World Cup break ไม่มี (ไม่มีผลกับ PL), promoted teams FDR ง่ายต้นซีซัน
3. **PREMIUM TARGETS** — จากผลการแข่งขัน 25/26: Haaland (27 goals), Saka/Salah/Bruno ควรซื้อตั้งแต่ต้นซีซัน?
4. **PROMOTED TEAMS** — COV/IPS/HUL ผู้เล่นคนไหนที่ FPL ควรพิจารณา? fixture ต้นซีซัน (vs ทีมใหม่ = FDR 1-2)
5. **APEX STRATEGY** — ปรับ strategy อะไรจาก 25/26 blind sim เพื่อให้ถึง 2500pts จริงๆ ใน 26/27?

ตอบภาษาไทย ละเอียด มีตัวเลขสนับสนุน`;

  const aiAnalysis = callGemini(aiPrompt);
  if (aiAnalysis) {
    sheet.getRange(row,1,1,5).merge()
         .setValue("AI ANALYSIS — 26/27 SEASON PREDICTION")
         .setBackground("#0a0a1a").setFontColor("#b44eff").setFontWeight("bold").setFontSize(11);
    row++;
    sheet.getRange(row,1,1,5).merge()
         .setValue(aiAnalysis)
         .setBackground("#08080f").setFontColor("#c5d4f0")
         .setFontFamily("Courier New").setFontSize(10).setWrap(true).setVerticalAlignment("top");
    sheet.setRowHeight(row, 500);
    row++;
  }

  sheet.setFrozenRows(1);
  [1,2,3,4,5,6,7].forEach(c => sheet.autoResizeColumns(c,1));

  logRun(ss, "Predict2627",
    "Base:"+baseResult.totalPts+"pts | Range:"+pessResult.totalPts+"-"+optResult.totalPts, "SUCCESS");
  ss.toast(
    "✅ Prediction เสร็จ! Base:"+baseResult.totalPts+"pts | "+
    pessResult.totalPts+"-"+optResult.totalPts+"pts range | ดูที่ BLIND_SIM_PREDICT_2627",
    "APEX PREDICT", 12
  );
  Logger.log("=== PREDICT 26/27 DONE | Base: " + baseResult.totalPts + "pts ===");
}

// ============================================================
// FULL PLAYER DATA 25/26
// ดึงข้อมูลนักเตะทุกคนที่เล่นใน EPL 25/26 พร้อมสถิติครบถ้วน
//
// Columns (ตาม FPL abbreviations):
//   NAME, TEAM, POS, PRICE
//   Pts  = Total Points
//   ST   = Starts
//   MP   = Minutes Played
//   GS   = Goals Scored
//   A    = Assists
//   xG   = Expected Goals
//   xA   = Expected Assists
//   xGI  = Expected Goal Involvements
//   CS   = Clean Sheets
//   GC   = Goals Conceded
//   xGC  = Expected Goals Conceded
//   OG   = Own Goals
//   PS   = Penalty Saves
//   PM   = Penalties Missed
//   YC   = Yellow Cards
//   RC   = Red Cards
//   S    = Saves
//   BP   = Bonus Points
//   BPS  = Bonus Points System score
//   I    = Influence (ICT)
//   C    = Creativity (ICT)
//   T    = Threat (ICT)
//   II   = ICT Index
//   CBI  = Clearances, Blocks & Interceptions
//   DC   = Dream Team Count (ครั้งที่ติด Dream Team)
//   TSB% = Total Selected By %
//   TI   = Total Transfers In (season)
//   TO   = Total Transfers Out (season)
//   NT   = Net Transfers (TI - TO)
//   PPM  = Points Per Million
// ============================================================

function runFullPlayerData2526() {
  Logger.log("=== FULL PLAYER DATA 25/26 START ===");
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const boot = fetchJSON("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!boot) { Logger.log("❌ API failed"); return; }

  // ── กัน baseline พัง: ฟังก์ชันนี้ดึง "ซีซันปัจจุบัน" จาก bootstrap
  // ถ้าซีซันปัจจุบันไม่ใช่ PREV_SEASON (เช่นตอนนี้ = 26/27) การรันจะเขียนทับ
  // FULL_PLAYER_DATA_2526 ด้วยข้อมูล 26/27 ที่ยังไม่จบ → baseline GW1-5 พัง
  // จึง SKIP เพื่อรักษาข้อมูล 25/26 เดิมไว้ (ต้องเก็บ baseline ตั้งแต่ปลายซีซัน 25/26)
  const _seasonNow = currentSeasonLabel(boot);
  if (_seasonNow !== CONFIG.PREV_SEASON) {
    const _ex = ss.getSheetByName("FULL_PLAYER_DATA_2526");
    if (_ex && _ex.getLastRow() > 1) {
      Logger.log("⚠ ซีซันตอนนี้ "+_seasonNow+" ≠ baseline "+CONFIG.PREV_SEASON+
        " — SKIP รักษา FULL_PLAYER_DATA_2526 (25/26) ไว้เป็น baseline");
      ss.toast("⚠ SKIP: รักษา baseline 25/26 (ซีซันตอนนี้ "+_seasonNow+")", "FULL DATA", 8);
      return;
    }
    Logger.log("⚠ ไม่มี baseline 25/26 + bootstrap เป็น "+_seasonNow+" แล้ว — " +
      "ข้อมูลที่ได้จะเป็นซีซันปัจจุบัน ไม่ใช่ 25/26 (ควรดึงจาก history_past แทน)");
  }

  ss.toast("ดึงข้อมูลผู้เล่นทุกคน ("+_seasonNow+")...", "FULL DATA", 30);

  const teamMap = {};
  boot.teams.forEach(t => teamMap[t.id] = t.short_name);
  const posMap  = { 1:"GK", 2:"DEF", 3:"MID", 4:"FWD" };

  // กรองเฉพาะนักเตะที่เล่นจริง (minutes > 0)
  const players = boot.elements.filter(p => p.minutes > 0);
  Logger.log("Players with minutes: " + players.length);

  const HEADERS = [
    "NAME","TEAM","POS","PRICE",
    "Pts","ST","MP","GS","A",
    "xG","xA","xGI",
    "CS","GC","xGC",
    "OG","PS","PM","YC","RC","S",
    "BP","BPS",
    "I","C","T","II",
    "CBI","DC",
    "TSB%","TI","TO","NT","PPM",
  ];

  const rows = players.map(p => {
    const price = +(p.now_cost / 10).toFixed(1);
    const pts   = p.total_points || 0;
    const ppm   = price > 0 ? +(pts / price).toFixed(2) : 0;
    const ti    = p.transfers_in  || 0;
    const to    = p.transfers_out || 0;

    return [
      p.web_name,
      teamMap[p.team] || "?",
      posMap[p.element_type] || "?",
      price,
      // Performance
      pts,
      p.starts                 || 0,
      p.minutes                || 0,
      p.goals_scored           || 0,
      p.assists                || 0,
      // Expected stats
      +(parseFloat(p.expected_goals                 ||0)).toFixed(2),
      +(parseFloat(p.expected_assists               ||0)).toFixed(2),
      +(parseFloat(p.expected_goal_involvements     ||0)).toFixed(2),
      // Defensive / Conceded
      p.clean_sheets           || 0,
      p.goals_conceded         || 0,
      +(parseFloat(p.expected_goals_conceded        ||0)).toFixed(2),
      // Cards & Saves
      p.own_goals              || 0,
      p.penalties_saved        || 0,
      p.penalties_missed       || 0,
      p.yellow_cards           || 0,
      p.red_cards              || 0,
      p.saves                  || 0,
      // Bonus
      p.bonus                  || 0,
      p.bps                    || 0,
      // ICT Index
      +(parseFloat(p.influence   ||0)).toFixed(1),
      +(parseFloat(p.creativity  ||0)).toFixed(1),
      +(parseFloat(p.threat      ||0)).toFixed(1),
      +(parseFloat(p.ict_index   ||0)).toFixed(1),
      // Additional
      p.clearances_blocks_interceptions || 0,
      p.dreamteam_count                 || 0,
      // Ownership & Transfers
      +(parseFloat(p.selected_by_percent||0)).toFixed(1),
      ti, to, ti - to,
      ppm,
    ];
  });

  // เรียงตาม Pts มากสุด
  rows.sort((a, b) => b[4] - a[4]);

  // เขียน sheet
  const sheet = getOrCreateSheet(ss, "FULL_PLAYER_DATA_2526");
  sheet.clearContents(); sheet.clearFormats();

  // Header row
  const hdrRange = sheet.getRange(1, 1, 1, HEADERS.length);
  hdrRange.setValues([HEADERS])
          .setBackground("#1c2a50").setFontColor("#00f5ff")
          .setFontWeight("bold").setFontSize(10);

  // Color-code header groups
  const groups = [
    { cols:[1,4],   bg:"#1c2a50", fc:"#00f5ff" }, // ID
    { cols:[5,9],   bg:"#0f2a0f", fc:"#00ff9d" }, // Performance
    { cols:[10,12], bg:"#0f1f2a", fc:"#00d4ff" }, // Expected
    { cols:[13,15], bg:"#1a1000", fc:"#ffd60a" }, // Defensive
    { cols:[16,21], bg:"#2a0f0f", fc:"#ff6b6b" }, // Cards/Saves
    { cols:[22,23], bg:"#1a1500", fc:"#ffd60a" }, // Bonus
    { cols:[24,27], bg:"#1a001a", fc:"#b44eff" }, // ICT
    { cols:[28,29], bg:"#001a1a", fc:"#00f5ff" }, // Additional
    { cols:[30,34], bg:"#0a0a1a", fc:"#7a8fba" }, // Ownership
  ];
  groups.forEach(g => {
    for (let c = g.cols[0]; c <= g.cols[1]; c++) {
      sheet.getRange(1, c).setBackground(g.bg).setFontColor(g.fc);
    }
  });

  // Data
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }

  // Color POS column
  const posCol = HEADERS.indexOf("POS") + 1;
  const posColors = { GK:"#001a1a", DEF:"#001a00", MID:"#1a1500", FWD:"#1a0a00" };
  const posFontColors = { GK:"#00f5ff", DEF:"#00ff9d", MID:"#ffd60a", FWD:"#ff6a00" };
  rows.forEach((r, i) => {
    const pos  = r[2];
    const row  = i + 2;
    const bg   = posColors[pos]   || "#0c1225";
    const fc   = posFontColors[pos] || "#c5d4f0";
    sheet.getRange(row, posCol).setBackground(bg).setFontColor(fc).setFontWeight("bold");
  });

  // Freeze + Autosize
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3); // freeze NAME, TEAM, POS
  sheet.autoResizeColumns(1, HEADERS.length);

  // ── เพิ่ม Summary Stats ──────────────────────────
  const sumSheet = getOrCreateSheet(ss, "FULL_DATA_SUMMARY");
  sumSheet.clearContents(); sumSheet.clearFormats();
  let sr = 1;

  sumSheet.getRange(sr,1,1,4).merge()
          .setValue("FULL PLAYER DATA 25/26 — SUMMARY STATS")
          .setBackground("#050810").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(13);
  sumSheet.setRowHeight(sr, 32); sr += 2;

  // Overall stats
  const totalPlayers = rows.length;
  const avgPts   = +(rows.reduce((s,r)=>s+r[4],0)/totalPlayers).toFixed(1);
  const maxPts   = Math.max(...rows.map(r=>r[4]));
  const topScorer = rows.reduce((a,b)=>b[4]>a[4]?b:a, rows[0]);

  [
    ["Total players (with minutes)", totalPlayers, "Avg Pts/Player", avgPts],
    ["Highest Pts",                  maxPts,       "Top Scorer",    topScorer[0]+"("+topScorer[2]+",£"+topScorer[3]+"m)"],
  ].forEach(r => {
    [0,1,2,3].forEach(ci => {
      sumSheet.getRange(sr,ci+1).setValue(r[ci])
              .setFontColor(ci%2===0?"#7a8fba":"#ffffff")
              .setFontWeight(ci%2===0?"bold":"normal").setBackground("#0c1225");
    });
    sr++;
  });
  sr++;

  // Top 10 per position
  ["GK","DEF","MID","FWD"].forEach(pos => {
    const posColor  = { GK:"#001a1a",DEF:"#001a00",MID:"#1a1500",FWD:"#1a0a00" }[pos];
    const fontColor = { GK:"#00f5ff",DEF:"#00ff9d",MID:"#ffd60a",FWD:"#ff6a00" }[pos];
    const group     = rows.filter(r=>r[2]===pos).slice(0,10);

    sumSheet.getRange(sr,1,1,7).setValues([["TOP 10 "+pos,"","","","","",""]])
            .setBackground(posColor).setFontColor(fontColor).setFontWeight("bold");
    sr++;

    const topH = ["NAME","TEAM","PRICE","Pts","xGI","xGC","PPM"];
    sumSheet.getRange(sr,1,1,topH.length).setValues([topH])
            .setBackground(posColor).setFontColor(fontColor).setFontWeight("bold");
    sr++;

    group.forEach((r,i) => {
      sumSheet.getRange(sr,1,1,7).setValues([[
        r[0], r[1], "£"+r[3]+"m", r[4], r[11], r[14], r[33],
      ]]).setBackground(i%2===0?posColor:"#0c1225").setFontColor("#c5d4f0");
      if (i===0) sumSheet.getRange(sr,1,1,7).setFontColor(fontColor).setFontWeight("bold");
      sr++;
    });
    sr++;
  });

  // Top Value (PPM)
  sumSheet.getRange(sr,1,1,7).setValues([["TOP PPM (Value Picks)","","","","","",""]])
          .setBackground("#001a1a").setFontColor("#00f5ff").setFontWeight("bold");
  sr++;
  rows.slice().sort((a,b)=>b[33]-a[33]).slice(0,10).forEach((r,i)=>{
    sumSheet.getRange(sr,1,1,7).setValues([[
      r[0],r[1],r[2],"£"+r[3]+"m",r[4],"PPM:"+r[33],"",
    ]]).setBackground(i%2===0?"#001a1a":"#0c1225").setFontColor("#c5d4f0");
    sr++;
  });

  sumSheet.autoResizeColumns(1,7);

  logRun(ss, "FullPlayerData2526", players.length+" players | "+HEADERS.length+" columns", "SUCCESS");
  ss.toast("✅ "+players.length+" players | "+HEADERS.length+" stats | FULL_PLAYER_DATA_2526", "FULL DATA", 10);
  Logger.log("=== FULL PLAYER DATA DONE | " + players.length + " players ===");
}

// ============================================================
// PROMOTED TEAMS 26/27 — ข้อมูลจริงจาก Championship 25/26
// + จัดทีม FPL 26/27 เริ่มต้น ตาม position scoring ล่าสุด
// ============================================================

// ── ข้อมูลผู้เล่นจริง (Championship 25/26 stats) ────────────
const PROMOTED_PLAYERS_DATA = {
  COV: {
    teamName: "Coventry City", finish: "Champions", pts: 94,
    xGA_per_game: 1.14, // team xGC per game (from ScoutingStats)
    players: [
      // GK
      { name:"Rushworth",  pos:"GK",  apps:44, goals:0, assists:0, mp:3960,
        xG:0,   xA:0,  xGI:0, cs:16, gc:42, saves:145, bps:210, cbi:8,
        price_est:5.0, note:"#1 GK — 44 apps, key to promotion" },
      // DEF
      { name:"B.Thomas",   pos:"DEF", apps:38, goals:5, assists:2, mp:3335,
        xG:2.1, xA:1.5, xGI:3.6, cs:14, gc:0, saves:0, bps:180, cbi:95,
        price_est:5.5, note:"CB, 5 goals from set pieces" },
      { name:"van Ewijk",  pos:"DEF", apps:42, goals:3, assists:8, mp:3674,
        xG:1.8, xA:5.2, xGI:7.0, cs:12, gc:0, saves:0, bps:190, cbi:70,
        price_est:6.0, note:"RB, top assist with 8 — attacking wingback" },
      { name:"Dasilva",    pos:"DEF", apps:36, goals:1, assists:3, mp:3100,
        xG:0.8, xA:2.2, xGI:3.0, cs:11, gc:0, saves:0, bps:155, cbi:80,
        price_est:5.0, note:"LB regular" },
      { name:"Dovin",      pos:"GK",  apps:0,  goals:0, assists:0, mp:0,
        xG:0,  xA:0,  xGI:0,  cs:0,  gc:0, saves:0, bps:0, cbi:0,
        price_est:4.0, note:"Backup GK — sold before PL" },
      // MID
      { name:"Rudoni",     pos:"MID", apps:40, goals:6, assists:7, mp:3400,
        xG:4.2, xA:4.8, xGI:9.0, cs:0, gc:0, saves:0, bps:200, cbi:45,
        price_est:6.5, note:"2nd most assists (7), creative MID, corner taker" },
      { name:"Torp",       pos:"MID", apps:38, goals:5, assists:6, mp:3200,
        xG:3.5, xA:4.0, xGI:7.5, cs:0, gc:0, saves:0, bps:185, cbi:50,
        price_est:6.0, note:"Effective in tight areas, 6 assists" },
      { name:"Grimes",     pos:"MID", apps:44, goals:2, assists:4, mp:3948,
        xG:1.5, xA:3.0, xGI:4.5, cs:0, gc:0, saves:0, bps:220, cbi:120,
        price_est:5.5, note:"CDM/Holding MID — most apps (44), high CBI" },
      { name:"M.Clarke",   pos:"MID", apps:30, goals:3, assists:2, mp:2400,
        xG:2.0, xA:1.5, xGI:3.5, cs:0, gc:0, saves:0, bps:140, cbi:35,
        price_est:5.0, note:"Wide MID" },
      // FWD
      { name:"H.Wright",   pos:"FWD", apps:38, goals:17, assists:4, mp:3100,
        xG:12.5, xA:3.0, xGI:15.5, cs:0, gc:0, saves:0, bps:220, cbi:10,
        price_est:7.0, note:"Top scorer — USMNT striker, pen taker" },
      { name:"Thomas-Asante", pos:"FWD", apps:40, goals:12, assists:3, mp:3200,
        xG:9.8, xA:2.5, xGI:12.3, cs:0, gc:0, saves:0, bps:190, cbi:8,
        price_est:6.5, note:"12 goals, consistent starter" },
      { name:"E.Simms",    pos:"FWD", apps:25, goals:10, assists:1, mp:1800,
        xG:7.5, xA:0.8, xGI:8.3, cs:0, gc:0, saves:0, bps:130, cbi:5,
        price_est:5.5, note:"Super sub / rotation FWD" },
    ]
  },
  IPS: {
    teamName: "Ipswich Town", finish: "Runners-up", pts: 87,
    xGA_per_game: 1.05,
    players: [
      // GK
      { name:"O'Shea CB",  pos:"DEF", apps:45, goals:1, assists:0, mp:4050,
        xG:0.5, xA:0.3, xGI:0.8, cs:16, gc:0, saves:0, bps:195, cbi:110,
        price_est:5.5, note:"CB, most apps (45), solid defender" },
      { name:"Walton",     pos:"GK",  apps:40, goals:0, assists:0, mp:3600,
        xG:0,   xA:0,  xGI:0, cs:15, gc:44, saves:128, bps:185, cbi:5,
        price_est:5.0, note:"#1 GK — 15 CS from 40 apps" },
      // DEF
      { name:"L.Davis",    pos:"DEF", apps:40, goals:1, assists:4, mp:3500,
        xG:0.8, xA:2.8, xGI:3.6, cs:14, gc:0, saves:0, bps:170, cbi:75,
        price_est:5.5, note:"LB, 4 assists — attacking fullback" },
      { name:"Furlong",    pos:"DEF", apps:42, goals:0, assists:2, mp:3600,
        xG:0.5, xA:1.5, xGI:2.0, cs:13, gc:0, saves:0, bps:155, cbi:85,
        price_est:5.0, note:"RB — 12 yellow cards, physical" },
      { name:"Kipre",      pos:"DEF", apps:35, goals:4, assists:1, mp:3000,
        xG:2.5, xA:0.8, xGI:3.3, cs:12, gc:0, saves:0, bps:165, cbi:90,
        price_est:5.0, note:"CB, 4 goals" },
      // MID
      { name:"Mehmeti",    pos:"MID", apps:45, goals:10, assists:7, mp:3800,
        xG:7.0, xA:5.5, xGI:12.5, cs:0, gc:0, saves:0, bps:235, cbi:40,
        price_est:7.0, note:"Key creator — 10G+7A, most apps (45)" },
      { name:"M.Nunez",    pos:"MID", apps:40, goals:6, assists:8, mp:3400,
        xG:4.5, xA:6.0, xGI:10.5, cs:0, gc:0, saves:0, bps:215, cbi:55,
        price_est:6.5, note:"Top assists (8), creative MID" },
      { name:"Broadhead",  pos:"MID", apps:38, goals:7, assists:3, mp:3100,
        xG:5.0, xA:2.5, xGI:7.5, cs:0, gc:0, saves:0, bps:185, cbi:30,
        price_est:6.0, note:"7 goals from MID" },
      { name:"Cajuste",    pos:"MID", apps:36, goals:1, assists:2, mp:3000,
        xG:0.8, xA:1.5, xGI:2.3, cs:0, gc:0, saves:0, bps:160, cbi:130,
        price_est:5.0, note:"CDM — ex-Spurs, high CBI, defensive anchor" },
      // FWD
      { name:"M.Clarke FWD",pos:"FWD",apps:45,goals:16,assists:3,mp:3800,
        xG:12.0, xA:2.5, xGI:14.5, cs:0, gc:0, saves:0, bps:240, cbi:10,
        price_est:7.5, note:"TOP SCORER 16 goals — key asset" },
      { name:"Philogene",  pos:"FWD", apps:40, goals:11, assists:4, mp:3200,
        xG:8.5, xA:3.0, xGI:11.5, cs:0, gc:0, saves:0, bps:200, cbi:15,
        price_est:6.5, note:"11 goals, fast winger" },
      { name:"G.Hirst",    pos:"FWD", apps:38, goals:10, assists:2, mp:2800,
        xG:7.8, xA:1.5, xGI:9.3, cs:0, gc:0, saves:0, bps:175, cbi:8,
        price_est:6.0, note:"10 goals — physical striker" },
    ]
  },
  HUL: {
    teamName: "Hull City", finish: "Playoff Winners (6th)", pts: 74,
    xGA_per_game: 1.42,
    players: [
      // GK
      { name:"Pandur",     pos:"GK",  apps:47, goals:0, assists:0, mp:4230,
        xG:0,  xA:0,  xGI:0, cs:11, gc:58, saves:135, bps:175, cbi:5,
        price_est:4.5, note:"#1 GK — most apps (47), but high GC (58)" },
      // DEF
      { name:"C.Hughes",   pos:"DEF", apps:34, goals:0, assists:1, mp:2925,
        xG:0.5, xA:0.8, xGI:1.3, cs:9, gc:0, saves:0, bps:140, cbi:95,
        price_est:4.5, note:"CB — solid but Hull concede a lot" },
      { name:"J.Egan",     pos:"DEF", apps:48, goals:3, assists:1, mp:4200,
        xG:2.0, xA:0.8, xGI:2.8, cs:10, gc:0, saves:0, bps:155, cbi:105,
        price_est:5.0, note:"CB, most apps — set piece threat" },
      { name:"R.Giles",    pos:"DEF", apps:34, goals:0, assists:8, mp:2800,
        xG:0.5, xA:5.9, xGI:6.4, cs:8, gc:0, saves:0, bps:170, cbi:60,
        price_est:5.5, note:"LWB — top assist (8), big chances created (11)" },
      { name:"L.Coyle",    pos:"DEF", apps:45, goals:0, assists:4, mp:3900,
        xG:0.4, xA:2.6, xGI:3.0, cs:9, gc:0, saves:0, bps:160, cbi:75,
        price_est:5.0, note:"RB — attacking fullback, 4 assists" },
      // MID
      { name:"Belloumi",   pos:"MID", apps:25, goals:3, assists:4, mp:1900,
        xG:2.5, xA:3.0, xGI:5.5, cs:0, gc:0, saves:0, bps:135, cbi:35,
        price_est:5.5, note:"Playoff hero — scored in semi, creative" },
      { name:"Slater",     pos:"MID", apps:44, goals:2, assists:2, mp:2816,
        xG:1.5, xA:1.5, xGI:3.0, cs:0, gc:0, saves:0, bps:150, cbi:90,
        price_est:5.0, note:"Box-to-box MID — reliable starter" },
      { name:"L.Millar",   pos:"MID", apps:36, goals:3, assists:5, mp:2800,
        xG:2.2, xA:3.5, xGI:5.7, cs:0, gc:0, saves:0, bps:160, cbi:40,
        price_est:5.5, note:"Wide MID, 5 assists" },
      { name:"Hadziahmetovic",pos:"MID",apps:39,goals:0,assists:2,mp:3100,
        xG:0.5, xA:1.5, xGI:2.0, cs:0, gc:0, saves:0, bps:145, cbi:140,
        price_est:4.5, note:"CDM — highest CBI in team, defensive anchor" },
      { name:"M.Crooks",   pos:"MID", apps:35, goals:4, assists:5, mp:2800,
        xG:3.0, xA:3.5, xGI:6.5, cs:0, gc:0, saves:0, bps:175, cbi:65,
        price_est:5.5, note:"Dynamic MID — 4G+5A, playoff final scorer" },
      // FWD
      { name:"McBurnie",   pos:"FWD", apps:40, goals:17, assists:7, mp:3300,
        xG:7.9, xA:5.0, xGI:12.9, cs:0, gc:0, saves:0, bps:220, cbi:15,
        price_est:7.0, note:"PLAYOFF HERO — 17G+7A = 24 G+A, key target" },
      { name:"Gelhardt",   pos:"FWD", apps:41, goals:15, assists:4, mp:3200,
        xG:9.5, xA:3.7, xGI:13.2, cs:0, gc:0, saves:0, bps:200, cbi:12,
        price_est:6.5, note:"15 goals, highest xG in team" },
      { name:"K.Joseph",   pos:"FWD", apps:46, goals:8, assists:5, mp:3600,
        xG:9.4, xA:3.2, xGI:12.6, cs:0, gc:0, saves:0, bps:180, cbi:20,
        price_est:6.0, note:"Rotation FWD — high xG (9.4) vs only 8 goals" },
    ]
  }
};

function runPromotedTeamsData2627() {
  Logger.log("=== PROMOTED TEAMS DATA 26/27 ===");
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ss.toast("สร้าง promoted teams sheet...", "APEX", 10);

  const sheet = getOrCreateSheet(ss, "PROMOTED_2627_DATA");
  sheet.clearContents(); sheet.clearFormats();
  let row = 1;

  // Header
  sheet.getRange(row,1,1,6).merge()
       .setValue("PROMOTED TEAMS 26/27 — Championship 25/26 Stats (Real Data)")
       .setBackground("#050810").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(13);
  sheet.setRowHeight(row,32); row++;

  const COLS = ["PLAYER","TEAM","POS","APPS","MP","GOALS","ASSISTS",
                "xG","xA","xGI","CS","GC","SAVES","BPS","CBI","PRICE_EST","NOTE"];
  const teamColors = {
    COV: { bg:"#001f4e", fc:"#6cb4e4", hbg:"#002f6e", label:"Coventry City — Championship Champions" },
    IPS: { bg:"#001a3d", fc:"#4db8ff", hbg:"#002a5e", label:"Ipswich Town — Runners-up" },
    HUL: { bg:"#1a0d00", fc:"#ff9f40", hbg:"#2a1500", label:"Hull City — Playoff Winners (6th)" },
  };

  Object.entries(PROMOTED_PLAYERS_DATA).forEach(([teamCode, teamData]) => {
    const c = teamColors[teamCode];

    // Team header
    row++;
    sheet.getRange(row,1,1,COLS.length).merge()
         .setValue(c.label + " | xGA/game: "+teamData.xGA_per_game+" | Pts: "+teamData.pts)
         .setBackground(c.hbg).setFontColor(c.fc).setFontWeight("bold").setFontSize(11);
    sheet.setRowHeight(row,26); row++;

    // Column headers
    sheet.getRange(row,1,1,COLS.length).setValues([COLS])
         .setBackground(c.hbg).setFontColor(c.fc).setFontWeight("bold").setFontSize(10);
    row++;

    // Player rows
    teamData.players.forEach((p, i) => {
      const ppm    = p.price_est > 0 ? +((p.goals*6+p.assists*3) / p.price_est).toFixed(2) : 0;
      const values = [
        p.name, teamCode, p.pos, p.apps, p.mp, p.goals, p.assists,
        p.xG.toFixed(1), p.xA.toFixed(1), p.xGI.toFixed(1),
        p.cs, p.gc, p.saves, p.bps, p.cbi,
        "£"+p.price_est+"m", p.note,
      ];
      const isGK   = p.pos==="GK";
      const isDef  = p.pos==="DEF";
      const isTopScorer = p.goals >= 10;
      const rowBg  = isTopScorer ? "#003300" : i%2===0 ? c.bg : "#080d1a";
      const rowFc  = isTopScorer ? "#00ff9d" : c.fc;
      sheet.getRange(row,1,1,COLS.length).setValues([values])
           .setBackground(rowBg).setFontColor(rowFc).setFontSize(10);
      if (isTopScorer) sheet.getRange(row,1,1,COLS.length).setFontWeight("bold");
      row++;
    });
  });
  row++;

  // ── FPL NOTES section ────────────────────────────────
  const notes = [
    ["⚠️","ราคา (PRICE_EST) เป็นการประมาณการ — FPL 26/27 จะประกาศ ก.ค. 2026"],
    ["⚠️","สถิติจาก Championship — โดยทั่วไป PL ยากกว่า 30-40% → ปรับ expected pts ลง"],
    ["⚠️","ทีม Hull City มี xGA สูงสุด (1.42/game) → DEF/GK ของ Hull CS น้อยกว่า COV/IPS"],
    ["💡","van Ewijk (COV DEF) — 8 assists + attacking role → worth monitoring"],
    ["💡","M.Clarke (IPS FWD) — 16 goals = top scorer in Championship → FPL value pick"],
    ["💡","McBurnie (HUL FWD) — 17G+7A + playoff hero → sentiment value สูง แต่ราคาจะแพง"],
    ["💡","R.Giles (HUL DEF) — LWB ที่ทำ 8 assists + 11 big chances created → ถ้าราคาต่ำคือ gem"],
    ["💡","Grimes (COV MID) + Hadziahmetovic (HUL MID) + Cajuste (IPS MID) → CDM candidates"],
  ];
  sheet.getRange(row,1,1,COLS.length).merge()
       .setValue("FPL ANALYST NOTES").setBackground("#0a0a1a").setFontColor("#b44eff").setFontWeight("bold");
  row++;
  notes.forEach(([icon, note]) => {
    sheet.getRange(row,1).setValue(icon).setBackground("#0c1225").setFontColor("#ffd60a");
    sheet.getRange(row,2,1,COLS.length-1).merge().setValue(note)
         .setBackground("#0c1225").setFontColor("#c5d4f0").setFontSize(10);
    row++;
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, COLS.length);

  // ── สร้างทีมเริ่มต้น 26/27 ───────────────────────────
  _buildInitialTeam2627(ss);

  logRun(ss, "PromotedData2627", "COV+IPS+HUL | "+Object.values(PROMOTED_PLAYERS_DATA).reduce((s,t)=>s+t.players.length,0)+" players", "SUCCESS");
  ss.toast("✅ Promoted data + Initial team ready", "APEX", 10);
  Logger.log("=== PROMOTED TEAMS DATA DONE ===");
}

// ── สร้างทีมเริ่มต้น FPL 26/27 ────────────────────────
function _buildInitialTeam2627(ss) {
  Logger.log("Building initial team 26/27...");

  // โหลด PL players จาก FULL_PLAYER_DATA_2526
  const fullSheet = ss.getSheetByName("FULL_PLAYER_DATA_2526");
  if (!fullSheet) {
    Logger.log("❌ รัน runFullPlayerData2526() ก่อน");
    return;
  }

  const raw  = fullSheet.getDataRange().getValues();
  const hdr  = raw[0];
  const col  = n => hdr.indexOf(n);

  // ── ทีมตกชั้น 25/26 (ตัดออก) ─────────────────────────
  const RELEGATED = new Set(["WHU","BUR","WOL"]);

  // โหลด PL players (ตัดทีมตกชั้น)
  const plPlayers = raw.slice(1)
    .filter(r => !RELEGATED.has(String(r[col("TEAM")]||"")))
    .map(r => {
      const price   = parseFloat(String(r[col("PRICE")]||"5").replace("£","").replace("m",""))||5;
      const pts     = parseInt(r[col("Pts")])||0;
      const avgPts  = pts / 38;
      const avgMin  = parseInt(r[col("MP")])||0;
      const avgXGI  = parseFloat(r[col("xGI")])||0;
      const avgXGC  = parseFloat(r[col("xGC")])||1.5;
      const avgBPS  = parseInt(r[col("BPS")])||0;
      const avgCBI  = parseInt(r[col("CBI")])||0;
      const avgBonus = parseInt(r[col("BP")])||0;
      const saves    = parseInt(r[col("S")])||0;
      const tsb      = parseFloat(r[col("TSB%")])||0;
      const pos      = String(r[col("POS")]||"MID");
      const posId    = {"GK":1,"DEF":2,"MID":3,"FWD":4}[pos]||3;
      const pen      = parseInt(r[col("PM")]||0) > 0 ? 1 : 0; // PM > 0 = pen taker
      const corner   = 0; // not available in data
      const mpGames   = Math.max(parseInt(r[col("MP")])||0, 1) / 90;
      const xGC_team  = isNaN(avgXGC) || mpGames <= 0 ? 1.5 : avgXGC / mpGames;

      const pScore = _positionScore({
        avgMin: avgMin/38, avgPts, price, avgXGI: avgXGI/38,
        avgXGC: xGC_team, avgBPS: avgBPS/38, avgCBI: avgCBI/38,
        avgBonus: avgBonus/38, avgSaves: saves/38, pen, corner,
        posId,
      }, pos, _isDM({avgXGI: avgXGI/38, avgCBI: avgCBI/38, avgBPS: avgBPS/38, avgXGC: xGC_team}) ? "def_mid" : pos);

      return {
        name:  String(r[col("NAME")]||""),
        team:  String(r[col("TEAM")]||""),
        pos, posId, price,
        avgPts: +avgPts.toFixed(2), avgMin: +(avgMin/38).toFixed(1),
        avgXGI: +(avgXGI/38).toFixed(2), avgBPS: +(avgBPS/38).toFixed(1),
        avgXGC: +xGC_team.toFixed(2), tsb,
        pScore, simXpts: pScore,
        dScore: _diffScore({tsb, ownership:tsb}, pScore),
        isDM: _isDM({avgXGI: avgXGI/38, avgCBI: avgCBI/38, avgBPS: avgBPS/38, avgXGC: xGC_team}),
        source: "PL_2526",
      };
    }).filter(p => p.name && p.price > 0);

  // โหลด promoted players
  const promPlayers = Object.entries(PROMOTED_PLAYERS_DATA).flatMap(([teamCode, team]) =>
    team.players.map((p,i) => {
      const price  = p.price_est;
      const avgPts = (p.goals*6 + p.assists*3 + p.cs*6) / Math.max(p.apps,1);
      const avgMin = p.mp / Math.max(p.apps,1);
      const xGC_t  = parseFloat(team.xGA_per_game)||1.5;
      const posId  = {"GK":1,"DEF":2,"MID":3,"FWD":4}[p.pos]||3;
      const pScoreInput = {
        avgMin: isNaN(avgMin)?60:avgMin,
        avgPts: isNaN(avgPts)?3:avgPts * 0.75,
        price:  price||5,
        avgXGI: (p.xGI||0)/Math.max(p.apps,1),
        avgXGC: isNaN(xGC_t)?1.5:xGC_t,
        avgBPS: (p.bps||0)/Math.max(p.apps,1),
        avgCBI: (p.cbi||0)/Math.max(p.apps,1),
        avgBonus:0,
        avgSaves: (p.saves||0)/Math.max(p.apps,1),
        pen:    (p.note||"").toLowerCase().includes("pen")?1:0,
        corner: (p.note||"").toLowerCase().includes("corner")?1:0,
        posId,
      };
      const pScore = _positionScore(pScoreInput, p.pos) || 0;
      return {
        name: p.name, team: teamCode, pos: p.pos, posId, price,
        avgPts: +(avgPts*0.75).toFixed(2), avgMin: +avgMin.toFixed(1),
        avgXGI: +(p.xGI/Math.max(p.apps,1)).toFixed(2),
        avgBPS: +(p.bps/Math.max(p.apps,1)).toFixed(1),
        tsb: 2.0, // promoted players ต่ำ
        pScore, simXpts: pScore,
        dScore: _diffScore({tsb:2.0}, pScore),
        isDM: p.cbi > 80 && p.xGI/Math.max(p.apps,1) < 2,
        source: "PROMOTED_2627",
        note: p.note,
      };
    })
  );

  // รวม pool
  const pool = [...plPlayers, ...promPlayers]
    .filter(p => p.pos && p.price > 0 && !isNaN(p.pScore))
    .map(p => ({ ...p, pScore: isNaN(p.pScore)?0:p.pScore,
                        simXpts: isNaN(p.pScore)?0:p.pScore }))
    .filter(p => p.pScore >= 0)
    .sort((a,b) => b.pScore - a.pScore);

  Logger.log("Total pool: "+pool.length+" (PL:"+plPlayers.length+" Promoted:"+promPlayers.length+")");

  // สร้างทีมด้วย _blindBuild15
  const result = _blindBuild15(pool, 100.0);
  const squad  = result.squad;
  const itb    = result.itb;

  // Assign XI
  _blindAssignXI(squad, pool);

  // ── เขียน INITIAL_TEAM_2627 sheet ─────────────────────
  const iSheet = getOrCreateSheet(ss, "INITIAL_TEAM_2627");
  iSheet.clearContents(); iSheet.clearFormats();
  let r = 1;

  iSheet.getRange(r,1,1,8).merge()
        .setValue("APEX FPL 26/27 — INITIAL SQUAD (Position Scoring + Differential Logic)")
        .setBackground("#050810").setFontColor("#00f5ff").setFontWeight("bold").setFontSize(13);
  iSheet.setRowHeight(r,32); r++;

  // Summary
  const sqVal  = squad.reduce((s,p)=>s+p.price,0);
  const gkCnt  = squad.filter(p=>p.pos==="GK").length;
  const defCnt = squad.filter(p=>p.pos==="DEF").length;
  const midCnt = squad.filter(p=>p.pos==="MID").length;
  const fwdCnt = squad.filter(p=>p.pos==="FWD").length;
  const diffCnt = squad.filter(p=>p.isDiff).length;
  const dmCnt   = squad.filter(p=>p.isDM).length;

  [["Squad value", "£"+sqVal.toFixed(1)+"m", "ITB", "£"+itb+"m"],
   ["Formation", gkCnt+"-"+defCnt+"-"+midCnt+"-"+fwdCnt, "Differentials", diffCnt+" picks"],
   ["DM Slots", dmCnt+" CDM/DM", "Promoted players", squad.filter(p=>plPlayers.find(x=>x.name===p.name)?false:true).length],
  ].forEach(row => {
    [0,1,2,3].forEach(ci => {
      iSheet.getRange(r,ci+1).setValue(row[ci])
            .setFontColor(ci%2===0?"#7a8fba":"#ffffff")
            .setFontWeight(ci%2===0?"bold":"normal").setBackground("#0c1225");
    });
    r++;
  });
  r++;

  const SCOLS = ["ROLE","PLAYER","TEAM","POS","PRICE","SCORE","TYPE","NOTE/SOURCE"];

  // ── Starting XI ──────────────────────────────────────
  iSheet.getRange(r,1,1,SCOLS.length).setValues([["STARTING XI","","","","","","",""]])
        .setBackground("#001a00").setFontColor("#00ff9d").setFontWeight("bold").setFontSize(11);
  r++;
  iSheet.getRange(r,1,1,SCOLS.length).setValues([SCOLS])
        .setBackground("#002a00").setFontColor("#00ff9d").setFontWeight("bold");
  r++;

  squad.filter(p=>p.is_starting)
       .sort((a,b) => {
         const posOrder = {"GK":0,"DEF":1,"MID":2,"FWD":3};
         return (posOrder[a.pos]||4) - (posOrder[b.pos]||4);
       })
       .forEach(p => {
         const role  = p.is_captain?"👑 CAPTAIN":p.is_vice?"[V] Vice":"XI";
         const type  = p.isDiff?"🎯 DIFF":p.isDM?"🛡 DM":"Regular";
         const src   = p.source==="PROMOTED_2627"?"⭐ PROMOTED":"PL 25/26";
         const bg    = p.isDiff?"#0a1a0a":p.isDM?"#0a0a1a":p.is_captain?"#1a1500":
                       p.source==="PROMOTED_2627"?"#1a0a00":"#001a00";
         const fc    = p.isDiff?"#00ff9d":p.isDM?"#b44eff":p.is_captain?"#ffd60a":
                       p.source==="PROMOTED_2627"?"#ff9a00":"#c5d4f0";
         const tier = p.slotLabel || (p.isDiff?"DIFF":p.isDM?"DM":p.isBudget?"BUDGET":p.slotType||"regular");
         iSheet.getRange(r,1,1,8).setValues([[
           role, p.name, p.team, p.pos, "£"+p.price+"m",
           ((p.pScore||p.xpts||0)).toFixed(2), tier, src,
         ]]).setBackground(bg).setFontColor(fc);
         if (p.is_captain||p.isDiff) iSheet.getRange(r,1,1,8).setFontWeight("bold");
         r++;
       });
  r++;

  // ── Bench ─────────────────────────────────────────────
  iSheet.getRange(r,1,1,SCOLS.length).setValues([["BENCH","","","","","","",""]])
        .setBackground("#0a0a0a").setFontColor("#7a8fba").setFontWeight("bold").setFontSize(11);
  r++;
  iSheet.getRange(r,1,1,SCOLS.length).setValues([SCOLS])
        .setBackground("#0a0a0a").setFontColor("#7a8fba").setFontWeight("bold");
  r++;
  squad.filter(p=>!p.is_starting).forEach(p => {
    const type = p.isDiff?"DIFF":p.isDM?"DM":"Regular";
    const bnTier = p.slotLabel || (p.isDiff?"DIFF":p.isDM?"DM":p.isBudget?"BUDGET":p.slotType||"regular");
    iSheet.getRange(r,1,1,8).setValues([[
      "BN", p.name, p.team, p.pos, "£"+p.price+"m",
      ((p.pScore||p.xpts||0)).toFixed(2), bnTier, p.source==="PROMOTED_2627"?"PROMOTED":"PL 25/26",
    ]]).setBackground("#0a0a0a").setFontColor("#7a8fba");
    r++;
  });

  iSheet.setFrozenRows(1);
  iSheet.autoResizeColumns(1, 8);
  Logger.log("✓ Initial team 26/27 built: "+squad.length+" players | ITB:£"+itb+"m");
}
